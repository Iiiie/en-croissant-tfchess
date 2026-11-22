import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveResource } from "@tauri-apps/api/path";
import { readFile } from "@tauri-apps/plugin-fs";
import { platform } from "@tauri-apps/plugin-os";
import { getDefaultStore } from "jotai";
import { commands } from "@/bindings/generated";
import { soundCollectionAtom, soundVolumeAtom } from "@/state/atoms";

const POOL_SIZE = 5;
const audioPool = Array.from({ length: POOL_SIZE }, () => new Audio());
let poolIndex = 0;

let soundServerPort: number | null = null;
const soundUrlCache = new Map<string, string>();

function isLinux(): boolean {
    try {
        return platform() === "linux";
    } catch {
        return false;
    }
}

let lastTime = 0;

async function getSoundServerPort(): Promise<number> {
    if (soundServerPort !== null) {
        return soundServerPort;
    }
    const result = await commands.getSoundServerPort();
    if (result.status === "ok") {
        soundServerPort = result.data;
        return soundServerPort;
    }
    throw new Error("Failed to get sound server port");
}

export function playSound(capture: boolean, check: boolean) {
    // only play at most 1 sound every 75ms
    const now = Date.now();
    if (now - lastTime < 75) {
        return;
    }
    lastTime = now;

    const store = getDefaultStore();
    const collection = store.get(soundCollectionAtom);
    const volume = store.get(soundVolumeAtom);

    let type = "Move";
    if (capture) {
        type = "Capture";
    }
    if (collection !== "standard" && check) {
        type = "Check";
    }

    const cacheKey = `${collection}/${type}`;

    const playWithUrl = (url: string) => {
        const player = audioPool[poolIndex];
        poolIndex = (poolIndex + 1) % POOL_SIZE;

        player.src = url;
        player.volume = volume;
        player.play().catch((e) => console.error("Audio playback error:", e));
    };

    if (isLinux()) {
        getSoundServerPort()
            .then((port) => {
                const url = `http://127.0.0.1:${port}/${collection}/${type}.mp3`;
                playWithUrl(url);
            })
            .catch(() => {
                // fails if Tauri APIs are unavailable (e.g., in tests)
            });
    } else {
        const path = `sound/${collection}/${type}.mp3`;

        if (soundUrlCache.has(cacheKey)) {
            playWithUrl(soundUrlCache.get(cacheKey)!);
            return;
        }
        resolveResource(path)
            .then((filePath) => {
                const assetUrl = convertFileSrc(filePath);
                soundUrlCache.set(cacheKey, assetUrl);

                playWithUrl(assetUrl);
            })
            .catch(() => {
                // fails if Tauri APIs are unavailable (e.g., in tests)
            });
    }
}

/* ------------------------------------------------------------------------- *
 * Intermission metronome
 *
 * The move sound is reused as the tick, but unlike `playSound` the tick is
 * preloaded, decoded once and scheduled ahead of time on the Web Audio clock.
 * That makes the interval independent of HTTP/file/decode latency, so beats
 * stay evenly spaced for any BPM.
 * ------------------------------------------------------------------------- */

const TICK_TYPE = "Move";
const TICK_POOL_SIZE = 4;

let tickAudioContext: AudioContext | null = null;
let tickUnlockInstalled = false;
const tickBufferCache = new Map<string, Promise<AudioBuffer | null>>();

function getTickAudioContext(): AudioContext | null {
    if (tickAudioContext) {
        return tickAudioContext;
    }
    if (typeof window === "undefined") {
        return null;
    }
    try {
        const Context =
            window.AudioContext ??
            (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Context) {
            return null;
        }
        tickAudioContext = new Context();
    } catch {
        tickAudioContext = null;
        return null;
    }
    return tickAudioContext;
}

/**
 * Autoplay policies only allow resuming an AudioContext from inside a user
 * gesture. Install this at module load so the first click/keypress unlocks the
 * metronome long before any intermission starts.
 */
