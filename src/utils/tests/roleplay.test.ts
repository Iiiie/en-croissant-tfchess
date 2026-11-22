import { describe, expect, test } from "vitest";
import type { GameMove } from "@/bindings";
import {
    buildHistoryEntry,
    createGameRecord,
    formatMessage,
    isImageFileName,
    isMediaFileName,
    isVideoFileName,
    newPlayerProfile,
    resultScore,
    snapshotPlayer,
    updateRating,
} from "../playerProfile";
import { getIntermissionTrigger, resolveIntermissionDuration } from "../roleplay";

function move(uci: string, san: string, fenAfter: string): GameMove {
    return {
        uci,
        san,
        fenAfter,
        clock: null,
        whiteTime: null,
        blackTime: null,
    };
}

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const AFTER_D5 = "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
const AFTER_EXD5 = "rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2";
const CHECK_FEN = "4k2R/8/8/8/8/8/8/4K3 b - - 0 1";

describe("intermission triggers", () => {
    test("ignores quiet moves", () => {
        const trigger = getIntermissionTrigger({
            initialFen: START_FEN,
            moves: [move("e2e4", "e4", AFTER_E4)],
            moveIndex: 0,
        });
        expect(trigger).toBeNull();
    });

    test("detects a capture and the captured piece", () => {
        const moves = [
            move("e2e4", "e4", AFTER_E4),
            move("d7d5", "d5", AFTER_D5),
            move("e4d5", "exd5", AFTER_EXD5),
        ];
        const trigger = getIntermissionTrigger({
            initialFen: START_FEN,
            moves,
            moveIndex: 2,
        });

        expect(trigger).not.toBeNull();
        expect(trigger?.kind).toBe("capture");
        expect(trigger?.ply).toBe(3);
        expect(trigger?.moveColor).toBe("white");
        expect(trigger?.capturedRole).toBe("pawn");
        expect(trigger?.isCheck).toBe(false);
        expect(trigger?.severity).toBe(1);
        expect(trigger?.candidates.white).toEqual(["took", "default"]);
        expect(trigger?.candidates.black).toEqual(["lost", "default"]);
    });

    test("detects a check", () => {
        const trigger = getIntermissionTrigger({
            initialFen: "4k3/8/8/8/8/8/8/4K2R w K - 0 1",
            moves: [move("h1h8", "Rh8+", CHECK_FEN)],
            moveIndex: 0,
        });

        expect(trigger).not.toBeNull();
        expect(trigger?.kind).toBe("check");
        expect(trigger?.moveColor).toBe("white");
        expect(trigger?.isCheck).toBe(true);
        expect(trigger?.severity).toBe(3);
        expect(trigger?.candidates.white).toEqual(["check", "default"]);
        expect(trigger?.candidates.black).toEqual(["checked", "default"]);
    });

    test("a capture with check combines severity", () => {
        const trigger = getIntermissionTrigger({
            initialFen: "3qk3/8/8/8/8/8/8/3QK3 w - - 0 1",
            moves: [move("d1d8", "Qxd8+", "3Qk3/8/8/8/8/8/8/4K3 b - - 0 1")],
            moveIndex: 0,
        });

        expect(trigger?.kind).toBe("capture");
        expect(trigger?.isCheck).toBe(true);
        expect(trigger?.capturedRole).toBe("queen");
        expect(trigger?.severity).toBe(11);
        expect(trigger?.candidates.white).toEqual(["took", "check", "default"]);
        expect(trigger?.candidates.black).toEqual(["lost", "checked", "default"]);
    });
});

describe("intermission duration", () => {
    test("multiplies the base duration by vulnerability", () => {
        expect(resolveIntermissionDuration(4000, 1)).toBe(4000);
        expect(resolveIntermissionDuration(4000, 1.5)).toBe(6000);
        expect(resolveIntermissionDuration(4000, 0.5)).toBe(2000);
    });

    test("never returns less than one second", () => {
        expect(resolveIntermissionDuration(100, 0.1)).toBe(1000);
    });

    test("scales with severity", () => {
        expect(resolveIntermissionDuration(4000, 1, 1)).toBe(4000);
        expect(resolveIntermissionDuration(4000, 1, 2)).toBe(8000);
        expect(resolveIntermissionDuration(4000, 1, 3)).toBe(12000);
        expect(resolveIntermissionDuration(4000, 1, 5)).toBe(20000);
        expect(resolveIntermissionDuration(4000, 1, 9)).toBe(36000);
        expect(resolveIntermissionDuration(4000, 1.5, 3)).toBe(18000);
    });
});

