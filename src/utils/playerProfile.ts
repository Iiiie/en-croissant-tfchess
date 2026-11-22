import { resolve } from "@tauri-apps/api/path";
import {
    copyFile,
    exists,
    mkdir,
    readDir,
    readTextFile,
    remove,
    writeTextFile,
} from "@tauri-apps/plugin-fs";
import { z } from "zod";
import type { Outcome } from "@/bindings";
import { engineSettingsSchema, goModeSchema } from "@/utils/engines";
import { getPlayersDir } from "@/utils/directories";

export const OUTCOME_CATEGORIES = ["WIN", "LOSS"] as const;
export type OutcomeCategory = (typeof OUTCOME_CATEGORIES)[number];

export const IMAGE_CATEGORIES = ["WIN", "LOSS", "default"] as const;

/** Categories used by the old capture/check based intermission system. */
export const LEGACY_IMAGE_CATEGORIES = ["took", "lost", "check", "checked"] as const;

export type ImageCategory =
    | (typeof IMAGE_CATEGORIES)[number]
    | (typeof LEGACY_IMAGE_CATEGORIES)[number];

export function isOutcomeCategory(category: string): category is OutcomeCategory {
    return category === "WIN" || category === "LOSS";
}

export const PIECE_ROLES = ["pawn", "knight", "bishop", "rook", "queen"] as const;
export type PieceRole = (typeof PIECE_ROLES)[number];

export const DEFAULT_ARCHETYPE_ID = "default";

export const archetypeSchema = z.object({
    id: z.string(),
    name: z.string(),
});
export type Archetype = z.infer<typeof archetypeSchema>;

export const DEFAULT_ARCHETYPES: Archetype[] = [{ id: DEFAULT_ARCHETYPE_ID, name: "Default" }];

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp", ".svg"];
const VIDEO_EXTENSIONS = [".webm", ".mp4", ".m4v", ".mov", ".ogv"];
const MEDIA_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS];

export const playerKindSchema = z.enum(["human", "engine"]);
export type PlayerKind = z.infer<typeof playerKindSchema>;

export const playerStatsSchema = z.object({
    games: z.number().default(0),
    wins: z.number().default(0),
    losses: z.number().default(0),
    draws: z.number().default(0),
});
export type PlayerStats = z.infer<typeof playerStatsSchema>;

export const playerProfileSchema = z.object({
    type: z.literal("local").default("local"),
    id: z.string().default(() => crypto.randomUUID()),
    name: z.string(),
    kind: playerKindSchema.default("human"),
    engineId: z.string().nullish(),
    engineSettings: engineSettingsSchema.nullish(),
    go: goModeSchema.nullish(),
    elo: z.number().default(1500),
    k: z.number().default(32),
    vulnerability: z.number().min(0).max(100).default(1),
    notes: z.string().default(""),
    avatar: z.string().nullish(),
    archetypeIds: z.array(z.string()).default(() => [DEFAULT_ARCHETYPE_ID]),
    stats: playerStatsSchema.default({ games: 0, wins: 0, losses: 0, draws: 0 }),
    createdAt: z.number().default(() => Date.now()),
    updatedAt: z.number().default(() => Date.now()),
});
export type PlayerProfile = z.infer<typeof playerProfileSchema>;

export const differenceMessagesSchema = z.record(z.array(z.string())).catch({}).default({});
export type DifferenceMessages = z.infer<typeof differenceMessagesSchema>;

export const messagesSchema = z.object({
    WIN: differenceMessagesSchema,
    LOSS: differenceMessagesSchema,
    // Legacy keys kept so existing messages.json files keep working.
    took: z.array(z.string()).default([]),
    lost: z.array(z.string()).default([]),
    check: z.array(z.string()).default([]),
    checked: z.array(z.string()).default([]),
    default: z.array(z.string()).default([]),
});
export type PlayerMessages = z.infer<typeof messagesSchema>;