function installTickUnlock(): void {
    if (tickUnlockInstalled || typeof window === "undefined") {
        return;
    }
    tickUnlockInstalled = true;

    const unlock = () => {
        const context = getTickAudioContext();
        if (!context) {
            return;
        }
        void context
            .resume()
            .then(() => {
                if (context.state === "running") {
                    window.removeEventListener("pointerdown", unlock, true);
                    window.removeEventListener("keydown", unlock, true);
                }
            })
            .catch(() => undefined);
    };

    window.addEventListener("pointerdown", unlock, { capture: true, passive: true });
    window.addEventListener("keydown", unlock, { capture: true });
}

installTickUnlock();

async function resolveSoundUrl(collection: string, type: string): Promise<string> {
    const cacheKey = `${collection}/${type}`;
    const cached = soundUrlCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const url = isLinux()
        ? `http://127.0.0.1:${await getSoundServerPort()}/${collection}/${type}.mp3`
        : convertFileSrc(await resolveResource(`sound/${collection}/${type}.mp3`));

    soundUrlCache.set(cacheKey, url);
    return url;
}

async function loadSoundBytes(collection: string, type: string): Promise<Uint8Array | null> {
    // Prefer reading the bundled resource directly: it needs no HTTP round
    // trip and avoids cross-origin restrictions on the local sound server.
    try {
        const path = await resolveResource(`sound/${collection}/${type}.mp3`);
        return await readFile(path);
    } catch {
        // Resource reads can be unavailable (missing capability, tests, ...).
    }

    try {
        const response = await fetch(await resolveSoundUrl(collection, type));
        if (response.ok) {
            return new Uint8Array(await response.arrayBuffer());
        }
    } catch {
        // Fetching the sound outside Tauri fails; the caller falls back.
    }

    return null;
}

async function loadTickBuffer(collection: string): Promise<AudioBuffer | null> {
    const cacheKey = `${collection}/${TICK_TYPE}`;
    const cached = tickBufferCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const pending = (async () => {
        const context = getTickAudioContext();
        if (!context) {
            return null;
        }
        const bytes = await loadSoundBytes(collection, TICK_TYPE);
        if (!bytes) {
            return null;
        }
        try {
            return await context.decodeAudioData(new Uint8Array(bytes).buffer as ArrayBuffer);
        } catch {
            return null;
        }
    })();

    tickBufferCache.set(cacheKey, pending);
    return pending;
}

/**
 * Warms the audio context and decodes the tick sound. Safe to call during the
 * intermission intro: failures simply make the ticker fall back to elements.
 */
export async function prepareTick(): Promise<boolean> {
    const collection = getDefaultStore().get(soundCollectionAtom);
    const context = getTickAudioContext();
    if (context && context.state === "suspended") {
        try {
            await context.resume();
        } catch {
            // Needs a user gesture; the unlock listener handles it.
        }
    }
    const buffer = await loadTickBuffer(collection);
    return Boolean(context && buffer);
}

export type TickTickerStop = () => void;

/**
 * Starts the intermission metronome.
 *
 * Beats happen at `startPerfMs + leadMs + n * intervalMs` on the
 * `performance.now()` timeline. The returned stop function must be called when
 * the intermission leaves the main phase.
 */
