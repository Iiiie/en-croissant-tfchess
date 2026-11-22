#!/usr/bin/env node
/**
 * One-off cleanup for roleplay player/archetype folders.
 *
 * - Migrates old capture/check messages into WIN/LOSS lists.
 * - Writes clean messages.json files with an ignored "//" example.
 * - Moves legacy image folders into WIN/LOSS.
 * - Writes a rollback manifest for image moves.
 *
 * Usage:
 *   node scripts/cleanup-roleplay-players.mjs --dry-run
 *   node scripts/cleanup-roleplay-players.mjs
 *   node scripts/cleanup-roleplay-players.mjs --players-dir=/path/to/players
 *   node scripts/cleanup-roleplay-players.mjs --no-images
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative } from "node:path";

// Keep this in sync with MESSAGES_EXAMPLE in src/utils/playerProfile.ts.
const MESSAGES_EXAMPLE = {
  WIN: {
    0: ["Example win message for a tied material position."],
    5: ["Example win message for a 5-point material lead."],
    12: ["Example win message for a 12-point material lead."],
  },
  LOSS: {
    0: ["Example loss message for a tied material position."],
    5: ["Example loss message for a 5-point material deficit."],
    12: ["Example loss message for a 12-point material deficit."],
  },
};

const LEGACY_KEYS = ["took", "lost", "check", "checked", "default"];
const IMAGE_MAPPINGS = [
  { from: "took", to: "WIN", flatten: false },
  { from: "check", to: "WIN/check", flatten: true },
  { from: "lost", to: "LOSS", flatten: false },
  { from: "checked", to: "LOSS/check", flatten: true },
];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipImages = args.includes("--no-images");
const playersDirArg = args.find((arg) => arg.startsWith("--players-dir="));
const playersDir =
  playersDirArg?.slice("--players-dir=".length) ||
  process.env.EN_CROISSANT_PLAYERS_DIR ||
  join(homedir(), ".local/share/org.encroissant.app/players");

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const manifestPath = join(playersDir, `image-migration-manifest-${timestamp}.json`);
const manifest = [];
const summary = {
  messagesProcessed: 0,
  messagesBackedUp: 0,
  invalidMessages: 0,
  imagesMoved: 0,
  imageConflicts: 0,
  directoriesRemoved: 0,
};

function log(...values) {
  console.log(dryRun ? "[dry-run]" : "[cleanup]", ...values);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

function sanitizeDifferenceMessages(value) {
  const result = {};
  if (!isObject(value)) return result;
  for (const [key, list] of Object.entries(value)) {
    if (/^\d+$/.test(key) && isStringArray(list)) {
      result[key] = uniqueStrings(list);
    }
  }
  return result;
}

function serializeMessagesFile(win, loss) {
  return JSON.stringify({ "//": MESSAGES_EXAMPLE, WIN: win, LOSS: loss }, null, 2);
}

function backupMessagesFile(file) {
  const backup = `${file}.bak-${timestamp}`;
  if (dryRun) {
    log(`backup ${relative(playersDir, file)} -> ${relative(playersDir, backup)}`);
    return;
  }
  copyFileSync(file, backup);
  summary.messagesBackedUp += 1;
}

function migrateMessagesFile(file) {
  if (!existsSync(file)) {
    log(`create ${relative(playersDir, file)}`);
    if (!dryRun) {
      writeFileSync(file, serializeMessagesFile({}, {}));
    }
    summary.messagesProcessed += 1;
    return;
  }

  const raw = readFileSync(file, "utf8");
  backupMessagesFile(file);

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  if (!isObject(parsed)) {
    summary.invalidMessages += 1;
    log(`invalid JSON -> clean empty file: ${relative(playersDir, file)}`);
    if (!dryRun) {
      writeFileSync(file, serializeMessagesFile({}, {}));
    }
    summary.messagesProcessed += 1;
    return;
  }

  const win = sanitizeDifferenceMessages(parsed.WIN);
  const loss = sanitizeDifferenceMessages(parsed.LOSS);
  const legacy = Object.fromEntries(
    LEGACY_KEYS.map((key) => [key, isStringArray(parsed[key]) ? parsed[key] : []]),
  );

  const winZero = uniqueStrings([...(win["0"] ?? []), ...legacy.took, ...legacy.check]);
  const lossZero = uniqueStrings([
    ...(loss["0"] ?? []),
    ...legacy.lost,
    ...legacy.checked,
    ...legacy.default,
  ]);

  if (winZero.length > 0) win["0"] = winZero;
  if (lossZero.length > 0) loss["0"] = lossZero;

  log(
    `messages ${relative(playersDir, file)}: WIN[0]=${winZero.length}, LOSS[0]=${lossZero.length}`,
  );
  if (!dryRun) {
    writeFileSync(file, serializeMessagesFile(win, loss));
  }
  summary.messagesProcessed += 1;
}

function ensureImageDirectories(dir) {
  for (const sub of ["WIN", "LOSS", "default"]) {
    const target = join(dir, "images", sub);
    if (!existsSync(target)) {
      log(`mkdir ${relative(playersDir, target)}`);
      if (!dryRun) mkdirSync(target, { recursive: true });
    }
  }
}

function walkFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(full));
    } else if (entry.isFile()) {
      files.push({ full, rel: relative(root, full) });
    } else {
      log(`skip non-regular file ${relative(playersDir, full)}`);
    }
  }
  return files;
}

function uniqueDestination(destination) {
  if (!existsSync(destination)) return destination;
  const extension = extname(destination);
  const stem = destination.slice(0, destination.length - extension.length);
  let index = 1;
  while (existsSync(`${stem}-${index}${extension}`)) {
    index += 1;
  }
  return `${stem}-${index}${extension}`;
}

function moveFile(source, destination) {
  const target = uniqueDestination(destination);
  if (target !== destination) {
    summary.imageConflicts += 1;
    log(`conflict: ${relative(playersDir, destination)} -> ${relative(playersDir, target)}`);
  }
  if (dryRun) {
    log(`move ${relative(playersDir, source)} -> ${relative(playersDir, target)}`);
    return target;
  }
  mkdirSync(dirname(target), { recursive: true });
  try {
    renameSync(source, target);
  } catch {
    copyFileSync(source, target);
    unlinkSync(source);
  }
  return target;
}

function removeEmptyDirectories(root) {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      removeEmptyDirectories(join(root, entry.name));
    }
  }
  if (readdirSync(root).length === 0) {
    log(`rmdir ${relative(playersDir, root)}`);
    if (!dryRun) rmdirSync(root);
    summary.directoriesRemoved += 1;
  }
}

function migrateImages(dir) {
  ensureImageDirectories(dir);
  if (skipImages) return;

  for (const mapping of IMAGE_MAPPINGS) {
    const from = join(dir, "images", mapping.from);
    if (!existsSync(from)) continue;
    const to = join(dir, "images", ...mapping.to.split("/"));
    for (const file of walkFiles(from)) {
      const relativeDestination = mapping.flatten ? basename(file.rel) : file.rel;
      const destination = join(to, relativeDestination);
      const target = moveFile(file.full, destination);
      manifest.push({
        from: relative(playersDir, file.full),
        to: relative(playersDir, target),
      });
      summary.imagesMoved += 1;
    }
    removeEmptyDirectories(from);
  }
}

function workDirectories() {
  const dirs = [];
  for (const entry of readdirSync(playersDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "archetypes") continue;
    dirs.push(join(playersDir, entry.name));
  }
  const archetypesDir = join(playersDir, "archetypes");
  if (existsSync(archetypesDir)) {
    for (const entry of readdirSync(archetypesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        dirs.push(join(archetypesDir, entry.name));
      }
    }
  }
  return dirs;
}

function main() {
  if (!existsSync(playersDir)) {
    console.error(`Players directory not found: ${playersDir}`);
    process.exit(1);
  }

  log(`players directory: ${playersDir}`);
  const dirs = workDirectories();
  log(`folders: ${dirs.length}`);

  for (const dir of dirs) {
    log(`--- ${relative(playersDir, dir) || "."}`);
    migrateMessagesFile(join(dir, "messages.json"));
    migrateImages(dir);
  }

  if (!dryRun && manifest.length > 0) {
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          playersDir,
          moves: manifest,
        },
        null,
        2,
      ),
    );
    log(`rollback manifest: ${manifestPath}`);
  }

  console.table(summary);
  if (dryRun) {
    log("Dry run complete. Run without --dry-run to apply.");
  }
}

main();