export const EMPTY_MESSAGES: PlayerMessages = {
    WIN: {},
    LOSS: {},
    took: [],
    lost: [],
    check: [],
    checked: [],
    default: [],
};

/**
 * JSON has no comment syntax. This reserved key is ignored by the parser and
 * re-added by the writer so every messages.json contains a tiered example.
 */
export const MESSAGES_EXAMPLE = {
    WIN: {
        "0": ["Example win message for a tied material position."],
        "5": ["Example win message for a 5-point material lead."],
        "12": ["Example win message for a 12-point material lead."],
    },
    LOSS: {
        "0": ["Example loss message for a tied material position."],
        "5": ["Example loss message for a 5-point material deficit."],
        "12": ["Example loss message for a 12-point material deficit."],
    },
} as const;

type MessagesFileShape = {
    "//": typeof MESSAGES_EXAMPLE;
    WIN: DifferenceMessages;
    LOSS: DifferenceMessages;
    took?: string[];
    lost?: string[];
    check?: string[];
    checked?: string[];
    default?: string[];
};

export function serializeMessagesFile(messages: PlayerMessages): string {
    const file: MessagesFileShape = {
        "//": MESSAGES_EXAMPLE,
        WIN: messages.WIN,
        LOSS: messages.LOSS,
    };

    for (const category of LEGACY_IMAGE_CATEGORIES) {
        if (messages[category].length > 0) {
            file[category] = messages[category];
        }
    }
    if (messages.default.length > 0) {
        file.default = messages.default;
    }

    return JSON.stringify(file, null, 2);
}

export type IntermissionEndReason =
    | "timeout"
    | "closed"
    | "minimized"
    | "failed"
    | "cancelled"
    | "skipped";

export type GameSide = "white" | "black";

const intermissionSideSchema = z.object({
    profileId: z.string().nullable(),
    profileName: z.string(),
    image: z.string().nullable(),
    message: z.string().nullable(),
    durationMs: z.number(),
    outcome: z.enum(["WIN", "LOSS"]).default("LOSS"),
    difference: z.number().default(0),
    endedAt: z.number().nullable(),
    reason: z.enum(["timeout", "closed", "minimized", "failed", "cancelled", "skipped"]).nullable(),
});

const intermissionRecordSchema = z.object({
    id: z.string(),
    kind: z.enum(["capture", "check"]),
    ply: z.number(),
    san: z.string(),
    startedAt: z.number(),
    endedAt: z.number().nullable(),
    severity: z.number().default(1),
    materialDiff: z.number().default(0),
    white: intermissionSideSchema,
    black: intermissionSideSchema,
});

const chatMessageSchema = z.object({
    id: z.string(),
    kind: z.enum(["message", "system"]),
    authorProfileId: z.string().nullable(),
    authorSide: z.enum(["white", "black"]).nullable(),
    authorName: z.string(),
    text: z.string(),
    timestamp: z.number(),
    ply: z.number(),
});

const profileGameRecordSchema = z.object({
    id: z.string(),
    gameId: z.string(),
    date: z.string(),
    startedAt: z.number(),
    endedAt: z.number(),
    color: z.enum(["white", "black"]),
    opponentProfileId: z.string().nullable(),
    opponentName: z.string(),
    result: z.enum(["1-0", "0-1", "1/2-1/2", "*"]),
    reason: z.string(),
    playerScore: z.number().nullable(),
    pgn: z.string(),
    timeControl: z.string(),
    eloBefore: z.number(),
    eloAfter: z.number(),
    chat: z.array(chatMessageSchema),
    intermissions: z.array(intermissionRecordSchema),
    notes: z.string().optional(),
});

export const profileHistorySchema = z.array(profileGameRecordSchema).catch([]);

export type IntermissionSideRecord = z.infer<typeof intermissionSideSchema>;
export type IntermissionRecord = z.infer<typeof intermissionRecordSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ProfileGameRecord = z.infer<typeof profileGameRecordSchema>;

