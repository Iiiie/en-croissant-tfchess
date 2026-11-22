import { isNormal, parseUci } from "chessops";
import type { GameMove } from "@/bindings";
import { positionFromFen } from "@/utils/chessops";
import {
    DEFAULT_ARCHETYPE_ID,
    EMPTY_MESSAGES,
    formatMessage,
    getArchetypeDir,
    getArchetypeImagesDir,
    getProfileDir,
    getProfileImagesDir,
    type ImageCategory,
    listImagesInDir,
    type PieceRole,
    pickRandom,
    readArchetypeMessages,
    readProfileMessages,
} from "@/utils/playerProfile";

export type IntermissionTrigger = {
    kind: "capture" | "check";
    ply: number;
    san: string;
    moveColor: "white" | "black";
    capturedRole: PieceRole | null;
    isCheck: boolean;
    severity: number;
    candidates: {
        white: ImageCategory[];
        black: ImageCategory[];
    };
};

export const PIECE_MULTIPLIERS: Record<PieceRole, number> = {
    pawn: 1,
    knight: 3,
    bishop: 3,
    rook: 5,
    queen: 9,
};

export const CHECK_MULTIPLIER = 2;

export function severityMultiplier(capturedRole: PieceRole | null, isCheck: boolean): number {
    const pieceMultiplier = capturedRole ? PIECE_MULTIPLIERS[capturedRole] : 1;
    return pieceMultiplier + (isCheck ? CHECK_MULTIPLIER : 0);
}

export type IntermissionIntro = {
    kind:
        | "your-piece-captured"
        | "you-captured"
        | "neutral-captured"
        | "your-check"
        | "you-check"
        | "neutral-check";
    piece: PieceRole | null;
    check: boolean;
    color: "white" | "black" | null;
};

/**
 * Builds the one-second intro description.
 * With one human player the text is from that player's perspective; with two
 * humans it stays neutral and uses the color of the captured/checked side.
 */
export function getIntermissionIntro(
    trigger: IntermissionTrigger,
    record: { white: { playerKind: string }; black: { playerKind: string } },
): IntermissionIntro {
    const whiteHuman = record.white.playerKind === "human";
    const blackHuman = record.black.playerKind === "human";
    const humans = (whiteHuman ? 1 : 0) + (blackHuman ? 1 : 0);
    const opponent: "white" | "black" = trigger.moveColor === "white" ? "black" : "white";

    if (humans === 2) {
        if (trigger.kind === "capture") {
            return {
                kind: "neutral-captured",
                piece: trigger.capturedRole,
                check: trigger.isCheck,
                color: opponent,
            };
        }
        return { kind: "neutral-check", piece: null, check: false, color: opponent };
    }

    const humanColor: "white" | "black" = whiteHuman ? "white" : "black";
    if (trigger.kind === "capture") {
        return trigger.moveColor === humanColor
            ? {
                  kind: "you-captured",
                  piece: trigger.capturedRole,
                  check: trigger.isCheck,
                  color: null,
              }
            : {
                  kind: "your-piece-captured",
                  piece: trigger.capturedRole,
                  check: trigger.isCheck,
                  color: null,
              };
    }

    return trigger.moveColor === humanColor
        ? { kind: "you-check", piece: null, check: false, color: null }
        : { kind: "your-check", piece: null, check: false, color: null };
}

export function formatIntermissionIntro(
    intro: IntermissionIntro,
    t: (key: string, options?: Record<string, string>) => string,
): string {
    const piece = intro.piece ? t(`Players.Role.${intro.piece}`) : "";
    const color = intro.color
        ? t(intro.color === "white" ? "Roleplay.White" : "Roleplay.Black")
        : "";
    const text = (() => {
        switch (intro.kind) {
            case "your-piece-captured":
                return t("Roleplay.Intro.YourPieceCaptured", { piece });
            case "you-captured":
                return t("Roleplay.Intro.YouCaptured", { piece });
            case "neutral-captured":
                return t("Roleplay.Intro.NeutralCaptured", { color, piece });
            case "your-check":
                return t("Roleplay.Intro.YourCheck");
            case "you-check":
                return t("Roleplay.Intro.YouCheck");
            case "neutral-check":
                return t("Roleplay.Intro.NeutralCheck", { color });
        }
    })();
    return intro.check ? `${text} ${t("Roleplay.Intro.CheckSuffix")}` : text;
}

function capturedRoleFromMove(fenBefore: string, uci: string): PieceRole | null {
    const [position] = positionFromFen(fenBefore);
    const move = parseUci(uci);
    if (!position || !move || !isNormal(move)) {
        return null;
    }

    const captured = position.board.get(move.to);
    if (captured) {
        return captured.role === "king" ? null : captured.role;
    }

    if (position.epSquare === move.to && position.board.get(move.from)?.role === "pawn") {
        return "pawn";
    }

    return null;
}

