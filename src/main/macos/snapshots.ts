/* eslint-disable no-restricted-syntax, no-await-in-loop -- Bounded, ordered file work. */
import { createHash } from 'crypto';
import { createReadStream, constants } from 'fs';
import fs from 'fs/promises';
import path from 'path';

/**
 * Versioned copies of an emulator's saves and save states, kept inside the
 * library (backups/saves/<emulator>/<id>/) so they travel with it.
 *
 * Guarantees:
 * - A user's save is never deleted or overwritten. Restore moves the current
 *   folders into a new snapshot, and every step after the first move is
 *   journaled: a failure, crash or unplugged drive rolls back to exactly the
 *   previous state, at once or at the next start.
 * - Snapshots are ordered by a sequence number, never by the clock.
 * - Unchanged saves never make a new snapshot, so retention counts content.
 * - Pruning removes only this module's own sealed snapshots, and never the one
 *   just made, the newest daily one, or recent before-restore ones.
 * - Firmware stored beside saves (e.g. Dolphin's IPL.bin) is neither copied
 *   nor swapped by a restore.
 */

export type SnapshotReason =
  | 'daily'
  | 'before-update'
  | 'before-reset'
  | 'before-controls'
  | 'before-restore'
  | 'interrupted'
  | 'manual';

/** One emulator's save folders, by stable name (e.g. saves → User/GC). */
export interface SnapshotSource {
  emulator: string;
  folders: Readonly<Record<string, string>>;
  /** '<folder name>/<relative path>' files never copied or swapped (firmware). */
  exclude?: readonly string[];
}

export interface SnapshotFile {
  /** '<folder name>/<relative POSIX path>' */
  path: string;
  bytes: number;
  sha256: string;
  /** Source modification time, for change detection only. */
  modified: number;
}

export interface SnapshotManifest {
  version: 1;
  emulator: string;
  reason: SnapshotReason;
  created: string;
  sequence: number;
  folders: string[];
  files: SnapshotFile[];
}

export interface SnapshotInfo {
  id: string;
  emulator: string;
  reason: SnapshotReason;
  created: string;
  files: number;
  bytes: number;
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** Sealed snapshots kept per emulator, counting the protected ones. */
const KEEP = 30;
/** Newest before-restore / interrupted snapshots that are never pruned. */
const KEEP_RESTORE_POINTS = 10;
const MAX_FILES = 50000;
const MAX_DEPTH = 16;
/** Clone on APFS (no extra space), copy elsewhere; never overwrite. */
// eslint-disable-next-line no-bitwise -- copyfile flags.
const COPY_FLAGS = constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL;
/** A sealed snapshot's folder name: sequence, UTC time, reason. */
export const SNAPSHOT_ID =
  /^\d{6}-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-z-]+$/;
const ID = SNAPSHOT_ID;
const SEQUENCE = /^(\d{6})-/;
const EMULATOR = /^[a-z][a-z0-9-]*$/;
const FOLDER = /^[a-z][a-z0-9-]*$/;
const JOURNAL = 'restore-journal.json';
const REASONS: readonly SnapshotReason[] = [
  'daily',
  'before-update',
  'before-reset',
  'before-controls',
  'before-restore',
  'interrupted',
  'manual',
];
const RESTORE_POINTS: readonly SnapshotReason[] = [
  'before-restore',
  'interrupted',
];

export function snapshotRoot(library: string, emulator: string): string {
  if (!EMULATOR.test(emulator)) throw new SnapshotError('Unknown emulator');
  return path.join(library, 'backups', 'saves', emulator);
}

function checkSource(source: SnapshotSource): void {
  snapshotRoot('/', source.emulator);
  const names = Object.keys(source.folders);
  if (!names.length || names.some((name) => !FOLDER.test(name)))
    throw new SnapshotError('Invalid save folders');
}

/** Missing → false; a real folder → true; anything else (a link) refuses. */
async function realDirectory(target: string): Promise<boolean> {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat) return false;
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new SnapshotError('A save folder is not a real folder');
  return true;
}

function exists(target: string): Promise<boolean> {
  return fs.lstat(target).then(
    () => true,
    () => false,
  );
}