export type PlayerGameSnapshot = {
    profileId: string | null;
    name: string;
    playerKind: PlayerKind;
    elo: number;
    k: number;
    vulnerability: number;
    timeControl: string;
};

export type GameRecord = {
    id: string;
    gameId: string;
    startedAt: number;
    white: PlayerGameSnapshot;
    black: PlayerGameSnapshot;
    narrative: boolean;
    rated: boolean;
    player1Side: GameSide;
};

export function newPlayerProfile(
    input: Partial<Omit<PlayerProfile, "type">> & { name: string },
): PlayerProfile {
    return playerProfileSchema.parse({
        ...input,
        name: input.name,
        type: "local",
        createdAt: input.createdAt ?? Date.now(),
        updatedAt: Date.now(),
    });
}

export function snapshotPlayer(
    profile: PlayerProfile | null,
    name: string,
    timeControl: string,
): PlayerGameSnapshot {
    return {
        profileId: profile?.id ?? null,
        name: profile?.name ?? name,
        playerKind: profile?.kind ?? "human",
        elo: profile?.elo ?? 1500,
        k: profile?.k ?? 32,
        vulnerability: profile?.vulnerability ?? 1,
        timeControl,
    };
}

export function createGameRecord(args: {
    id: string;
    gameId: string;
    white: PlayerGameSnapshot;
    black: PlayerGameSnapshot;
    narrative: boolean;
    player1Side?: GameSide;
}): GameRecord {
    return {
        id: args.id,
        gameId: args.gameId,
        startedAt: Date.now(),
        white: args.white,
        black: args.black,
        narrative: args.narrative,
        rated: !!args.white.profileId && !!args.black.profileId,
        player1Side: args.player1Side ?? "white",
    };
}

