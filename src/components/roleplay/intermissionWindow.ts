import type { MantineColor } from "@mantine/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { GameSide, IntermissionEndReason } from "@/utils/playerProfile";

export const INTERMISSION_UPDATE_EVENT = "intermission-update";
export const INTERMISSION_ENDED_EVENT = "intermission-ended";

export type IntermissionSidePayload = {
    side: GameSide;
    profileName: string;
    image: string | null;
    message: string | null;
    durationMs: number;
    severity: number;
    outcome?: "WIN" | "LOSS";
    difference?: number;
    category: string | null;
    folder: string | null;
};

export type IntermissionPayload = {
    id: string;
    title: string;
    intro: string;
    pulseBpm: number;
    primaryColor: MantineColor;
    fontSize: number;
    kind: "capture" | "check";
    san: string;
    ply: number;
    materialDiff?: number;
    show: { white: boolean; black: boolean };
    sides: { white: IntermissionSidePayload; black: IntermissionSidePayload };
};

export type IntermissionEndedPayload = {
    id: string;
    side: GameSide;
    reason: IntermissionEndReason;
};

export function getIntermissionPayloadKey(label: string): string {
    return `intermission-payload:${label}`;
}

export function storeIntermissionPayload(label: string, payload: IntermissionPayload): void {
    localStorage.setItem(getIntermissionPayloadKey(label), JSON.stringify(payload));
}

export function getIntermissionPayload(): IntermissionPayload | null {
    const label = getCurrentWindow().label;
    const key = getIntermissionPayloadKey(label);
    try {
        const raw = localStorage.getItem(key);
        if (!raw) {
            return null;
        }
        // Keep the payload so a dev-server reload (or any webview reload) can
        // still show the intermission. It is removed when the intermission ends.
        return JSON.parse(raw) as IntermissionPayload;
    } catch {
        return null;
    }
}

export function removeIntermissionPayload(label: string): void {
    try {
        localStorage.removeItem(getIntermissionPayloadKey(label));
    } catch {
        // localStorage may be unavailable.
    }
}

export async function openIntermissionWindow(args: {
    label: string;
    payload: IntermissionPayload;
}): Promise<WebviewWindow> {
    storeIntermissionPayload(args.label, args.payload);

    const existing = await WebviewWindow.getByLabel(args.label);
    if (existing) {
        if (await existing.isMinimized()) {
            await existing.unminimize();
        }
        await existing.show();
        await existing.setFocus();
        await existing.emit(INTERMISSION_UPDATE_EVENT, args.payload);
        return existing;
    }

    const window = new WebviewWindow(args.label, {
        url: "/intermission.html",
        title: args.payload.title,
        fullscreen: true,
        transparent: false,
        decorations: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        focus: false,
        resizable: false,
        visible: true,
    });

    await new Promise<void>((resolve, reject) => {
        void window.once("tauri://created", () => resolve());
        void window.once("tauri://error", (event) => {
            reject(new Error(String(event.payload)));
        });
    });

    return window;
}

export async function closeIntermissionWindow(label: string): Promise<void> {
    const window = await WebviewWindow.getByLabel(label);
    if (window) {
        try {
            await window.destroy();
        } catch {
            // Already closed.
        }
    }
}

export async function closeAllIntermissionWindows(): Promise<void> {
    try {
        const windows = await WebviewWindow.getAll();
        await Promise.all(
            windows
                .filter((window) => window.label.startsWith("intermission-"))
                .map((window) => window.destroy().catch(() => undefined)),
        );
    } catch {
        // Window APIs are unavailable outside Tauri (for example in tests).
    }

    try {
        for (const key of Object.keys(localStorage)) {
            if (key.startsWith("intermission-payload:")) {
                localStorage.removeItem(key);
            }
        }
    } catch {
        // localStorage may be unavailable.
    }
}

export function listenForIntermissionEnded(
    callback: (payload: IntermissionEndedPayload) => void,
): Promise<UnlistenFn> {
    return listen<IntermissionEndedPayload>(INTERMISSION_ENDED_EVENT, (event) => {
        callback(event.payload);
    });
}

export async function emitIntermissionEnded(payload: IntermissionEndedPayload): Promise<void> {
    await emit(INTERMISSION_ENDED_EVENT, payload);
}