describe("media extensions", () => {
    test("recognises images, videos and media", () => {
        expect(isImageFileName("a.png")).toBe(true);
        expect(isImageFileName("a.JPG")).toBe(true);
        expect(isImageFileName("a.mp4")).toBe(false);
        expect(isVideoFileName("a.webm")).toBe(true);
        expect(isVideoFileName("a.mp4")).toBe(true);
        expect(isVideoFileName("a.png")).toBe(false);
        expect(isMediaFileName("a.mp4")).toBe(true);
        expect(isMediaFileName("a.png")).toBe(true);
        expect(isMediaFileName("a.txt")).toBe(false);
    });
});

describe("profiles", () => {
    test("new profiles pull from the default archetype by default", () => {
        const profile = newPlayerProfile({ name: "Alice" });
        expect(profile.archetypeIds).toEqual(["default"]);
    });
});

describe("messages", () => {
    test("replaces known placeholders", () => {
        expect(
            formatMessage("You took {piece} from {opponent}, {player}!", {
                piece: "queen",
                opponent: "Bob",
                player: "Alice",
            }),
        ).toBe("You took queen from Bob, Alice!");
    });

    test("leaves unknown placeholders alone", () => {
        expect(formatMessage("{unknown}", {})).toBe("{unknown}");
    });
});

describe("elo", () => {
    test("updates ratings symmetrically", () => {
        expect(updateRating(1500, 1500, 1, 32)).toBe(1516);
        expect(updateRating(1500, 1500, 0, 32)).toBe(1484);
        expect(updateRating(1500, 1500, 0.5, 32)).toBe(1500);
    });

    test("maps results to scores", () => {
        expect(resultScore("1-0", "white")).toBe(1);
        expect(resultScore("1-0", "black")).toBe(0);
        expect(resultScore("1/2-1/2", "white")).toBe(0.5);
        expect(resultScore("*", "white")).toBeNull();
    });
});

describe("history", () => {
    test("builds a rated history entry", () => {
        const white = newPlayerProfile({ name: "Alice", elo: 1500 });
        const black = newPlayerProfile({ name: "Bob", elo: 1500 });
        const record = createGameRecord({
            id: "record-1",
            gameId: "game-1",
            white: snapshotPlayer(white, "Alice", "300+2"),
            black: snapshotPlayer(black, "Bob", "300+2"),
            narrative: true,
        });
        const entry = buildHistoryEntry({
            record,
            side: "white",
            result: "1-0",
            reason: "checkmate",
            pgn: '[Event "Test"]\n\n1. e4 *',
            chat: [],
            intermissions: [],
            endedAt: record.startedAt + 1000,
        });

        expect(record.rated).toBe(true);
        expect(entry.playerScore).toBe(1);
        expect(entry.eloBefore).toBe(1500);
        expect(entry.eloAfter).toBe(1516);
        expect(entry.opponentName).toBe("Bob");
        expect(entry.color).toBe("white");
        expect(entry.timeControl).toBe("300+2");
    });

    test("does not rate a game against a guest", () => {
        const white = newPlayerProfile({ name: "Alice", elo: 1500 });
        const record = createGameRecord({
            id: "record-2",
            gameId: "game-2",
            white: snapshotPlayer(white, "Alice", "300+2"),
            black: snapshotPlayer(null, "Guest", "300+2"),
            narrative: true,
        });
        const entry = buildHistoryEntry({
            record,
            side: "white",
            result: "1-0",
            reason: "checkmate",
            pgn: "",
            chat: [],
            intermissions: [],
            endedAt: record.startedAt + 1000,
        });

        expect(record.rated).toBe(false);
        expect(entry.eloAfter).toBe(1500);
    });
});
