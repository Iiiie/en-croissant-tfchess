/**
 * Shared timing primitives for roleplay intermissions.
 *
 * The pulse (CSS), the tick sound (Web Audio) and the countdown all derive
 * their values from these helpers so they always agree, no matter which BPM
 * the settings produce.
 */

export const MIN_BPM = 1;
export const MAX_BPM = 600;
export const DEFAULT_BPM = 90;

/** Shared offset between entering the main phase and the first beat. */
export const BEAT_LEAD_MS = 60;

/** Maximum delay accepted by `setTimeout` across browsers. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * Turns any stored/settings value into a usable integer BPM.
 *
 * - non-finite values fall back to {@link DEFAULT_BPM}
 * - values outside the supported range are clamped
 * - decimals are rounded
 */
export function normalizeBpm(value: unknown): number {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) {
        return DEFAULT_BPM;
    }
    return Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, numeric)));
}

/** Milliseconds between two beats. Always finite and strictly positive. */
export function bpmToIntervalMs(bpm: unknown): number {
    return 60_000 / normalizeBpm(bpm);
}

/**
 * Picks the per-intermission BPM. Bounds are normalized first, so a corrupted
 * value (NaN/Infinity/0) or an inverted min/max range cannot produce an
 * unusable payload.
 */
export function randomBpm(min: unknown, max: unknown): number {
    const first = normalizeBpm(min);
    const second = normalizeBpm(max);
    const low = Math.min(first, second);
    const high = Math.max(first, second);
    return Math.min(high, Math.round(low + Math.random() * (high - low)));
}

/** Remaining time rounded up to tenths of a second, for the countdown text. */
export function remainingTenthsAt(durationMs: number, elapsedMs: number): number {
    const remaining = Math.max(0, durationMs - Math.max(0, elapsedMs));
    return Math.max(0, Math.ceil(remaining / 100));
}

/**
 * Schedules `callback` at an absolute `performance.now()` deadline and returns
 * a cancel function. Calls are chained for durations beyond the `setTimeout`
 * limit, which would otherwise overflow to an immediate (0 ms) timeout.
 */
export function createDeadlineTimer(deadlineAtMs: number, callback: () => void): () => void {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const arm = () => {
        if (cancelled) {
            return;
        }
        const remaining = deadlineAtMs - performance.now();
        if (remaining <= 0) {
            callback();
            return;
        }
        timer = setTimeout(arm, Math.min(remaining, MAX_TIMER_DELAY_MS));
    };

    arm();

    return () => {
        cancelled = true;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };
}