export function startTickTicker(args: {
    startPerfMs: number;
    intervalMs: number;
    leadMs?: number;
}): TickTickerStop {
    const store = getDefaultStore();
    const collection = store.get(soundCollectionAtom);
    const intervalMs =
        Number.isFinite(args.intervalMs) && args.intervalMs > 0
            ? Math.max(10, args.intervalMs)
            : 60_000 / 90;
    const anchorPerfMs = args.startPerfMs + (args.leadMs ?? 0);
    const audioContext = getTickAudioContext();

    let stopped = false;
    let nextBeat = 0;
    let scheduleTimer: ReturnType<typeof setInterval> | null = null;
    let elementTimer: ReturnType<typeof setTimeout> | null = null;
    let elementPool: HTMLAudioElement[] | null = null;
    let elementIndex = 0;
    const sources = new Set<AudioBufferSourceNode>();

    const beatPerfMs = (beat: number) => anchorPerfMs + beat * intervalMs;

    const getVolume = () => {
        const value = store.get(soundVolumeAtom);
        return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
    };

    const stop = () => {
        if (stopped) {
            return;
        }
        stopped = true;
        if (scheduleTimer) {
            clearInterval(scheduleTimer);
            scheduleTimer = null;
        }
        if (elementTimer) {
            clearTimeout(elementTimer);
            elementTimer = null;
        }
        for (const source of sources) {
            try {
                source.stop();
            } catch {
                // Already stopped.
            }
            try {
                source.disconnect();
            } catch {
                // Already disconnected.
            }
        }
        sources.clear();
        if (elementPool) {
            for (const player of elementPool) {
                try {
                    player.pause();
                } catch {
                    // Ignore elements that failed to load.
                }
            }
            elementPool = null;
        }
    };

    const playAudioBeat = (context: AudioContext, buffer: AudioBuffer, when: number) => {
        const source = context.createBufferSource();
        source.buffer = buffer;
        const gain = context.createGain();
        gain.gain.value = getVolume();
        source.connect(gain).connect(context.destination);
        sources.add(source);
        source.onended = () => {
            sources.delete(source);
            try {
                source.disconnect();
            } catch {
                // Already disconnected.
            }
            try {
                gain.disconnect();
            } catch {
                // Already disconnected.
            }
        };
        try {
            source.start(when);
        } catch {
            sources.delete(source);
            try {
                source.disconnect();
            } catch {
                // Already disconnected.
            }
            try {
                gain.disconnect();
            } catch {
                // Already disconnected.
            }
        }
    };

    const scheduleAudio = (context: AudioContext, buffer: AudioBuffer) => {
        const LOOKAHEAD_MS = 150;
        const run = () => {
            if (stopped || context.state !== "running") {
                return;
            }
            const nowPerf = performance.now();
            const nowAudio = context.currentTime;
            while (!stopped) {
                const targetPerf = beatPerfMs(nextBeat);
                if (targetPerf > nowPerf + LOOKAHEAD_MS) {
                    break;
                }
                nextBeat += 1;
                if (targetPerf < nowPerf - 30) {
                    // Missed while the window was hidden or the context was
                    // suspended: skip instead of firing a burst.
                    continue;
                }
                const when = nowAudio + Math.max(0, (targetPerf - nowPerf) / 1000);
                playAudioBeat(context, buffer, when);
            }
        };
        run();
        scheduleTimer = setInterval(run, 25);
    };

    const scheduleElement = async () => {
        if (stopped) {
            return;
        }
        try {
            const url = await resolveSoundUrl(collection, TICK_TYPE);
            elementPool = Array.from({ length: TICK_POOL_SIZE }, () => {
                const player = new Audio(url);
                player.preload = "auto";
                player.volume = getVolume();
                player.load();
                return player;
            });
        } catch {
            elementPool = null;
        }
        if (stopped || !elementPool || elementPool.length === 0) {
            return;
        }

        const arm = () => {
            if (stopped) {
                return;
            }
            const nowPerf = performance.now();
            while (beatPerfMs(nextBeat) < nowPerf - 30) {
                nextBeat += 1;
            }
            const delay = Math.max(0, beatPerfMs(nextBeat) - nowPerf);
            elementTimer = setTimeout(() => {
                if (stopped) {
                    return;
                }
                const pool = elementPool;
                if (pool && pool.length > 0) {
                    const player = pool[elementIndex % pool.length];
                    elementIndex += 1;
                    try {
                        player.currentTime = 0;
                        player.volume = getVolume();
                        void player.play().catch(() => undefined);
                    } catch {
                        // Element may not be ready yet.
                    }
                }
                nextBeat += 1;
                arm();
            }, delay);
        };
        arm();
    };

    void (async () => {
        const buffer = await loadTickBuffer(collection);
        if (stopped) {
            return;
        }
        if (audioContext && buffer) {
            if (audioContext.state === "suspended") {
                try {
                    await audioContext.resume();
                } catch {
                    // Needs a user gesture; fall back to media elements.
                }
            }
            if (stopped) {
                return;
            }
            if (audioContext.state === "running") {
                scheduleAudio(audioContext, buffer);
                return;
            }
        }
        await scheduleElement();
    })();

    return stop;
}