export function expectedScore(rating: number, opponentRating: number): number {
    return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

export function updateRating(
    rating: number,
    opponentRating: number,
    score: number,
    k: number,
): number {
    return Math.round(rating + k * (score - expectedScore(rating, opponentRating)));
}

export function resultScore(result: Outcome, side: GameSide): number | null {
    if (result === "*") {
        return null;
    }
    if (result === "1/2-1/2") {
        return 0.5;
    }
    return (result === "1-0") === (side === "white") ? 1 : 0;
}

export function updateStats(stats: PlayerStats, score: number | null): PlayerStats {
    if (score === null) {
        return stats;
    }

    return {
        games: stats.games + 1,
        wins: stats.wins + (score === 1 ? 1 : 0),
        losses: stats.losses + (score === 0 ? 1 : 0),
        draws: stats.draws + (score === 0.5 ? 1 : 0),
    };
}

export function buildHistoryEntry(args: {
    record: GameRecord;
    side: GameSide;
    result: Outcome;
    reason: string;
    pgn: string;
    chat: ChatMessage[];
    intermissions: IntermissionRecord[];
    endedAt: number;
}): ProfileGameRecord {
    const own = args.record[args.side];
    const other = args.record[args.side === "white" ? "black" : "white"];
    const score = resultScore(args.result, args.side);
    const rated = args.record.rated && score !== null;
    const eloAfter = rated ? updateRating(own.elo, other.elo, score as number, own.k) : own.elo;

    return {
        id: args.record.id,
        gameId: args.record.gameId,
        date: new Date(args.record.startedAt).toISOString(),
        startedAt: args.record.startedAt,
        endedAt: args.endedAt,
        color: args.side,
        opponentProfileId: other.profileId,
        opponentName: other.name,
        result: args.result,
        reason: args.reason,
        playerScore: score,
        pgn: args.pgn,
        timeControl: own.timeControl,
        eloBefore: own.elo,
        eloAfter,
        chat: args.chat,
        intermissions: args.intermissions,
    };
}

export function formatMessage(
    template: string,
    values: {
        piece?: string | null;
        player?: string | null;
        opponent?: string | null;
        color?: string | null;
    },
): string {
    return template.replace(/\{(piece|role|player|opponent|color)\}/g, (match, key: string) => {
        switch (key) {
            case "piece":
            case "role":
                return values.piece ?? "";
            case "player":
                return values.player ?? "";
            case "opponent":
                return values.opponent ?? "";
            case "color":
                return values.color ?? "";
            default:
                return match;
        }
    });
}

export function pickRandom<T>(items: readonly T[]): T | null {
    if (items.length === 0) {
        return null;
    }
    return items[Math.floor(Math.random() * items.length)];
}

export async function getProfileDir(profileId: string): Promise<string> {
    return resolve(await getPlayersDir(), profileId);
}

export async function getProfileImagesDir(
    profileId: string,
    category: ImageCategory,
    role?: PieceRole | null,
    subfolder?: string | null,
): Promise<string> {
    const profileDir = await getProfileDir(profileId);
    const parts = ["images", category];
    if (subfolder) {
        parts.push(subfolder);
    }
    if (role) {
        parts.push(role);
    }
    return resolve(profileDir, ...parts);
}

export async function getProfileMessagesPath(profileId: string): Promise<string> {
    return resolve(await getProfileDir(profileId), "messages.json");
}

export async function getProfileHistoryPath(profileId: string): Promise<string> {
    return resolve(await getProfileDir(profileId), "history.json");
}

export async function getProfileReadmePath(profileId: string): Promise<string> {
    return resolve(await getProfileDir(profileId), "README.txt");
}

export async function getPlayersIndexPath(): Promise<string> {
    return resolve(await getPlayersDir(), "players.json");
}

export async function getPlayersReadmePath(): Promise<string> {
    return resolve(await getPlayersDir(), "README.md");
}

export async function getArchetypesDir(): Promise<string> {
    return resolve(await getPlayersDir(), "archetypes");
}

export async function getArchetypeDir(archetypeId: string): Promise<string> {
    return archetypeId === DEFAULT_ARCHETYPE_ID
        ? resolve(await getPlayersDir(), DEFAULT_ARCHETYPE_ID)
        : resolve(await getArchetypesDir(), archetypeId);
}

export async function getArchetypeImagesDir(
    archetypeId: string,
    category: ImageCategory,
    role?: PieceRole | null,
    subfolder?: string | null,
): Promise<string> {
    const archetypeDir = await getArchetypeDir(archetypeId);
    const parts = ["images", category];
    if (subfolder) {
        parts.push(subfolder);
    }
    if (role) {
        parts.push(role);
    }
    return resolve(archetypeDir, ...parts);
}

export async function getArchetypeMessagesPath(archetypeId: string): Promise<string> {
    return resolve(await getArchetypeDir(archetypeId), "messages.json");
}

export async function getArchetypeReadmePath(archetypeId: string): Promise<string> {
    return resolve(await getArchetypeDir(archetypeId), "README.txt");
}

export async function readArchetypeMessages(archetypeId: string): Promise<PlayerMessages> {
    try {
        const parsed = messagesSchema.safeParse(
            JSON.parse(await readTextFile(await getArchetypeMessagesPath(archetypeId))),
        );
        return parsed.success ? parsed.data : EMPTY_MESSAGES;
    } catch {
        return EMPTY_MESSAGES;
    }
}

export async function ensureArchetypeStorage(archetype: Archetype): Promise<void> {
    for (const category of IMAGE_CATEGORIES) {
        await mkdir(await getArchetypeImagesDir(archetype.id, category), { recursive: true });
    }

    const messagesPath = await getArchetypeMessagesPath(archetype.id);
    if (!(await exists(messagesPath))) {
        await writeTextFile(messagesPath, serializeMessagesFile(EMPTY_MESSAGES));
    }

    const content = [
        `Archetype: ${archetype.name}`,
        `Id: ${archetype.id}`,
        "",
        "Images: images/<WIN|LOSS|default>/",
        "  optional subfolders under WIN/ and LOSS/:",
        "    - difference ranges, e.g. 1-11, 5, 12+",
        "    - piece names: pawn, knight, bishop, rook, queen",
        "    - check",
        "Messages: messages.json (WIN/LOSS lists keyed by material difference)",
        '  e.g. { "WIN": { "0": ["..."] }, "LOSS": { "0": ["..."], "12": ["..."] } }',
        '  The reserved "//" key is ignored by the app and safe to delete.',
    ].join("\n");
    await writeTextFile(await getArchetypeReadmePath(archetype.id), content);
}

export async function ensureArchetypesStorage(archetypes: Archetype[]): Promise<void> {
    for (const archetype of archetypes) {
        await ensureArchetypeStorage(archetype);
    }
}

export async function deleteArchetypeStorage(archetypeId: string): Promise<void> {
    if (archetypeId === DEFAULT_ARCHETYPE_ID) {
        return;
    }
    const dir = await getArchetypeDir(archetypeId);
    if (await exists(dir)) {
        await remove(dir, { recursive: true });
    }
}

export async function writeProfileReadme(profile: PlayerProfile): Promise<void> {
    const content = [
        `Player: ${profile.name}`,
        `Id: ${profile.id}`,
        `Kind: ${profile.kind}`,
        `Elo: ${profile.elo}`,
        `Archetypes: ${profile.archetypeIds.join(", ") || "none"}`,
        "",
        "Images: images/<WIN|LOSS|default>/",
        "  optional subfolders under WIN/ and LOSS/:",
        "    - difference ranges, e.g. 1-11, 5, 12+",
        "    - piece names: pawn, knight, bishop, rook, queen",
        "    - check",
        "Messages: messages.json (WIN/LOSS lists keyed by material difference)",
        '  e.g. { "WIN": { "0": ["..."] }, "LOSS": { "0": ["..."], "12": ["..."] } }',
        '  The reserved "//" key is ignored by the app and safe to delete.',
        "History: history.json",
    ].join("\n");
    await writeTextFile(await getProfileReadmePath(profile.id), content);
}

export async function ensureProfileStorage(profile: PlayerProfile): Promise<void> {
    for (const category of IMAGE_CATEGORIES) {
        await mkdir(await getProfileImagesDir(profile.id, category), { recursive: true });
    }

    const messagesPath = await getProfileMessagesPath(profile.id);
    if (!(await exists(messagesPath))) {
        await writeTextFile(messagesPath, serializeMessagesFile(EMPTY_MESSAGES));
    }

    const historyPath = await getProfileHistoryPath(profile.id);
    if (!(await exists(historyPath))) {
        await writeTextFile(historyPath, "[]");
    }

    await writeProfileReadme(profile);
}

type ReadmeProfile = {
    id: string;
    name: string;
    kind?: string;
    elo?: number;
    archetypeIds?: string[];
};

export async function readPlayersIndex(): Promise<ReadmeProfile[]> {
    try {
        const raw = JSON.parse(await readTextFile(await getPlayersIndexPath()));
        if (!Array.isArray(raw)) {
            return [];
        }
        return raw.filter(
            (entry): entry is ReadmeProfile =>
                !!entry && typeof entry.id === "string" && typeof entry.name === "string",
        );
    } catch {
        return [];
    }
}

export async function writePlayersReadme(
    profiles?: ReadmeProfile[],
    archetypes: Archetype[] = DEFAULT_ARCHETYPES,
): Promise<void> {
    const list = profiles ?? (await readPlayersIndex());
    const names = new Map(archetypes.map((archetype) => [archetype.id, archetype.name]));
    const profileRows = list.map((profile) => {
        const pulled = (profile.archetypeIds ?? []).map((id) => names.get(id) ?? id).join(", ");
        return `| ${profile.name} | ${profile.id} | ${profile.kind ?? "human"} | ${
            profile.elo ?? "-"
        } | ${pulled || "none"} |`;
    });
    const archetypeRows = archetypes.map(
        (archetype) =>
            `| ${archetype.name} | ${
                archetype.id === DEFAULT_ARCHETYPE_ID
                    ? DEFAULT_ARCHETYPE_ID
                    : `archetypes/${archetype.id}`
            } |`,
    );

    const content = [
        "# Local players",
        "",
        "`players.json` lists the profiles, `archetypes.json` lists the archetypes.",
        "Each profile has its own folder and pulls media/messages from any number of archetypes.",
        "",
        "| Player | Folder | Kind | Elo | Archetypes |",
        "| --- | --- | --- | --- | --- |",
        ...profileRows,
        "",
        "## Archetypes",
        "",
        "Archetypes are shared folders (the `default` one is used by guests as well).",
        "Add, rename, or open them from the Players page (Archetypes button).",
        "",
        "| Archetype | Folder |",
        "| --- | --- |",
        ...archetypeRows,
        "",
        "Each player/archetype folder contains:",
        "- `images/WIN/`, `images/LOSS/`, `images/default/`",
        "- optional subfolders under `WIN/` and `LOSS/`: difference ranges like `1-11`, piece names, or `check`",
        "  e.g. `images/WIN/1-11/queen/`",
        "- `messages.json` — `WIN`/`LOSS` message lists keyed by material difference",
        '  e.g. `{ "WIN": { "0": ["..."] }, "LOSS": { "0": ["..."], "12": ["..."] } }`',
        '  The reserved `"//"` key is ignored by the app and safe to delete.',
        "- Media pairing: a message from an archetype only uses images from that same archetype.",
        "- `history.json` — games played with this profile",
        "",
        "Supported media: png, jpg, jpeg, gif, webp, avif, bmp, svg, webm, mp4, m4v, mov, ogv.",
    ].join("\n");
    await writeTextFile(await getPlayersReadmePath(), content);
}

export async function ensureSharedStorage(): Promise<void> {
    await ensureArchetypeStorage(DEFAULT_ARCHETYPES[0]);
    await writePlayersReadme(undefined, DEFAULT_ARCHETYPES);
}

export async function deleteProfileStorage(profileId: string): Promise<void> {
    const profileDir = await getProfileDir(profileId);
    if (await exists(profileDir)) {
        await remove(profileDir, { recursive: true });
    }
}

export async function readProfileMessages(profileId: string): Promise<PlayerMessages> {
    try {
        const path = await getProfileMessagesPath(profileId);
        const parsed = messagesSchema.safeParse(JSON.parse(await readTextFile(path)));
        return parsed.success ? parsed.data : EMPTY_MESSAGES;
    } catch {
        return EMPTY_MESSAGES;
    }
}

export async function writeProfileMessages(
    profileId: string,
    messages: PlayerMessages,
): Promise<void> {
    const path = await getProfileMessagesPath(profileId);
    await writeTextFile(path, serializeMessagesFile(messages));
}

export async function readProfileHistory(profileId: string): Promise<ProfileGameRecord[]> {
    try {
        const path = await getProfileHistoryPath(profileId);
        const parsed = profileHistorySchema.safeParse(JSON.parse(await readTextFile(path)));
        return parsed.success ? parsed.data : [];
    } catch {
        return [];
    }
}

export async function writeProfileHistory(
    profileId: string,
    history: ProfileGameRecord[],
): Promise<void> {
    const path = await getProfileHistoryPath(profileId);
    await writeTextFile(path, JSON.stringify(history, null, 2));
}

export async function appendProfileHistory(
    profileId: string,
    record: ProfileGameRecord,
): Promise<ProfileGameRecord[]> {
    const history = await readProfileHistory(profileId);
    if (history.some((entry) => entry.id === record.id)) {
        return history;
    }
    const next = [...history, record];
    await writeProfileHistory(profileId, next);
    return next;
}

export function isImageFileName(name: string): boolean {
    return IMAGE_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension));
}