/** Creates each missing segment below `base` as a real folder; never follows links. */
async function makeDirectories(base: string, relative: string): Promise<void> {
  let current = base;
  for (const part of relative.split('/').filter(Boolean)) {
    current = path.join(current, part);
    await fs.mkdir(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    if (!(await realDirectory(current)))
      throw new SnapshotError('Folder could not be created');
  }
}

function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk: Buffer) => hash.update(Uint8Array.from(chunk)))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

interface Found {
  relative: string;
  absolute: string;
  bytes: number;
  modified: number;
}

/** Regular files under a folder; links and special files are skipped, never followed. */
async function walk(folder: string): Promise<Found[]> {
  const found: Found[] = [];
  const visit = async (directory: string, relative: string, depth: number) => {
    if (depth > MAX_DEPTH) throw new SnapshotError('Save folder is too deep');
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      // macOS metadata ("AppleDouble") that exFAT and other non-Mac volumes
      // store beside every file; not saves, and recreated by macOS as needed.
      if (entry.name.startsWith('._')) continue; // eslint-disable-line no-continue
      const absolute = path.join(directory, entry.name);
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(absolute, child, depth + 1);
      else if (entry.isFile()) {
        if (found.length >= MAX_FILES)
          throw new SnapshotError('Too many save files');
        const stat = await fs.lstat(absolute);
        if (stat.isFile())
          found.push({
            relative: child,
            absolute,
            bytes: stat.size,
            modified: Math.round(stat.mtimeMs),
          });
      }
    }
  };
  await visit(folder, '', 0);
  return found;
}

/** Current save files (excluding firmware), as a manifest would list them. */
async function currentFiles(source: SnapshotSource) {
  const excluded = new Set(source.exclude || []);
  const files: Array<Found & { path: string }> = [];
  for (const [name, folder] of Object.entries(source.folders)) {
    if (!(await realDirectory(folder))) continue; // eslint-disable-line no-continue
    for (const item of await walk(folder)) {
      const filePath = `${name}/${item.relative}`;
      if (!excluded.has(filePath)) files.push({ ...item, path: filePath });
    }
  }
  return files;
}

function fingerprint(
  files: ReadonlyArray<{ path: string; bytes: number; modified: number }>,
): string {
  return files
    .map((file) => `${file.path}\0${file.bytes}\0${file.modified}`)
    .join('\n');
}

