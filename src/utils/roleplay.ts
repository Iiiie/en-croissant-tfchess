import { resolve } from "@tauri-apps/api/path";
import { isNormal, parseUci } from "chessops";
import type { GameMove } from "@/bindings";
import { getMaterialDiff } from "@/utils/chess";
import { positionFromFen } from "@/utils/chessops";
import {
    DEFAULT_ARCHETYPE_ID,
    type DifferenceMessages,
    formatMessage,
    getArchetypeDir,
    getArchetypeImagesDir,
    getProfileDir,
    getProfileImagesDir,
    type ImageCategory,
    isOutcomeCategory,
    listImagesInDir,
    listSubdirectories,
    type PieceRole,
    type PlayerMessages,
    pickRandom,
    readArchetypeMessages,
    readProfileMessages,
} from "@/utils/playerProfile";

export type SideOutcome = "WIN" | "LOSS";

export type IntermissionTrigger = {
    kind: "capture" | "check";
    ply: number;
    san: string;
    moveColor: "white" | "black";
    capturedRole: PieceRole | null;
    isCheck: boolean;
    severity: number;
    /** Material balance after the move: white material minus black material. */
    materialDiff: number;
    /** Absolute material difference after the move. */
    magnitude: number;
    outcome: {
        white: SideOutcome;
        black: SideOutcome;
    };
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

export function getMoverMaterialDiff(materialDiff: number, moveColor: "white" | "black"): number {
    return moveColor === "white" ? materialDiff : -materialDiff;
}

export function materialDurationMultiplier(moverDiff: number, setting: number): number {
    const safeSetting = Math.max(0, setting);
    return Math.max(0, 1 + (moverDiff * safeSetting) / 2);
}

export function shouldPlayIntermission(materialDiff: number, threshold: number): boolean {
    return Math.abs(materialDiff) >= Math.max(0, threshold);
}

export type DifferenceRange = {
    min: number;
    max: number;
};

export function parseDifferenceRange(name: string): DifferenceRange | null {
    const trimmed = name.trim();
    if (!trimmed) {
        return null;
    }

    const range = /^(\d+)\s*-\s*(\d+)$/.exec(trimmed);
    if (range) {
        const first = Number(range[1]);
        const second = Number(range[2]);
        if (Number.isFinite(first) && Number.isFinite(second)) {
            return { min: Math.min(first, second), max: Math.max(first, second) };
        }
    }

    const single = /^(\d+)$/.exec(trimmed);
    if (single) {
        const value = Number(single[1]);
        return Number.isFinite(value) ? { min: value, max: value } : null;
    }

    const open = /^(\d+)\s*\+$/.exec(trimmed);
    if (open) {
        const value = Number(open[1]);
        return Number.isFinite(value) ? { min: value, max: Number.POSITIVE_INFINITY } : null;
    }

    return null;
}

function rangeSpecificity(range: DifferenceRange): number {
    return Number.isFinite(range.max) ? range.max - range.min : Number.MAX_SAFE_INTEGER;
}

export type MediaSource =
    | { kind: "profile"; profileId: string }
    | { kind: "archetype"; archetypeId: string };

export function buildMediaSources(profileId: string | null, archetypeIds: string[]): MediaSource[] {
    const sources: MediaSource[] = [];
    if (profileId) {
        sources.push({ kind: "profile", profileId });
    }

    const seen = new Set<string>();
    for (const archetypeId of archetypeIds) {
        if (seen.has(archetypeId)) {
            continue;
        }
        seen.add(archetypeId);
        sources.push({ kind: "archetype", archetypeId });
    }

    return sources;
}

export type NearestDifferenceList = {
    list: string[];
    distance: number;
};

export function pickNearestDifferenceList(
    messages: DifferenceMessages,
    difference: number,
): NearestDifferenceList {
    const target = Math.abs(difference);
    const candidates = Object.entries(messages)
        .map(([key, list]) => ({ key, value: Number(key), list }))
        .filter((entry) => Number.isFinite(entry.value) && entry.list.length > 0);

    if (candidates.length === 0) {
        return { list: [], distance: Number.POSITIVE_INFINITY };
    }

    candidates.sort((a, b) => {
        const distance = Math.abs(a.value - target) - Math.abs(b.value - target);
        return distance !== 0 ? distance : b.value - a.value;
    });

    const best = candidates[0];
    return { list: best.list, distance: Math.abs(best.value - target) };
}

export function pickNearestDifferenceMessages(
    messages: DifferenceMessages,
    difference: number,
): string[] {
    return pickNearestDifferenceList(messages, difference).list;
}

export type MessageSourceCandidate = {
    source: MediaSource;
    category: ImageCategory;
    categoryIndex: number;
    distance: number;
    list: string[];
};

export function selectBestMessageCandidate(
    candidates: MessageSourceCandidate[],
    random: () => number = Math.random,
): MessageSourceCandidate | null {
    if (candidates.length === 0) {
        return null;
    }

    const minCategoryIndex = Math.min(...candidates.map((candidate) => candidate.categoryIndex));
    const categoryCandidates = candidates.filter(
        (candidate) => candidate.categoryIndex === minCategoryIndex,
    );
    const minDistance = Math.min(...categoryCandidates.map((candidate) => candidate.distance));
    const best = categoryCandidates.filter((candidate) => candidate.distance === minDistance);
    const index = Math.min(best.length - 1, Math.floor(random() * best.length));
    return best[index];
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
    const materialDiff = getMaterialDiff(move.fenAfter)?.diff ?? 0;
    const magnitude = Math.abs(materialDiff);
    const outcome: IntermissionTrigger["outcome"] =
        moveColor === "white" ? { white: "WIN", black: "LOSS" } : { white: "LOSS", black: "WIN" };
    const candidates: IntermissionTrigger["candidates"] = {
        white: [],
        black: [],
    };

    // The side that made the triggering move always gets WIN; the other side
    // always gets LOSS. This is independent of who is ahead overall.
    candidates[moveColor].push(outcome[moveColor]);
    candidates[opponent].push(outcome[opponent]);

    if (capture) {
        candidates[moveColor].push("took");
        candidates[opponent].push("lost");
    }
    if (check) {
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
        materialDiff,
        magnitude,
        outcome,
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

async function categoryRoots(args: {
    profileId: string | null;
    archetypeIds: string[];
    category: ImageCategory;
}): Promise<string[]> {
    const roots: string[] = [];
    if (args.profileId) {
        roots.push(await getProfileImagesDir(args.profileId, args.category));
    }
    for (const archetypeId of args.archetypeIds) {
        roots.push(await getArchetypeImagesDir(archetypeId, args.category));
    }
    return roots;
}

async function matchingRangeSubfolders(roots: string[], difference: number): Promise<string[]> {
    const matches = new Set<string>();
    for (const root of roots) {
        for (const name of await listSubdirectories(root)) {
            const range = parseDifferenceRange(name);
            if (range && difference >= range.min && difference <= range.max) {
                matches.add(name);
            }
        }
    }

    return [...matches].sort((a, b) => {
        const rangeA = parseDifferenceRange(a);
        const rangeB = parseDifferenceRange(b);
        if (!rangeA || !rangeB) {
            return a.localeCompare(b);
        }
        return rangeSpecificity(rangeA) - rangeSpecificity(rangeB) || a.localeCompare(b);
    });
}

function differenceSubpaths(args: {
    ranges: string[];
    role: PieceRole | null;
    check: boolean;
}): string[][] {
    const paths: string[][] = [];
    const add = (parts: string[]) => {
        const path = parts.filter(Boolean);
        if (!paths.some((candidate) => candidate.join("/") === path.join("/"))) {
            paths.push(path);
        }
    };

    for (const range of args.ranges) {
        if (args.role) {
            add([range, args.role]);
            add([args.role, range]);
        }
        if (args.check) {
            add([range, "check"]);
            add(["check", range]);
        }
        add([range]);
    }
    if (args.role) {
        add([args.role]);
    }
    if (args.check) {
        add(["check"]);
    }
    add([]);
    return paths;
}

async function imagesForSubpath(roots: string[], parts: string[]): Promise<string[]> {
    const lists = await Promise.all(
        roots.map(async (root) =>
            listImagesInDir(parts.length > 0 ? await resolve(root, ...parts) : root),
        ),
    );
    return lists.flat();
}

async function pickImageForSingleSource(args: {
    source: MediaSource;
    trigger: IntermissionTrigger;
    side: "white" | "black";
}): Promise<{ path: string | null; category: ImageCategory | null; folder: string | null }> {
    const profileId = args.source.kind === "profile" ? args.source.profileId : null;
    const archetypeIds = args.source.kind === "archetype" ? [args.source.archetypeId] : [];
    const folder =
        args.source.kind === "profile"
            ? await getProfileDir(args.source.profileId)
            : await getArchetypeDir(args.source.archetypeId);

    for (const category of args.trigger.candidates[args.side]) {
        if (isOutcomeCategory(category)) {
            const roots = await categoryRoots({
                profileId,
                archetypeIds,
                category,
            });
            const ranges = await matchingRangeSubfolders(roots, args.trigger.magnitude);
            const paths = differenceSubpaths({
                ranges,
                role: args.trigger.capturedRole,
                check: args.trigger.isCheck,
            });

            for (const parts of paths) {
                const images = await imagesForSubpath(roots, parts);
                if (images.length > 0) {
                    return { path: pickRandom(images), category, folder };
                }
            }
            continue;
        }

        const roles: (PieceRole | null)[] = [];
        const role = category === "took" || category === "lost" ? args.trigger.capturedRole : null;
        if (role) {
            roles.push(role);
        }
        roles.push(null);

        for (const candidateRole of roles) {
            const images = await imagesForCategory({
                profileId,
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

export async function pickProfileImage(args: {
    profileId: string | null;
    archetypeIds: string[];
    trigger: IntermissionTrigger;
    side: "white" | "black";
    source?: MediaSource | null;
}): Promise<{ path: string | null; category: ImageCategory | null; folder: string | null }> {
    if (args.source) {
        return pickImageForSingleSource({
            source: args.source,
            trigger: args.trigger,
            side: args.side,
        });
    }

    // No message source: still use a single image source rather than mixing
    // profile and archetype media. Profile wins, then archetypes in order.
    for (const source of buildMediaSources(args.profileId, args.archetypeIds)) {
        const result = await pickImageForSingleSource({
            source,
            trigger: args.trigger,
            side: args.side,
        });
        if (result.path) {
            return result;
        }
    }

    const folder = args.profileId
        ? await getProfileDir(args.profileId)
        : await getArchetypeDir(args.archetypeIds[0] ?? DEFAULT_ARCHETYPE_ID);
    return { path: null, category: null, folder };
}

async function readMessagesForSource(source: MediaSource): Promise<PlayerMessages> {
    return source.kind === "profile"
        ? readProfileMessages(source.profileId)
        : readArchetypeMessages(source.archetypeId);
}

export async function pickProfileMessage(args: {
    profileId: string | null;
    archetypeIds: string[];
    trigger: IntermissionTrigger;
    side: "white" | "black";
    playerName: string;
    opponentName: string;
}): Promise<{
    message: string | null;
    category: ImageCategory | null;
    source: MediaSource | null;
}> {
    const sources = buildMediaSources(args.profileId, args.archetypeIds);
    const loaded = await Promise.all(
        sources.map(async (source) => ({
            source,
            messages: await readMessagesForSource(source),
        })),
    );

    const candidates: MessageSourceCandidate[] = [];
    for (const { source, messages } of loaded) {
        const categories = args.trigger.candidates[args.side];
        for (let categoryIndex = 0; categoryIndex < categories.length; categoryIndex++) {
            const category = categories[categoryIndex];
            if (isOutcomeCategory(category)) {
                const nearest = pickNearestDifferenceList(
                    messages[category],
                    args.trigger.magnitude,
                );
                if (nearest.list.length > 0) {
                    candidates.push({
                        source,
                        category,
                        categoryIndex,
                        distance: nearest.distance,
                        list: nearest.list,
                    });
                    break;
                }
            } else {
                const list = messages[category];
                if (list.length > 0) {
                    candidates.push({
                        source,
                        category,
                        categoryIndex,
                        distance: 0,
                        list,
                    });
                    break;
                }
            }
        }
    }

    const best = selectBestMessageCandidate(candidates);
    if (!best) {
        return { message: null, category: null, source: null };
    }

    const template = pickRandom(best.list);
    if (!template) {
        return { message: null, category: null, source: null };
    }

    return {
        message: formatMessage(template, {
            piece: args.trigger.capturedRole,
            player: args.playerName,
            opponent: args.opponentName,
            color: args.side,
        }),
        category: best.category,
        source: best.source,
    };
}

export function resolveIntermissionDuration(
    baseDurationMs: number,
    vulnerability: number,
    severity = 1,
    materialMultiplier = 1,
): number {
    const multiplier =
        Math.max(0, vulnerability) * Math.max(1, severity) * Math.max(0, materialMultiplier);
    const duration = Math.round(baseDurationMs * multiplier);
    return Math.min(Math.max(1000, duration), 2_147_483_647);
}