export function isVideoFileName(name: string): boolean {
    return VIDEO_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension));
}

export function isMediaFileName(name: string): boolean {
    return MEDIA_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension));
}

export async function listImagesInDir(
    dir: string,
    predicate: (name: string) => boolean = isMediaFileName,
): Promise<string[]> {
    try {
        if (!(await exists(dir))) {
            return [];
        }
        const entries = await readDir(dir);
        const files = await Promise.all(
            entries
                .filter((entry) => entry.isFile && predicate(entry.name))
                .map((entry) => resolve(dir, entry.name)),
        );
        return files.sort();
    } catch {
        // Missing or unreadable folders are treated as empty folders.
        return [];
    }
}

export async function listSubdirectories(dir: string): Promise<string[]> {
    try {
        if (!(await exists(dir))) {
            return [];
        }
        const entries = await readDir(dir);
        return entries
            .filter((entry) => entry.isDirectory)
            .map((entry) => entry.name)
            .sort();
    } catch {
        // Missing or unreadable folders are treated as empty folders.
        return [];
    }
}

export async function listProfileImages(
    profileId: string,
    category: ImageCategory,
    role?: PieceRole | null,
    subfolder?: string | null,
): Promise<string[]> {
    const candidateDirs: string[] = [];
    if (subfolder && role) {
        candidateDirs.push(await getProfileImagesDir(profileId, category, role, subfolder));
        candidateDirs.push(
            await resolve(await getProfileImagesDir(profileId, category, role), subfolder),
        );
    }
    if (subfolder) {
        candidateDirs.push(await getProfileImagesDir(profileId, category, null, subfolder));
    }
    if (role) {
        candidateDirs.push(await getProfileImagesDir(profileId, category, role));
    }
    candidateDirs.push(await getProfileImagesDir(profileId, category));

    for (const dir of candidateDirs) {
        const images = await listImagesInDir(dir);
        if (images.length > 0) {
            return images;
        }
    }

    return [];
}

