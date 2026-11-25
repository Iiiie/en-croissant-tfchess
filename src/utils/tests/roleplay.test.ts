import { describe, expect, test } from "vitest";
import type { GameMove } from "@/bindings";
import {
    buildHistoryEntry,
    createGameRecord,
    EMPTY_MESSAGES,
    formatMessage,
    isImageFileName,
    isMediaFileName,
    isVideoFileName,
    MESSAGES_EXAMPLE,
    messagesSchema,
    newPlayerProfile,
    resultScore,
    serializeMessagesFile,
    snapshotPlayer,
    updateRating,
} from "../playerProfile";
import {
    buildMediaSources,
    getIntermissionTrigger,
    getMoverMaterialDiff,
    getSideMessageDifference,
    materialDurationMultiplier,
    type IntermissionTrigger,
    type MediaSource,
    parseDifferenceRange,
    pickNearestDifferenceList,
    pickNearestDifferenceMessages,
    resolveIntermissionDuration,
    selectBestMessageCandidate,
    shouldPlaySideIntermission,
} from "../roleplay";

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
        expect(trigger?.materialDiff).toBe(1);
        expect(trigger?.magnitude).toBe(1);
        expect(trigger?.outcome).toEqual({ white: "WIN", black: "LOSS" });
        expect(trigger?.candidates.white).toEqual(["WIN", "took", "default"]);
        expect(trigger?.candidates.black).toEqual(["LOSS", "lost", "default"]);
    });

    test("the mover gets WIN even while behind on material", () => {
        // Black has an extra queen; White captures a pawn but stays behind.
        const trigger = getIntermissionTrigger({
            initialFen: "q3k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1",
            moves: [move("e4d5", "exd5", "q3k3/8/8/3P4/8/8/8/4K3 b - - 0 1")],
            moveIndex: 0,
        });

        expect(trigger?.materialDiff).toBe(-8);
        expect(trigger?.magnitude).toBe(8);
        expect(trigger?.outcome).toEqual({ white: "WIN", black: "LOSS" });
        expect(trigger?.candidates.white).toEqual(["WIN", "took", "default"]);
        expect(trigger?.candidates.black).toEqual(["LOSS", "lost", "default"]);
        expect(materialDurationMultiplier(-8, 1)).toBe(0);
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
        expect(trigger?.materialDiff).toBe(5);
        expect(trigger?.magnitude).toBe(5);
        expect(trigger?.outcome).toEqual({ white: "WIN", black: "LOSS" });
        expect(trigger?.candidates.white).toEqual(["WIN", "check", "default"]);
        expect(trigger?.candidates.black).toEqual(["LOSS", "checked", "default"]);
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
        expect(trigger?.materialDiff).toBe(9);
        expect(trigger?.magnitude).toBe(9);
        expect(trigger?.outcome).toEqual({ white: "WIN", black: "LOSS" });
        expect(trigger?.candidates.white).toEqual(["WIN", "took", "check", "default"]);
        expect(trigger?.candidates.black).toEqual(["LOSS", "lost", "checked", "default"]);
    });
});

