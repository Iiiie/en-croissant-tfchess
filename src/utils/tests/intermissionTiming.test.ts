import { describe, expect, test, vi } from "vitest";
import {
    bpmToIntervalMs,
    DEFAULT_BPM,
    MAX_BPM,
    MIN_BPM,
    normalizeBpm,
    randomBpm,
    remainingTenthsAt,
} from "../intermissionTiming";

describe("normalizeBpm", () => {
    test("keeps values inside the supported range", () => {
        expect(normalizeBpm(90)).toBe(90);
        expect(normalizeBpm(1)).toBe(MIN_BPM);
        expect(normalizeBpm(600)).toBe(MAX_BPM);
    });

    test("clamps out-of-range values", () => {
        expect(normalizeBpm(0)).toBe(MIN_BPM);
        expect(normalizeBpm(-5)).toBe(MIN_BPM);
        expect(normalizeBpm(1_000_000)).toBe(MAX_BPM);
    });

    test("falls back for unusable values", () => {
        expect(normalizeBpm(Number.NaN)).toBe(DEFAULT_BPM);
        expect(normalizeBpm(Number.POSITIVE_INFINITY)).toBe(DEFAULT_BPM);
        expect(normalizeBpm(Number.NEGATIVE_INFINITY)).toBe(DEFAULT_BPM);
        expect(normalizeBpm("not a number")).toBe(DEFAULT_BPM);
        expect(normalizeBpm(undefined)).toBe(DEFAULT_BPM);
    });

    test("rounds fractional BPM values", () => {
        expect(normalizeBpm(90.4)).toBe(90);
        expect(normalizeBpm(90.5)).toBe(91);
    });
});

describe("bpmToIntervalMs", () => {
    test("converts BPM into a beat duration", () => {
        expect(bpmToIntervalMs(120)).toBeCloseTo(500, 6);
        expect(bpmToIntervalMs(60)).toBeCloseTo(1000, 6);
        expect(bpmToIntervalMs(90)).toBeCloseTo(666.667, 2);
    });

    test("never returns zero or a non-finite interval", () => {
        expect(bpmToIntervalMs(0)).toBe(60_000 / MIN_BPM);
        expect(Number.isFinite(bpmToIntervalMs(Number.NaN))).toBe(true);
        expect(bpmToIntervalMs(1_000_000)).toBeGreaterThan(0);
    });
});

describe("randomBpm", () => {
    test("stays within the requested range", () => {
        const random = vi.spyOn(Math, "random");
        random.mockReturnValue(0);
        expect(randomBpm(90, 120)).toBe(90);
        random.mockReturnValue(0.5);
        expect(randomBpm(90, 120)).toBe(105);
        random.mockReturnValue(0.999999);
        expect(randomBpm(90, 120)).toBe(120);
        random.mockRestore();
    });

    test("handles inverted and invalid bounds", () => {
        const random = vi.spyOn(Math, "random");
        random.mockReturnValue(0);
        expect(randomBpm(120, 90)).toBe(90);
        random.mockReturnValue(0.999999);
        expect(randomBpm(Number.NaN, Number.NaN)).toBe(DEFAULT_BPM);
        expect(randomBpm(0, 0)).toBe(MIN_BPM);
        random.mockRestore();
    });
});

describe("remainingTenthsAt", () => {
    test("counts down in tenths", () => {
        expect(remainingTenthsAt(5000, 0)).toBe(50);
        expect(remainingTenthsAt(5000, 1)).toBe(50);
        expect(remainingTenthsAt(5000, 100)).toBe(49);
        expect(remainingTenthsAt(5000, 4900)).toBe(1);
        expect(remainingTenthsAt(5000, 5000)).toBe(0);
    });

    test("never goes negative", () => {
        expect(remainingTenthsAt(5000, 9999)).toBe(0);
        expect(remainingTenthsAt(0, 0)).toBe(0);
    });
});
