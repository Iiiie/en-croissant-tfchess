import type { MantineColor } from "@mantine/core";
import { info, warn } from "@tauri-apps/plugin-log";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
    commands,
    type GameMoveEvent,
    type GameResult,
    type GameState,
    type Outcome,
} from "@/bindings";
import type { OpponentSettings } from "@/components/boards/OpponentForm";
import { TreeStateContext } from "@/components/common/TreeStateContext";
import {
    type IntermissionPayload,
    type IntermissionSidePayload,
} from "@/components/roleplay/intermissionWindow";
import {
    currentChatAtom,
    currentGamePausedAtom,
    currentGameRecordAtom,
    archetypesAtom,
    currentIntermissionLogAtom,
    fontSizeAtom,
    gameNarrativeModeAtom,
    intermissionDisplayAtom,
    playerProfilesAtom,
    primaryColorAtom,
    roleplayBaseDurationAtom,
    roleplayIntermissionThresholdAtom,
    roleplayMaterialDurationMultiplierAtom,
    roleplayPulseMinBpmAtom,
    roleplayPulseMaxBpmAtom,
    roleplayEnabledAtom,
    roleplayWinIntermissionsAtom,
} from "@/state/atoms";
import { getPGN } from "@/utils/chess";
import i18n from "@/i18n";
import {
    appendProfileHistory,
    buildHistoryEntry,
    type ChatMessage,
    createGameRecord,
    DEFAULT_ARCHETYPE_ID,
    DEFAULT_ARCHETYPES,
    ensureArchetypesStorage,
    ensureSharedStorage,
    type GameRecord,
    type GameSide,
    type IntermissionEndReason,
    type IntermissionRecord,
    type PlayerProfile,
    snapshotPlayer,
    updateStats,
} from "@/utils/playerProfile";
import {
    getIntermissionTrigger,
    type IntermissionTrigger,
    formatIntermissionIntro,
    getIntermissionIntro,
    getMoverMaterialDiff,
    materialDurationMultiplier,
    pickProfileImage,
    pickProfileMessage,
    resolveIntermissionDuration,
    type SideOutcome,
    shouldPlayIntermission,
} from "@/utils/roleplay";
import { unwrap } from "@/utils/unwrap";

type ActiveSide = {
    profileId: string | null;
    profileName: string;
    image: string | null;
    message: string | null;
    durationMs: number;
    severity: number;
    outcome: SideOutcome;
    difference: number;
    category: string | null;
    folder: string | null;
    endedAt: number | null;
    reason: IntermissionEndReason | null;
};

type ActiveIntermission = {
    id: string;
    trigger: IntermissionTrigger;
    startedAt: number;
    record: IntermissionRecord;
    payload: IntermissionPayload;
    white: ActiveSide;
    black: ActiveSide;
};

function systemMessage(text: string, ply: number): ChatMessage {
    return {
        id: crypto.randomUUID(),
        kind: "system",
        authorProfileId: null,
        authorSide: null,
        authorName: "System",
        text,
        timestamp: Date.now(),
        ply,
    };
}

function formatTimeControl(settings: OpponentSettings): string {
    if (!settings.timeControl) {
        return "-";
    }
    const seconds = settings.timeControl.seconds / 1000;
    const increment = (settings.timeControl.increment ?? 0) / 1000;
    return increment ? `${seconds}+${increment}` : `${seconds}`;
}

function gameResultToOutcome(result: GameResult): Outcome {
    if (result.type === "whiteWins") {
        return "1-0";
    }
    if (result.type === "blackWins") {
        return "0-1";
    }
    return "1/2-1/2";
}

function profilePick(profile: PlayerProfile | null) {
    return {
        profileId: profile?.id ?? null,
        // Guests pull from the shared default archetype; profiles pull from the
        // archetypes ticked in their profile (possibly none).
        archetypeIds: profile ? profile.archetypeIds : [DEFAULT_ARCHETYPE_ID],
    };
}