describe("material difference", () => {
    test("uses the mover's signed perspective", () => {
        expect(getMoverMaterialDiff(4, "white")).toBe(4);
        expect(getMoverMaterialDiff(4, "black")).toBe(-4);
    });

    test("scales with the mover's material difference", () => {
        expect(materialDurationMultiplier(2, 1)).toBe(2);
        expect(materialDurationMultiplier(20, 0.1)).toBe(2);
        expect(materialDurationMultiplier(-10, 1)).toBe(0);
        expect(materialDurationMultiplier(10, 0)).toBe(1);
    });

    test("gates LOSS sides by their signed deficit", () => {
        const losingWhileAhead = {
            materialDiff: 8,
            outcome: { white: "LOSS", black: "WIN" },
        } as IntermissionTrigger;
        expect(shouldPlaySideIntermission(losingWhileAhead, "white", 0)).toBe(false);
        expect(shouldPlaySideIntermission(losingWhileAhead, "black", 0)).toBe(false);

        const losingWhileBehind = {
            materialDiff: -8,
            outcome: { white: "LOSS", black: "WIN" },
        } as IntermissionTrigger;
        expect(shouldPlaySideIntermission(losingWhileBehind, "white", 0)).toBe(true);
        expect(shouldPlaySideIntermission(losingWhileBehind, "black", 0)).toBe(true);
        expect(shouldPlaySideIntermission(losingWhileBehind, "white", 8)).toBe(true);
        expect(shouldPlaySideIntermission(losingWhileBehind, "white", 9)).toBe(false);
    });

    test("gates WIN sides by their signed lead", () => {
        const winningWhileAhead = {
            materialDiff: 8,
            outcome: { white: "WIN", black: "LOSS" },
        } as IntermissionTrigger;
        expect(shouldPlaySideIntermission(winningWhileAhead, "white", 0)).toBe(true);
        expect(shouldPlaySideIntermission(winningWhileAhead, "white", 8)).toBe(true);
        expect(shouldPlaySideIntermission(winningWhileAhead, "white", 9)).toBe(false);
        expect(shouldPlaySideIntermission(winningWhileAhead, "black", 0)).toBe(true);

        const winningWhileBehind = {
            materialDiff: -8,
            outcome: { white: "WIN", black: "LOSS" },
        } as IntermissionTrigger;
        expect(shouldPlaySideIntermission(winningWhileBehind, "white", 0)).toBe(false);
        expect(shouldPlaySideIntermission(winningWhileBehind, "black", 0)).toBe(false);
    });
});

describe("difference ranges", () => {
    test("parses exact and ranged folder names", () => {
        expect(parseDifferenceRange("5")).toEqual({ min: 5, max: 5 });
        expect(parseDifferenceRange("1-11")).toEqual({ min: 1, max: 11 });
        expect(parseDifferenceRange("12+")).toEqual({ min: 12, max: Number.POSITIVE_INFINITY });
        expect(parseDifferenceRange("queen")).toBeNull();
        expect(parseDifferenceRange("")).toBeNull();
    });
});

describe("difference messages", () => {
    test("uses the nearest filled difference", () => {
        const messages = { "0": ["zero"], "12": ["twelve"] };
        expect(pickNearestDifferenceMessages(messages, 9)).toEqual(["twelve"]);
        expect(pickNearestDifferenceMessages(messages, 0)).toEqual(["zero"]);
        expect(pickNearestDifferenceMessages(messages, 103)).toEqual(["twelve"]);
    });

    test("ties go to the higher difference", () => {
        const messages = { "0": ["zero"], "12": ["twelve"] };
        expect(pickNearestDifferenceMessages(messages, 6)).toEqual(["twelve"]);
    });

    test("ignores empty lists", () => {
        expect(pickNearestDifferenceMessages({ "0": [], "4": ["four"] }, 0)).toEqual(["four"]);
        expect(pickNearestDifferenceMessages({}, 5)).toEqual([]);
    });
});

describe("side message difference", () => {
    function trigger(materialDiff: number, whiteOutcome: "WIN" | "LOSS"): IntermissionTrigger {
        return {
            materialDiff,
            outcome: {
                white: whiteOutcome,
                black: whiteOutcome === "WIN" ? "LOSS" : "WIN",
            },
        } as IntermissionTrigger;
    }

    test("a LOSS side that is ahead uses tier 0", () => {
        const t = trigger(9, "LOSS");
        expect(getSideMessageDifference(t, "white")).toBe(0);
        expect(getSideMessageDifference(t, "black")).toBe(0);
    });

    test("a LOSS side that is behind uses its deficit", () => {
        const t = trigger(-9, "LOSS");
        expect(getSideMessageDifference(t, "white")).toBe(9);
        expect(getSideMessageDifference(t, "black")).toBe(9);
    });

    test("a WIN side that is behind uses tier 0", () => {
        const t = trigger(-9, "WIN");
        expect(getSideMessageDifference(t, "white")).toBe(0);
        expect(getSideMessageDifference(t, "black")).toBe(0);
    });

    test("a WIN side that is ahead uses its lead", () => {
        const t = trigger(9, "WIN");
        expect(getSideMessageDifference(t, "white")).toBe(9);
        expect(getSideMessageDifference(t, "black")).toBe(9);
    });
});