export function getIntermissionTrigger(args: {
    initialFen: string;
    moves: GameMove[];
    moveIndex: number;
}): IntermissionTrigger | null {
    const move = args.moves[args.moveIndex];
    if (!move) {
        return null;
    }

    const fenBefore =
        args.moveIndex === 0 ? args.initialFen : args.moves[args.moveIndex - 1]?.fenAfter;
    if (!fenBefore) {
        return null;
    }

    const [positionBefore] = positionFromFen(fenBefore);
    const [positionAfter] = positionFromFen(move.fenAfter);
    if (!positionBefore || !positionAfter) {
        return null;
    }

    if (positionAfter.isCheckmate()) {
        return null;
    }

    const capture = move.san.includes("x");
    const check = positionAfter.isCheck();
    if (!capture && !check) {
        return null;
    }

    const moveColor = positionBefore.turn;
    const opponent = moveColor === "white" ? "black" : "white";
    const capturedRole = capture ? capturedRoleFromMove(fenBefore, move.uci) : null;
    const candidates: IntermissionTrigger["candidates"] = {
        white: [],
        black: [],
    };

    if (capture) {
        candidates[moveColor].push("took");
        candidates[opponent].push("lost");
        if (check) {
            candidates[moveColor].push("check");
            candidates[opponent].push("checked");
        }
    } else {
        candidates[moveColor].push("check");
        candidates[opponent].push("checked");
    }

    candidates[moveColor].push("default");
    candidates[opponent].push("default");

    return {
        kind: capture ? "capture" : "check",
        ply: args.moveIndex + 1,
        san: move.san,
        moveColor,
        capturedRole,
        isCheck: check,
        severity: severityMultiplier(capturedRole, check),
        candidates,
    };
}

async function imagesForCategory(args: {
    profileId: string | null;
    archetypeIds: string[];
    category: ImageCategory;
    role: PieceRole | null;
}): Promise<string[]> {
    const lists: string[][] = [];
    if (args.profileId) {
        lists.push(
            await listImagesInDir(
                await getProfileImagesDir(args.profileId, args.category, args.role),
            ),
        );
    }
    for (const archetypeId of args.archetypeIds) {
        lists.push(
            await listImagesInDir(
                await getArchetypeImagesDir(archetypeId, args.category, args.role),
            ),
        );
    }
    return lists.flat();
}

export async function pickProfileImage(args: {
    profileId: string | null;
    archetypeIds: string[];
    trigger: IntermissionTrigger;
    side: "white" | "black";
}): Promise<{ path: string | null; category: ImageCategory | null; folder: string | null }> {
    const archetypeIds = args.archetypeIds;
    const folder = args.profileId
        ? await getProfileDir(args.profileId)
        : await getArchetypeDir(archetypeIds[0] ?? DEFAULT_ARCHETYPE_ID);

    for (const category of args.trigger.candidates[args.side]) {
        const roles: (PieceRole | null)[] = [];
        const role = category === "took" || category === "lost" ? args.trigger.capturedRole : null;
        if (role) {
            roles.push(role);
        }
        roles.push(null);

        for (const candidateRole of roles) {
            const images = await imagesForCategory({
                profileId: args.profileId,
                archetypeIds,
                category,
                role: candidateRole,
            });
            if (images.length > 0) {
                return { path: pickRandom(images), category, folder };
            }
        }
    }

    return { path: null, category: null, folder };
}

export async function pickProfileMessage(args: {
    profileId: string | null;
    archetypeIds: string[];
    trigger: IntermissionTrigger;
    side: "white" | "black";
    playerName: string;
    opponentName: string;
}): Promise<{ message: string | null; category: ImageCategory | null }> {
    const archetypeIds = args.archetypeIds;
    const profileMessages = args.profileId
        ? await readProfileMessages(args.profileId)
        : EMPTY_MESSAGES;
    const archetypeMessages = await Promise.all(
        archetypeIds.map((archetypeId) => readArchetypeMessages(archetypeId)),
    );

    for (const category of args.trigger.candidates[args.side]) {
        const pool = [
            ...profileMessages[category],
            ...archetypeMessages.flatMap((messages) => messages[category]),
        ];
        if (pool.length > 0) {
            const template = pickRandom(pool);
            if (template) {
                return {
                    message: formatMessage(template, {
                        piece: args.trigger.capturedRole,
                        player: args.playerName,
                        opponent: args.opponentName,
                        color: args.side,
                    }),
                    category,
                };
            }
        }
    }

    return { message: null, category: null };
}

export function resolveIntermissionDuration(
    baseDurationMs: number,
    vulnerability: number,
    severity = 1,
): number {
    const multiplier = Math.max(0, vulnerability) * Math.max(1, severity);
    return Math.max(1000, Math.round(baseDurationMs * multiplier));
}