export function useRoleplayGame({
    gameId,
    gameState,
    setWhiteTime,
    setBlackTime,
}: {
    gameId: string | null;
    gameState: "settingUp" | "playing" | "gameOver";
    setWhiteTime: (value: number | null) => void;
    setBlackTime: (value: number | null) => void;
}) {
    const store = useContext(TreeStateContext)!;
    const [profilesValue, setProfiles] = useAtom(playerProfilesAtom);
    const profiles = useMemo(() => profilesValue ?? [], [profilesValue]);
    const [archetypesValue] = useAtom(archetypesAtom);
    const archetypes = useMemo(() => archetypesValue ?? DEFAULT_ARCHETYPES, [archetypesValue]);
    const roleplayEnabled = useAtomValue(roleplayEnabledAtom);
    const winIntermissions = useAtomValue(roleplayWinIntermissionsAtom);
    const gameNarrativeMode = useAtomValue(gameNarrativeModeAtom);
    const intermissionDisplay = useAtomValue(intermissionDisplayAtom);
    const materialThreshold = useAtomValue(roleplayIntermissionThresholdAtom);
    const materialDurationSetting = useAtomValue(roleplayMaterialDurationMultiplierAtom);
    const baseDuration = useAtomValue(roleplayBaseDurationAtom);
    const pulseMin = useAtomValue(roleplayPulseMinBpmAtom);
    const pulseMax = useAtomValue(roleplayPulseMaxBpmAtom);
    const primaryColor = useAtomValue(primaryColorAtom) as MantineColor;
    const fontSize = useAtomValue(fontSizeAtom);

    const [gameRecord, setGameRecord] = useAtom(currentGameRecordAtom);
    const [chat, setChat] = useAtom(currentChatAtom);
    const [intermissionLog, setIntermissionLog] = useAtom(currentIntermissionLogAtom);
    const [isPaused, setIsPaused] = useAtom(currentGamePausedAtom);
    const [active, setActive] = useState<ActiveIntermission | null>(null);

    const activeRef = useRef<ActiveIntermission | null>(null);
    const gameRecordRef = useRef<GameRecord | null>(null);
    const gameIdRef = useRef<string | null>(gameId);
    const initialFenRef = useRef<string>("");
    const lastProcessedPlyRef = useRef(0);
    const savedRef = useRef(false);
    const startingRef = useRef<symbol | null>(null);
    const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        gameRecordRef.current = gameRecord;
    }, [gameRecord]);

    useEffect(() => {
        gameIdRef.current = gameId;
    }, [gameId]);

    const clearWatchdog = useCallback(() => {
        if (watchdogRef.current) {
            clearTimeout(watchdogRef.current);
            watchdogRef.current = null;
        }
    }, []);

    const resumeClock = useCallback(async () => {
        try {
            const state = unwrap(await commands.resumeGameClock(gameIdRef.current ?? ""));
            setIsPaused(false);
            setWhiteTime(state.whiteTime !== null ? Number(state.whiteTime) : null);
            setBlackTime(state.blackTime !== null ? Number(state.blackTime) : null);
        } catch {
            setIsPaused(false);
        }
    }, [setIsPaused, setWhiteTime, setBlackTime]);

    const finishIntermission = useCallback(
        async (activeIntermission: ActiveIntermission) => {
            clearWatchdog();

            const endedAt = Date.now();
            const record: IntermissionRecord = {
                ...activeIntermission.record,
                endedAt,
                white: {
                    ...activeIntermission.record.white,
                    endedAt: activeIntermission.white.endedAt,
                    reason: activeIntermission.white.reason,
                },
                black: {
                    ...activeIntermission.record.black,
                    endedAt: activeIntermission.black.endedAt,
                    reason: activeIntermission.black.reason,
                },
            };

            setIntermissionLog((prev) => [...prev, record]);
            setChat((prev) => [
                ...prev,
                systemMessage(
                    `Intermission ended (${activeIntermission.trigger.san})`,
                    activeIntermission.trigger.ply,
                ),
            ]);

            activeRef.current = null;
            setActive(null);
            await resumeClock();
        },
        [clearWatchdog, resumeClock, setIntermissionLog, setChat],
    );

    const completeSide = useCallback(
        (activeIntermission: ActiveIntermission, side: GameSide, reason: IntermissionEndReason) => {
            if (activeIntermission[side].endedAt !== null) {
                return;
            }
            const endedAt = Date.now();
            const next: ActiveIntermission = {
                ...activeIntermission,
                [side]: { ...activeIntermission[side], endedAt, reason },
            };
            activeRef.current = next;
            setActive(next);

            if (next.white.endedAt !== null && next.black.endedAt !== null) {
                void finishIntermission(next);
            }
        },
        [finishIntermission],
    );

    const startIntermission = useCallback(
        async (trigger: IntermissionTrigger) => {
            const record = gameRecordRef.current;
            if (!record || !record.narrative || activeRef.current || startingRef.current) {
                return;
            }

            if (!shouldPlayIntermission(trigger.materialDiff, materialThreshold)) {
                // The backend pauses on every capture/check, so a skipped
                // intermission must give the clock back.
                await resumeClock();
                return;
            }

            const token = Symbol("intermission");
            startingRef.current = token;

            try {
                // Pause before looking up media, otherwise the engine gets a free
                // move (and can even start a second intermission) while we read
                // the filesystem.
                try {
                    const state = unwrap(await commands.pauseGameClock(gameIdRef.current ?? ""));
                    setIsPaused(true);
                    setWhiteTime(state.whiteTime !== null ? Number(state.whiteTime) : null);
                    setBlackTime(state.blackTime !== null ? Number(state.blackTime) : null);
                } catch {
                    // If the frontend pause failed but the backend already paused
                    // for this intermission, make sure we don't leave it frozen.
                    void resumeClock();
                    return;
                }

                if (savedRef.current || gameRecordRef.current !== record) {
                    return;
                }

                info(`[intermission] start ${trigger.san} (severity ${trigger.severity})`);

                const player1Side = record.player1Side;
                const displayWhite =
                    intermissionDisplay === "both" ||
                    (intermissionDisplay === "player1"
                        ? player1Side === "white"
                        : player1Side === "black");
                const displayBlack =
                    intermissionDisplay === "both" ||
                    (intermissionDisplay === "player1"
                        ? player1Side === "black"
                        : player1Side === "white");
                const whiteIsWin = trigger.outcome.white === "WIN";
                const showWhite = displayWhite && (winIntermissions || !whiteIsWin);
                const showBlack = displayBlack && (winIntermissions || whiteIsWin);

                if (!showWhite && !showBlack) {
                    // Nothing to show for this side/mode: don't hold the clock.
                    await resumeClock();
                    return;
                }

                const materialMultiplier = materialDurationMultiplier(
                    getMoverMaterialDiff(trigger.materialDiff, trigger.moveColor),
                    materialDurationSetting,
                );
                // Vulnerability only scales the player who is receiving the
                // LOSS intermission; the WIN side uses a neutral 1x.
                const whiteVulnerability =
                    trigger.outcome.white === "LOSS" ? record.white.vulnerability : 1;
                const blackVulnerability =
                    trigger.outcome.black === "LOSS" ? record.black.vulnerability : 1;
                const whiteProfile = profiles.find((p) => p.id === record.white.profileId) ?? null;
                const blackProfile = profiles.find((p) => p.id === record.black.profileId) ?? null;
                const whiteDuration = showWhite
                    ? resolveIntermissionDuration(
                          baseDuration,
                          whiteVulnerability,
                          trigger.severity,
                          materialMultiplier,
                      )
                    : 0;
                const blackDuration = showBlack
                    ? resolveIntermissionDuration(
                          baseDuration,
                          blackVulnerability,
                          trigger.severity,
                          materialMultiplier,
                      )
                    : 0;

                const [whiteImage, blackImage, whiteMessage, blackMessage] = await Promise.all([
                    showWhite
                        ? pickProfileImage({ ...profilePick(whiteProfile), trigger, side: "white" })
                        : Promise.resolve({ path: null, category: null, folder: null }),
                    showBlack
                        ? pickProfileImage({ ...profilePick(blackProfile), trigger, side: "black" })
                        : Promise.resolve({ path: null, category: null, folder: null }),
                    showWhite
                        ? pickProfileMessage({
                              ...profilePick(whiteProfile),
                              trigger,
                              side: "white",
                              playerName: record.white.name,
                              opponentName: record.black.name,
                          })
                        : Promise.resolve({ message: null, category: null }),
                    showBlack
                        ? pickProfileMessage({
                              ...profilePick(blackProfile),
                              trigger,
                              side: "black",
                              playerName: record.black.name,
                              opponentName: record.white.name,
                          })
                        : Promise.resolve({ message: null, category: null }),
                ]);

                if (showWhite) {
                    if (whiteImage.path) {
                        info(`[intermission] white ${whiteImage.category}: ${whiteImage.path}`);
                    } else {
                        warn(`[intermission] white: no media in ${whiteImage.folder ?? "?"}`);
                    }
                }
                if (showBlack) {
                    if (blackImage.path) {
                        info(`[intermission] black ${blackImage.category}: ${blackImage.path}`);
                    } else {
                        warn(`[intermission] black: no media in ${blackImage.folder ?? "?"}`);
                    }
                }

                const id = crypto.randomUUID();
                const startedAt = Date.now();

                const sides: { white: IntermissionSidePayload; black: IntermissionSidePayload } = {
                    white: {
                        side: "white",
                        profileName: record.white.name,
                        image: whiteImage.path,
                        message: whiteMessage.message,
                        durationMs: whiteDuration,
                        severity: trigger.severity,
                        outcome: trigger.outcome.white,
                        difference: trigger.magnitude,
                        category: whiteImage.category,
                        folder: whiteImage.folder,
                    },
                    black: {
                        side: "black",
                        profileName: record.black.name,
                        image: blackImage.path,
                        message: blackMessage.message,
                        durationMs: blackDuration,
                        severity: trigger.severity,
                        outcome: trigger.outcome.black,
                        difference: trigger.magnitude,
                        category: blackImage.category,
                        folder: blackImage.folder,
                    },
                };

                const pulseBpm = Math.round(
                    Math.min(pulseMin, pulseMax) + Math.random() * Math.abs(pulseMax - pulseMin),
                );

                const payload: IntermissionPayload = {
                    id,
                    title: `Intermission — ${trigger.san}`,
                    intro: formatIntermissionIntro(
                        getIntermissionIntro(trigger, record),
                        (key, options) => i18n.t(key, options),
                    ),
                    pulseBpm,
                    primaryColor,
                    fontSize,
                    kind: trigger.kind,
                    san: trigger.san,
                    ply: trigger.ply,
                    materialDiff: trigger.materialDiff,
                    show: { white: showWhite, black: showBlack },
                    sides,
                };

                const activeIntermission: ActiveIntermission = {
                    id,
                    payload,
                    trigger,
                    startedAt,
                    record: {
                        id,
                        kind: trigger.kind,
                        ply: trigger.ply,
                        san: trigger.san,
                        startedAt,
                        endedAt: null,
                        severity: trigger.severity,
                        materialDiff: trigger.materialDiff,
                        white: {
                            profileId: record.white.profileId,
                            profileName: record.white.name,
                            image: whiteImage.path,
                            message: whiteMessage.message,
                            durationMs: whiteDuration,
                            outcome: trigger.outcome.white,
                            difference: trigger.magnitude,
                            endedAt: showWhite ? null : startedAt,
                            reason: showWhite ? null : "skipped",
                        },
                        black: {
                            profileId: record.black.profileId,
                            profileName: record.black.name,
                            image: blackImage.path,
                            message: blackMessage.message,
                            durationMs: blackDuration,
                            outcome: trigger.outcome.black,
                            difference: trigger.magnitude,
                            endedAt: showBlack ? null : startedAt,
                            reason: showBlack ? null : "skipped",
                        },
                    },
                    white: {
                        profileId: record.white.profileId,
                        profileName: record.white.name,
                        image: whiteImage.path,
                        message: whiteMessage.message,
                        durationMs: whiteDuration,
                        severity: trigger.severity,
                        outcome: trigger.outcome.white,
                        difference: trigger.magnitude,
                        category: whiteImage.category,
                        folder: whiteImage.folder,
                        endedAt: showWhite ? null : startedAt,
                        reason: showWhite ? null : "skipped",
                    },
                    black: {
                        profileId: record.black.profileId,
                        profileName: record.black.name,
                        image: blackImage.path,
                        message: blackMessage.message,
                        durationMs: blackDuration,
                        severity: trigger.severity,
                        outcome: trigger.outcome.black,
                        difference: trigger.magnitude,
                        category: blackImage.category,
                        folder: blackImage.folder,
                        endedAt: showBlack ? null : startedAt,
                        reason: showBlack ? null : "skipped",
                    },
                };

                if (savedRef.current || gameRecordRef.current !== record) {
                    return;
                }

                activeRef.current = activeIntermission;
                setActive(activeIntermission);
                setChat((prev) => [
                    ...prev,
                    systemMessage(`Intermission: ${trigger.san}`, trigger.ply),
                ]);

                clearWatchdog();
                const maxDuration = Math.max(whiteDuration, blackDuration);
                const watchdogDelay = Math.min(maxDuration + 12_000, 2_147_483_647);
                watchdogRef.current = setTimeout(() => {
                    for (let i = 0; i < 2; i++) {
                        const current = activeRef.current;
                        if (!current) {
                            break;
                        }
                        const side =
                            current.white.endedAt === null
                                ? "white"
                                : current.black.endedAt === null
                                  ? "black"
                                  : null;
                        if (!side) {
                            break;
                        }
                        completeSide(current, side, "failed");
                    }
                }, watchdogDelay);
            } catch (error) {
                // Any intermission failure must never leave the game paused or
                // end the match; just log it and resume the clock.
                warn(`[intermission] failed: ${String(error)}`);
                activeRef.current = null;
                setActive(null);
                await resumeClock();
            } finally {
                if (startingRef.current === token) {
                    startingRef.current = null;
                }
            }
        },
        [
            baseDuration,
            pulseMin,
            pulseMax,
            intermissionDisplay,
            winIntermissions,
            materialThreshold,
            materialDurationSetting,
            primaryColor,
            fontSize,
            profiles,
            setWhiteTime,
            setBlackTime,
            setChat,
            setIsPaused,
            completeSide,
            clearWatchdog,
            resumeClock,
        ],
    );

    const endSide = useCallback(
        (side: GameSide, reason: IntermissionEndReason) => {
            const current = activeRef.current;
            if (current) {
                completeSide(current, side, reason);
            }
        },
        [completeSide],
    );

    const handleMove = useCallback(
        (payload: GameMoveEvent) => {
            const moves = payload.moves;
            if (moves.length < lastProcessedPlyRef.current) {
                // A take-back shortened the move list; resync so later moves can
                // still trigger intermissions.
                lastProcessedPlyRef.current = moves.length;
            }
            if (moves.length <= lastProcessedPlyRef.current) {
                return;
            }
            lastProcessedPlyRef.current = moves.length;

            if (!payload.intermission) {
                return;
            }

            const record = gameRecordRef.current;
            if (
                !record ||
                !record.narrative ||
                activeRef.current ||
                startingRef.current ||
                gameState !== "playing"
            ) {
                // The backend paused for an intermission but the frontend can't
                // play one: never leave the clock frozen.
                if (!activeRef.current && !startingRef.current) {
                    void resumeClock();
                }
                return;
            }

            const moveIndex = moves.length - 1;
            const trigger = getIntermissionTrigger({
                initialFen: initialFenRef.current,
                moves,
                moveIndex,
            });

            if (!trigger) {
                void resumeClock();
                return;
            }

            void startIntermission(trigger);
        },
        [gameState, resumeClock, startIntermission],
    );

    const beginGame = useCallback(
        (
            playerSettings: { white: OpponentSettings; black: OpponentSettings },
            state: GameState,
            player1Side: GameSide,
        ) => {
            const whiteProfile =
                profiles.find((p) => p.id === playerSettings.white.profileId) ?? null;
            const blackProfile =
                profiles.find((p) => p.id === playerSettings.black.profileId) ?? null;
            const white = snapshotPlayer(
                whiteProfile,
                playerSettings.white.name ?? "Player",
                formatTimeControl(playerSettings.white),
            );
            const black = snapshotPlayer(
                blackProfile,
                playerSettings.black.name ?? "Player",
                formatTimeControl(playerSettings.black),
            );
            const record = createGameRecord({
                id: crypto.randomUUID(),
                gameId: state.gameId,
                white,
                black,
                narrative: roleplayEnabled && gameNarrativeMode,
                player1Side,
            });

            gameRecordRef.current = record;
            initialFenRef.current = state.initialFen;
            lastProcessedPlyRef.current = state.moves.length;
            savedRef.current = false;
            activeRef.current = null;
            startingRef.current = null;
            clearWatchdog();

            setGameRecord(record);
            setActive(null);
            setIsPaused(state.paused);
            setWhiteTime(state.whiteTime !== null ? Number(state.whiteTime) : null);
            setBlackTime(state.blackTime !== null ? Number(state.blackTime) : null);
            setChat([]);
            setIntermissionLog([]);
            void ensureArchetypesStorage(archetypes);
            return record;
        },
        [
            profiles,
            archetypes,
            roleplayEnabled,
            gameNarrativeMode,
            clearWatchdog,
            setGameRecord,
            setActive,
            setIsPaused,
            setWhiteTime,
            setBlackTime,
            setChat,
            setIntermissionLog,
        ],
    );

    const restoreGame = useCallback(
        (record: GameRecord, state: GameState) => {
            gameRecordRef.current = record;
            initialFenRef.current = state.initialFen;
            lastProcessedPlyRef.current = state.moves.length;
            savedRef.current = false;
            activeRef.current = null;
            startingRef.current = null;
            clearWatchdog();

            setGameRecord(record);
            setActive(null);
            setIsPaused(state.paused);
            setWhiteTime(state.whiteTime !== null ? Number(state.whiteTime) : null);
            setBlackTime(state.blackTime !== null ? Number(state.blackTime) : null);
            setChat([]);
            setIntermissionLog([]);
            void ensureArchetypesStorage(archetypes);
        },
        [
            archetypes,
            clearWatchdog,
            setGameRecord,
            setActive,
            setIsPaused,
            setWhiteTime,
            setBlackTime,
            setChat,
            setIntermissionLog,
        ],
    );

    const cancelGame = useCallback(() => {
        clearWatchdog();
        // Abort any intermission that is still looking up media.
        savedRef.current = true;
        startingRef.current = null;
        activeRef.current = null;
        setActive(null);
        setIsPaused(false);
    }, [clearWatchdog, setActive, setIsPaused]);

    const togglePause = useCallback(async () => {
        if (!gameId || activeRef.current || startingRef.current) {
            return;
        }

        if (isPaused) {
            const state = unwrap(await commands.resumeGameClock(gameId));
            setIsPaused(false);
            setWhiteTime(state.whiteTime !== null ? Number(state.whiteTime) : null);
            setBlackTime(state.blackTime !== null ? Number(state.blackTime) : null);
        } else {
            const state = unwrap(await commands.pauseGameClock(gameId));
            setIsPaused(true);
            setWhiteTime(state.whiteTime !== null ? Number(state.whiteTime) : null);
            setBlackTime(state.blackTime !== null ? Number(state.blackTime) : null);
        }
    }, [gameId, isPaused, setWhiteTime, setBlackTime, setIsPaused]);

    const sendChat = useCallback(
        (side: GameSide, text: string) => {
            const record = gameRecordRef.current;
            const snapshot = record?.[side];
            const trimmed = text.trim();
            if (!trimmed) {
                return;
            }

            const message: ChatMessage = {
                id: crypto.randomUUID(),
                kind: "message",
                authorProfileId: snapshot?.profileId ?? null,
                authorSide: side,
                authorName: snapshot?.name ?? (side === "white" ? "White" : "Black"),
                text: trimmed,
                timestamp: Date.now(),
                ply: lastProcessedPlyRef.current,
            };
            setChat((prev) => [...prev, message]);
        },
        [setChat],
    );

    const handleGameOver = useCallback(
        async (result: GameResult | null) => {
            const record = gameRecordRef.current;
            if (!record || savedRef.current) {
                return;
            }
            savedRef.current = true;
            startingRef.current = null;
            clearWatchdog();
            info(`[roleplay] game over: ${result ? JSON.stringify(result) : "aborted"}`);

            const outcome: Outcome = result ? gameResultToOutcome(result) : "*";
            const reason = result ? String(result.reason) : "aborted";
            const state = store.getState();
            const pgn = getPGN(state.root, {
                headers: state.headers,
                glyphs: true,
                comments: true,
                variations: true,
                extraMarkups: true,
                root: true,
                path: null,
            });
            const endedAt = Date.now();
            const activeNow = activeRef.current;
            const intermissions = activeNow
                ? [...intermissionLog, { ...activeNow.record, endedAt }]
                : intermissionLog;
            const updates: {
                id: string;
                entry: ReturnType<typeof buildHistoryEntry>;
            }[] = [];

            for (const side of ["white", "black"] as const) {
                const snapshot = record[side];
                if (!snapshot.profileId) {
                    continue;
                }
                const entry = buildHistoryEntry({
                    record,
                    side,
                    result: outcome,
                    reason,
                    pgn,
                    chat,
                    intermissions,
                    endedAt,
                });
                await appendProfileHistory(snapshot.profileId, entry);
                updates.push({ id: snapshot.profileId, entry });
            }

            if (updates.length > 0) {
                setProfiles(async (prev) => {
                    const list = await prev;
                    return list.map((profile) => {
                        const update = updates.find((item) => item.id === profile.id);
                        if (!update) {
                            return profile;
                        }
                        return {
                            ...profile,
                            elo: update.entry.eloAfter,
                            stats: updateStats(profile.stats, update.entry.playerScore),
                            updatedAt: Date.now(),
                        };
                    });
                });
            }

            activeRef.current = null;
            setActive(null);
            setIsPaused(false);
        },
        [store, chat, intermissionLog, clearWatchdog, setProfiles, setActive, setIsPaused],
    );

    useEffect(() => {
        void ensureSharedStorage();

        return () => {
            const wasActive = activeRef.current || startingRef.current;
            savedRef.current = true;
            startingRef.current = null;
            activeRef.current = null;
            clearWatchdog();
            // Leaving the board tab with an intermission open (or being looked up)
            // must not leave the backend clock frozen.
            if (wasActive && gameIdRef.current) {
                void commands.resumeGameClock(gameIdRef.current);
            }
        };
    }, [clearWatchdog]);

    return {
        gameRecord,
        chat,
        intermissionLog,
        isPaused,
        active,
        setPaused: setIsPaused,
        togglePause,
        beginGame,
        restoreGame,
        endSide,
        handleMove,
        handleGameOver,
        cancelGame,
        sendChat,
    };
}