describe("media sources", () => {
    test("keeps the profile first and deduplicates archetypes", () => {
        expect(buildMediaSources("profile-1", ["a", "b", "a"])).toEqual([
            { kind: "profile", profileId: "profile-1" },
            { kind: "archetype", archetypeId: "a" },
            { kind: "archetype", archetypeId: "b" },
        ]);
    });

    test("guests only have archetype sources", () => {
        expect(buildMediaSources(null, ["default"])).toEqual([
            { kind: "archetype", archetypeId: "default" },
        ]);
    });
});

describe("source pairing", () => {
    const profile: MediaSource = { kind: "profile", profileId: "profile-1" };
    const pet: MediaSource = { kind: "archetype", archetypeId: "pet" };

    test("nearest difference also reports its distance", () => {
        expect(pickNearestDifferenceList({ "0": ["zero"], "12": ["twelve"] }, 9)).toEqual({
            list: ["twelve"],
            distance: 3,
        });
        expect(pickNearestDifferenceList({}, 5)).toEqual({
            list: [],
            distance: Number.POSITIVE_INFINITY,
        });
    });

    test("an earlier category beats a later category", () => {
        const best = selectBestMessageCandidate(
            [
                {
                    source: profile,
                    category: "default",
                    categoryIndex: 3,
                    distance: 0,
                    list: ["default"],
                },
                {
                    source: pet,
                    category: "LOSS",
                    categoryIndex: 0,
                    distance: 4,
                    list: ["loss"],
                },
            ],
            () => 0,
        );

        expect(best?.source).toEqual(pet);
        expect(best?.list).toEqual(["loss"]);
    });

    test("the source with the nearest list wins", () => {
        const best = selectBestMessageCandidate(
            [
                {
                    source: profile,
                    category: "LOSS",
                    categoryIndex: 0,
                    distance: 9,
                    list: ["profile"],
                },
                {
                    source: pet,
                    category: "LOSS",
                    categoryIndex: 0,
                    distance: 3,
                    list: ["pet"],
                },
            ],
            () => 0,
        );

        expect(best?.source).toEqual(pet);
        expect(best?.list).toEqual(["pet"]);
    });

    test("ties pick one source and never merge their lists", () => {
        const candidates = [
            {
                source: profile,
                category: "LOSS" as const,
                categoryIndex: 1,
                distance: 0,
                list: ["profile"],
            },
            {
                source: pet,
                category: "LOSS" as const,
                categoryIndex: 1,
                distance: 0,
                list: ["pet"],
            },
        ];

        expect(selectBestMessageCandidate(candidates, () => 0)?.source).toEqual(profile);
        expect(selectBestMessageCandidate(candidates, () => 0.99)?.source).toEqual(pet);
        expect(selectBestMessageCandidate([], () => 0)).toBeNull();
    });
});

describe("messages file serialization", () => {
    test("new files contain only the example, WIN and LOSS", () => {
        const parsed = JSON.parse(serializeMessagesFile(EMPTY_MESSAGES));
        expect(Object.keys(parsed)).toEqual(["//", "WIN", "LOSS"]);
        expect(parsed["//"]).toEqual(MESSAGES_EXAMPLE);
        expect(parsed.WIN).toEqual({});
        expect(parsed.LOSS).toEqual({});
        expect(messagesSchema.safeParse(parsed).success).toBe(true);
    });

    test("preserves non-empty legacy messages", () => {
        const parsed = JSON.parse(
            serializeMessagesFile({
                ...EMPTY_MESSAGES,
                took: ["old took"],
                default: ["old default"],
            }),
        );
        expect(parsed.took).toEqual(["old took"]);
        expect(parsed.default).toEqual(["old default"]);
        expect(messagesSchema.safeParse(parsed).success).toBe(true);
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

    test("scales with the material difference multiplier", () => {
        expect(resolveIntermissionDuration(4000, 1, 1, 2)).toBe(8000);
        expect(resolveIntermissionDuration(4000, 1, 1, 0.5)).toBe(2000);
        expect(resolveIntermissionDuration(4000, 1.5, 3, 2)).toBe(36000);
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