async function readManifest(directory: string): Promise<SnapshotManifest> {
  const text = await fs.readFile(path.join(directory, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(text) as SnapshotManifest;
  if (
    manifest.version !== 1 ||
    !REASONS.includes(manifest.reason) ||
    !Array.isArray(manifest.files) ||
    !Array.isArray(manifest.folders)
  )
    throw new SnapshotError('Unreadable snapshot');
  return manifest;
}

function info(id: string, manifest: SnapshotManifest): SnapshotInfo {
  return {
    id,
    emulator: manifest.emulator,
    reason: manifest.reason,
    created: manifest.created,
    files: manifest.files.length,
    bytes: manifest.files.reduce((total, file) => total + file.bytes, 0),
  };
}

/** The next sequence number, above every snapshot, partial or not. */
async function nextSequence(root: string): Promise<number> {
  const names = (await realDirectory(root)) ? await fs.readdir(root) : [];
  return (
    names.reduce((highest, name) => {
      const match = SEQUENCE.exec(name);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0) + 1
  );
}

function snapshotName(
  sequence: number,
  now: Date,
  reason: SnapshotReason,
): string {
  const time = now.toISOString().replace(/:/g, '-').replace('.', '-');
  return `${String(sequence).padStart(6, '0')}-${time}-${reason}`;
}

/** Sealed snapshots, newest first (by sequence). Partial ones are not listed. */
export async function listSnapshots(
  library: string,
  emulator: string,
): Promise<SnapshotInfo[]> {
  const root = snapshotRoot(library, emulator);
  if (!(await realDirectory(root))) return [];
  const names = (await fs.readdir(root)).filter((name) => ID.test(name));
  const items: SnapshotInfo[] = [];
  for (const name of names.sort().reverse()) {
    const directory = path.join(root, name);
    if (!(await realDirectory(directory))) continue; // eslint-disable-line no-continue
    const manifest = await readManifest(directory).catch(() => null);
    if (manifest?.emulator === emulator) items.push(info(name, manifest));
  }
  return items;
}

/** Writes a manifest for the files already in `directory`, hashing each. */
async function seal(
  directory: string,
  source: SnapshotSource,
  reason: SnapshotReason,
  now: Date,
  sequence: number,
  modified: Map<string, number>,
): Promise<SnapshotManifest> {
  const files: SnapshotFile[] = [];
  for (const name of Object.keys(source.folders)) {
    const folder = path.join(directory, name);
    if (!(await realDirectory(folder))) continue; // eslint-disable-line no-continue
    for (const item of await walk(folder)) {
      const filePath = `${name}/${item.relative}`;
      files.push({
        path: filePath,
        bytes: item.bytes,
        sha256: await hashFile(item.absolute),
        modified: modified.get(filePath) ?? item.modified,
      });
    }
  }
  const manifest: SnapshotManifest = {
    version: 1,
    emulator: source.emulator,
    reason,
    created: now.toISOString(),
    sequence,
    folders: Object.keys(source.folders),
    files,
  };
  const handle = await fs.open(path.join(directory, 'manifest.json'), 'wx');
  try {
    await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return manifest;
}

/** Removes a folder only when it holds no regular files except this module's manifest. */
async function removeIfEmpty(directory: string): Promise<void> {
  if (!(await realDirectory(directory))) return;
  const files = await walk(directory);
  if (files.some((file) => file.relative !== 'manifest.json')) return;
  await fs.rm(directory, { recursive: true });
}

/**
 * Removes this module's own oldest sealed snapshots beyond KEEP. Never removes
 * `keep` (the one just made), the newest daily snapshot or the newest
 * KEEP_RESTORE_POINTS before-restore/interrupted snapshots.
 */
async function prune(
  library: string,
  emulator: string,
  keep: string,
): Promise<void> {
  const root = snapshotRoot(library, emulator);
  const all = await listSnapshots(library, emulator);
  const protectedIDs = new Set<string>([keep]);
  const newestDaily = all.find((item) => item.reason === 'daily');
  if (newestDaily) protectedIDs.add(newestDaily.id);
  all
    .filter((item) => RESTORE_POINTS.includes(item.reason))
    .slice(0, KEEP_RESTORE_POINTS)
    .forEach((item) => protectedIDs.add(item.id));
  const candidates = all.filter((item) => !protectedIDs.has(item.id));
  const room = Math.max(0, KEEP - protectedIDs.size);
  for (const old of candidates.slice(room)) {
    const directory = path.join(root, old.id);
    if (ID.test(old.id) && (await realDirectory(directory)))
      await fs.rm(directory, { recursive: true });
  }
}

/**
 * The restore journal. Paths are derived from the current library and save
 * source, never stored, so a renamed library or a remounted drive still
 * recovers. Written atomically (temporary file, then rename): it is either
 * absent or complete.
 */
interface Journal {
  version: 2;
  /** The before-restore snapshot's name; its folder is `<token>.partial` until committed. */
  token: string;
  /** Staging folders are `<live>.restoring-<suffix>`. */
  suffix: string;
  /** hadLive: the live folder existed before the restore. */
  folders: Array<{ name: string; hadLive: boolean }>;
  exclude: string[];
  /** Set once the previous saves are sealed: recovery finishes, never undoes. */
  committed: boolean;
}

async function writeJournal(root: string, journal: Journal): Promise<void> {
  const temporary = path.join(root, `${JOURNAL}.tmp`);
  const handle = await fs.open(temporary, 'w');
  try {
    await handle.writeFile(JSON.stringify(journal));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, path.join(root, JOURNAL));
}

async function readJournal(
  root: string,
  source: SnapshotSource,
): Promise<Journal | null> {
  // A temporary journal never replaced the real one: nothing happened from it.
  await fs.rm(path.join(root, `${JOURNAL}.tmp`), { force: true });
  const text = await fs
    .readFile(path.join(root, JOURNAL), 'utf8')
    .catch(() => null);
  if (text === null) return null;
  let journal: Journal;
  try {
    journal = JSON.parse(text) as Journal;
  } catch {
    throw new SnapshotError('Restore journal is unreadable');
  }
  if (
    journal?.version !== 2 ||
    !ID.test(journal.token) ||
    !journal.token.endsWith('-before-restore') ||
    !/^\d{6}$/.test(journal.suffix) ||
    !Array.isArray(journal.folders) ||
    journal.folders.some((folder) => !(folder.name in source.folders)) ||
    !Array.isArray(journal.exclude)
  )
    throw new SnapshotError('Restore journal is unreadable');
  return journal;
}

/** Moves firmware files (never swapped) from one save folder to another. */
async function carryExcluded(
  excluded: readonly string[],
  name: string,
  from: string,
  to: string,
): Promise<void> {
  for (const filePath of excluded) {
    const [folder, ...rest] = filePath.split('/');
    if (folder !== name || !rest.length) continue; // eslint-disable-line no-continue
    const source = path.join(from, ...rest);
    const target = path.join(to, ...rest);
    if (!(await exists(source)) || (await exists(target))) continue; // eslint-disable-line no-continue
    await makeDirectories(to, rest.slice(0, -1).join('/'));
    await fs.rename(source, target);
  }
}

/**
 * Finishes a committed restore, or undoes one that was not committed. When
 * undoing, each live folder that was swapped gets its original back; what was
 * live instead is dropped only when it is certainly this module's own copy
 * (`ours`: same process, nothing could have run), and otherwise kept as an
 * 'interrupted' snapshot, since an emulator may have written to it.
 */
async function settleJournal(
  library: string,
  source: SnapshotSource,
  ours: boolean,
  now: Date,
): Promise<void> {
  const root = snapshotRoot(library, source.emulator);
  const journal = await readJournal(root, source);
  if (!journal) return;
  const partial = path.join(root, `${journal.token}.partial`);
  const staging = (name: string) =>
    `${source.folders[name]}.restoring-${journal.suffix}`;
  if (journal.committed) {
    // The previous saves are sealed in the partial folder: publish them.
    if (await realDirectory(partial)) {
      const manifest = await readManifest(partial).catch(() => null);
      if (manifest?.files.length)
        await fs.rename(partial, path.join(root, journal.token));
      else await removeIfEmpty(partial);
    }
    for (const folder of journal.folders)
      if (await exists(staging(folder.name)))
        await fs.rm(staging(folder.name), { recursive: true });
    await fs.rm(path.join(root, JOURNAL));
    return;
  }
  let kept: string | null = null;
  for (const folder of journal.folders) {
    const live = source.folders[folder.name];
    const original = path.join(partial, folder.name);
    const originalMoved = await realDirectory(original);
    // The live folder holds the restored copy when the original was moved
    // away, or when there was no original and the staging folder is gone.
    const swapped =
      originalMoved ||
      (!folder.hadLive && !(await exists(staging(folder.name))));
    if (swapped && (await realDirectory(live))) {
      // Firmware was carried into the restored folder; give it back first.
      if (originalMoved)
        await carryExcluded(journal.exclude, folder.name, live, original);
      if (ours) {
        await fs.rename(live, staging(folder.name));
      } else {
        if (!kept) {
          kept = path.join(
            root,
            `${snapshotName(await nextSequence(root), now, 'interrupted')}.partial`,
          );
          await fs.mkdir(kept);
        }
        await fs.rename(live, path.join(kept, folder.name));
      }
    }
    if (originalMoved) await fs.rename(original, live);
    // Staging folders are copies of a sealed, verified snapshot: safe to drop.
    if (await exists(staging(folder.name)))
      await fs.rm(staging(folder.name), { recursive: true });
  }
  if (kept) {
    const name = path.basename(kept, '.partial');
    const sequence = Number(SEQUENCE.exec(name)![1]);
    const manifest = await seal(
      kept,
      source,
      'interrupted',
      now,
      sequence,
      new Map(),
    );
    if (manifest.files.length) await fs.rename(kept, path.join(root, name));
    else await removeIfEmpty(kept);
  }
  await removeIfEmpty(partial);
  await fs.rm(path.join(root, JOURNAL));
}

/**
 * Brings the save folders back to a consistent state after a crash or an
 * unplugged drive during a restore, and removes leftover staging copies. Run
 * at startup and before every snapshot operation. Never deletes a user's file.
 */
export async function recoverInterrupted(
  library: string,
  source: SnapshotSource,
  now = new Date(),
): Promise<void> {
  checkSource(source);
  const root = snapshotRoot(library, source.emulator);
  if (await realDirectory(root)) {
    await settleJournal(library, source, false, now);
    // Empty before-restore folders left by a crash before the journal existed.
    for (const name of await fs.readdir(root))
      if (
        name.endsWith('-before-restore.partial') &&
        ID.test(name.slice(0, -8))
      )
        await removeIfEmpty(path.join(root, name));
  }
  // Staging copies left by a crash before the journal existed.
  for (const live of Object.values(source.folders)) {
    const parent = path.dirname(live);
    const prefix = `${path.basename(live)}.restoring-`;
    const names = await fs.readdir(parent).catch(() => [] as string[]);
    for (const name of names) {
      if (name.startsWith(prefix) && /^\d{6}$/.test(name.slice(prefix.length)))
        await fs.rm(path.join(parent, name), { recursive: true });
    }
  }
}

/**
 * Copies the source's save folders into a new snapshot (APFS clones where the
 * volume supports them). Returns null when there is nothing to save, or for a
 * daily snapshot when nothing changed or the newest is under a day old.
 * Unchanged saves return the newest existing snapshot instead of a copy. The
 * caller must ensure the emulator is not running.
 */
export async function takeSnapshot(
  library: string,
  source: SnapshotSource,
  reason: SnapshotReason,
  now = new Date(),
): Promise<SnapshotInfo | null> {
  checkSource(source);
  await recoverInterrupted(library, source, now);
  const files = await currentFiles(source);
  if (!files.length) return null;
  const root = snapshotRoot(library, source.emulator);
  const [latest] = await listSnapshots(library, source.emulator);
  if (latest) {
    const manifest = await readManifest(path.join(root, latest.id));
    const unchanged = fingerprint(manifest.files) === fingerprint(files);
    // A clock set back gives a negative age: treat it as due, never as recent.
    const age = now.getTime() - Date.parse(manifest.created);
    if (reason === 'daily' && (unchanged || (age >= 0 && age < 24 * 3600e3)))
      return null;
    if (unchanged) return latest;
  }
  await makeDirectories(library, path.relative(library, root));
  const sequence = await nextSequence(root);
  const id = snapshotName(sequence, now, reason);
  const partial = path.join(root, `${id}.partial`);
  await fs.mkdir(partial);
  let manifest: SnapshotManifest;
  try {
    const modified = new Map<string, number>();
    for (const file of files) {
      const [folder, ...rest] = file.path.split('/');
      await makeDirectories(partial, [folder, ...rest.slice(0, -1)].join('/'));
      const target = path.join(partial, ...file.path.split('/'));
      await fs.copyFile(file.absolute, target, COPY_FLAGS);
      const copied = await fs.lstat(target);
      if (copied.size !== file.bytes)
        throw new SnapshotError('A save changed while it was being copied');
      modified.set(file.path, file.modified);
    }
    manifest = await seal(partial, source, reason, now, sequence, modified);
    await fs.rename(partial, path.join(root, id));
  } catch (error) {
    // Only this snapshot's own incomplete folder is removed.
    await fs
      .rm(partial, { recursive: true, force: true })
      .catch(() => undefined);
    throw error;
  }
  await prune(library, source.emulator, id);
  return info(id, manifest);
}

/** Every file in the snapshot matches its recorded size and SHA-256. */
export async function verifySnapshot(
  library: string,
  emulator: string,
  id: string,
): Promise<SnapshotManifest> {
  if (!ID.test(id)) throw new SnapshotError('Unknown snapshot');
  const directory = path.join(snapshotRoot(library, emulator), id);
  if (!(await realDirectory(directory)))
    throw new SnapshotError('Unknown snapshot');
  const manifest = await readManifest(directory);
  for (const file of manifest.files) {
    const parts = file.path.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..'))
      throw new SnapshotError('Snapshot is damaged');
    const target = path.join(directory, ...parts);
    const stat = await fs.lstat(target).catch(() => null);
    if (
      !stat?.isFile() ||
      stat.size !== file.bytes ||
      (await hashFile(target)) !== file.sha256
    )
      throw new SnapshotError('Snapshot is damaged');
  }
  return manifest;
}

/**
 * Restores a snapshot byte for byte (firmware files excepted). Verifies the
 * snapshot, builds verified copies beside the live folders, then — journaled —
 * moves each live folder into a new before-restore snapshot and the copy into
 * place. Any failure before the before-restore snapshot is sealed rolls every
 * folder back. The caller must ensure the emulator is not running and the
 * person confirmed.
 */
export async function restoreSnapshot(
  library: string,
  source: SnapshotSource,
  id: string,
  now = new Date(),
): Promise<{ before: SnapshotInfo | null }> {
  checkSource(source);
  await recoverInterrupted(library, source, now);
  const manifest = await verifySnapshot(library, source.emulator, id);
  const root = snapshotRoot(library, source.emulator);
  const snapshot = path.join(root, id);
  const sequence = await nextSequence(root);
  const token = snapshotName(sequence, now, 'before-restore');
  const suffix = String(sequence).padStart(6, '0');
  const journal: Journal = {
    version: 2,
    token,
    suffix,
    folders: [],
    exclude: [...(source.exclude || [])],
    committed: false,
  };
  const partial = path.join(root, `${token}.partial`);
  const staged = Object.entries(source.folders).map(([name, live]) => ({
    name,
    live,
    staging: `${live}.restoring-${suffix}`,
  }));
  try {
    for (const folder of staged) {
      await makeDirectories(
        path.dirname(folder.live),
        path.basename(folder.staging),
      );
      for (const file of manifest.files.filter((item) =>
        item.path.startsWith(`${folder.name}/`),
      )) {
        const parts = file.path.split('/').slice(1);
        await makeDirectories(folder.staging, parts.slice(0, -1).join('/'));
        const target = path.join(folder.staging, ...parts);
        await fs.copyFile(
          path.join(snapshot, ...file.path.split('/')),
          target,
          COPY_FLAGS,
        );
        if ((await hashFile(target)) !== file.sha256)
          throw new SnapshotError('The restored copy did not verify');
      }
    }
  } catch (error) {
    // Only this function's own staging copies are removed; live saves are untouched.
    for (const folder of staged)
      await fs
        .rm(folder.staging, { recursive: true, force: true })
        .catch(() => undefined);
    throw error;
  }
  for (const [name, live] of Object.entries(source.folders))
    journal.folders.push({ name, hadLive: await realDirectory(live) });
  const modified = new Map<string, number>();
  for (const file of await currentFiles(source))
    modified.set(file.path, file.modified);
  let before: SnapshotManifest;
  try {
    await fs.mkdir(partial);
    await writeJournal(root, journal);
    for (const folder of staged) {
      const moved = path.join(partial, folder.name);
      if (await realDirectory(folder.live)) await fs.rename(folder.live, moved);
      await fs.rename(folder.staging, folder.live);
      // Firmware is not part of saves: it stays where it was.
      await carryExcluded(journal.exclude, folder.name, moved, folder.live);
    }
    before = await seal(
      partial,
      source,
      'before-restore',
      now,
      sequence,
      modified,
    );
    // The commit point: from here, recovery finishes the restore.
    await writeJournal(root, { ...journal, committed: true });
  } catch (error) {
    await settleJournal(library, source, true, now).catch(() => undefined);
    await removeIfEmpty(partial).catch(() => undefined);
    // Without a journal nothing was swapped: staging folders are only our copies.
    if (!(await exists(path.join(root, JOURNAL))))
      for (const folder of staged)
        await fs
          .rm(folder.staging, { recursive: true, force: true })
          .catch(() => undefined);
    throw error;
  }
  try {
    await settleJournal(library, source, true, now);
  } catch {
    throw new SnapshotError('Restored; previous saves not yet published');
  }
  if (before.files.length) await prune(library, source.emulator, token);
  return { before: before.files.length ? info(token, before) : null };
}