export async function listArchetypeImages(
    archetypeId: string,
    category: ImageCategory,
    role?: PieceRole | null,
    subfolder?: string | null,
): Promise<string[]> {
    const candidateDirs: string[] = [];
    if (subfolder && role) {
        candidateDirs.push(await getArchetypeImagesDir(archetypeId, category, role, subfolder));
        candidateDirs.push(
            await resolve(await getArchetypeImagesDir(archetypeId, category, role), subfolder),
        );
    }
    if (subfolder) {
        candidateDirs.push(await getArchetypeImagesDir(archetypeId, category, null, subfolder));
    }
    if (role) {
        candidateDirs.push(await getArchetypeImagesDir(archetypeId, category, role));
    }
    candidateDirs.push(await getArchetypeImagesDir(archetypeId, category));

    for (const dir of candidateDirs) {
        const images = await listImagesInDir(dir);
        if (images.length > 0) {
            return images;
        }
    }

    return [];
}

export async function addImageToProfile(args: {
    profileId: string;
    sourcePath: string;
    category: ImageCategory;
    role?: PieceRole | null;
    subfolder?: string | null;
}): Promise<string> {
    const dir = await getProfileImagesDir(
        args.profileId,
        args.category,
        args.role ?? null,
        args.subfolder ?? null,
    );
    await mkdir(dir, { recursive: true });

    const filename = args.sourcePath.split(/[\\/]/).pop() ?? `image-${Date.now()}.png`;
    const destination = await resolve(dir, filename);
    await copyFile(args.sourcePath, destination);
    return destination;
}

export async function getProfileAvatar(profile: PlayerProfile): Promise<string | null> {
    if (profile.avatar) {
        return profile.avatar;
    }

    for (const category of [
        "default",
        "WIN",
        "LOSS",
        "took",
        "lost",
        "check",
        "checked",
    ] as const) {
        const dirs = [await getProfileImagesDir(profile.id, category)];
        for (const archetypeId of profile.archetypeIds) {
            dirs.push(await getArchetypeImagesDir(archetypeId, category));
        }
        for (const dir of dirs) {
            const images = await listImagesInDir(dir, isImageFileName);
            if (images.length > 0) {
                return images[0];
            }
        }
    }

    return null;
}
