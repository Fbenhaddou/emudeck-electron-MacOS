/* eslint-disable no-restricted-syntax, no-await-in-loop -- Bounded, ordered file work. */
import { createHash } from 'crypto';
import { createReadStream, constants } from 'fs';
import fs from 'fs/promises';
import path from 'path';

/**
 * Versioned copies of an emulator's saves and save states, kept inside the
 * library (backups/saves/<emulator>/<id>/) so they travel with it. Nothing
 * here ever deletes or overwrites a user's save: restore moves the current
 * files into a new snapshot first, and pruning removes only old snapshots.
 */

export type SnapshotReason =
  | 'daily'
  | 'before-update'
  | 'before-reset'
  | 'before-controls'
  | 'before-restore'
  | 'manual';

/** One emulator's save folders, by stable name (e.g. saves → User/GC). */
export interface SnapshotSource {
  emulator: string;
  folders: Readonly<Record<string, string>>;
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

const KEEP = 30;
const MAX_FILES = 50000;
const MAX_DEPTH = 16;
/** Clone on APFS (no extra space), copy elsewhere; never overwrite. */
// eslint-disable-next-line no-bitwise -- copyfile flags.
const COPY_FLAGS = constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL;
const ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-z-]+$/;
const EMULATOR = /^[a-z][a-z0-9-]*$/;
const FOLDER = /^[a-z][a-z0-9-]*$/;
const REASONS: readonly SnapshotReason[] = [
  'daily',
  'before-update',
  'before-reset',
  'before-controls',
  'before-restore',
  'manual',
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

async function realDirectory(target: string): Promise<boolean> {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat) return false;
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new SnapshotError('A save folder is not a real folder');
  return true;
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

/** Current save files, as they would appear in a manifest (without hashes). */
async function currentFiles(source: SnapshotSource) {
  const files: Array<Found & { path: string }> = [];
  for (const [name, folder] of Object.entries(source.folders)) {
    if (!(await realDirectory(folder))) continue; // eslint-disable-line no-continue
    for (const item of await walk(folder))
      files.push({ ...item, path: `${name}/${item.relative}` });
  }
  return files;
}

function stamp(now: Date, reason: SnapshotReason): string {
  return `${now.toISOString().replace(/:/g, '-').replace('.', '-')}-${reason}`;
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

/** Complete snapshots, newest first. Incomplete (.partial) ones are not listed. */
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

/**
 * Finishes a restore that was interrupted after the live folders were moved
 * aside: any live folder that is missing is moved back from the newest
 * before-restore snapshot still marked partial. Never deletes anything.
 */
export async function recoverInterrupted(
  library: string,
  source: SnapshotSource,
): Promise<void> {
  checkSource(source);
  const root = snapshotRoot(library, source.emulator);
  if (!(await realDirectory(root))) return;
  const partial = (await fs.readdir(root))
    .filter((name) => name.endsWith('-before-restore.partial'))
    .sort()
    .reverse();
  for (const name of partial) {
    for (const [folder, live] of Object.entries(source.folders)) {
      const moved = path.join(root, name, folder);
      const liveExists = await fs.lstat(live).then(
        () => true,
        () => false,
      );
      if (!liveExists && (await realDirectory(moved)))
        await fs.rename(moved, live);
    }
  }
}

/** Writes a manifest for the files already in `directory`, verifying each. */
async function seal(
  directory: string,
  source: SnapshotSource,
  reason: SnapshotReason,
  now: Date,
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
    folders: Object.keys(source.folders),
    files,
  };
  await fs.writeFile(
    path.join(directory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx' },
  );
  return manifest;
}

/** Removes only this app's own oldest complete snapshots beyond the limit. */
async function prune(library: string, emulator: string): Promise<void> {
  const root = snapshotRoot(library, emulator);
  const complete = await listSnapshots(library, emulator);
  for (const old of complete.slice(KEEP)) {
    const directory = path.join(root, old.id);
    // Only folders this module created and sealed: ID pattern plus manifest.
    if (ID.test(old.id) && (await realDirectory(directory)))
      await fs.rm(directory, { recursive: true });
  }
}

/**
 * Copies the source's save folders into a new snapshot (APFS clones where the
 * volume supports them). Returns null when there is nothing to save, or for a
 * daily snapshot when nothing changed since the newest one. The caller must
 * ensure the emulator is not running.
 */
export async function takeSnapshot(
  library: string,
  source: SnapshotSource,
  reason: SnapshotReason,
  now = new Date(),
): Promise<SnapshotInfo | null> {
  checkSource(source);
  await recoverInterrupted(library, source);
  const files = await currentFiles(source);
  if (!files.length) return null;
  const root = snapshotRoot(library, source.emulator);
  if (reason === 'daily') {
    const [latest] = await listSnapshots(library, source.emulator);
    if (latest) {
      const manifest = await readManifest(path.join(root, latest.id));
      const fingerprint = (
        list: Array<{ path: string; bytes: number; modified: number }>,
      ) =>
        list
          .map((file) => `${file.path}\0${file.bytes}\0${file.modified}`)
          .join('\n');
      const age = now.getTime() - Date.parse(manifest.created);
      if (
        age < 24 * 3600 * 1000 ||
        fingerprint(manifest.files) === fingerprint(files)
      )
        return null;
    }
  }
  await makeDirectories(library, path.relative(library, root));
  const id = stamp(now, reason);
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
    manifest = await seal(partial, source, reason, now, modified);
    await fs.rename(partial, path.join(root, id));
  } catch (error) {
    // Only this snapshot's own incomplete folder is removed.
    await fs
      .rm(partial, { recursive: true, force: true })
      .catch(() => undefined);
    throw error;
  }
  await prune(library, source.emulator);
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
 * Restores a snapshot byte for byte. Order: verify the snapshot; build
 * verified copies beside the live folders; move the live folders into a new
 * before-restore snapshot; move the copies into place; seal. The caller must
 * ensure the emulator is not running and the person confirmed.
 */
export async function restoreSnapshot(
  library: string,
  source: SnapshotSource,
  id: string,
  now = new Date(),
): Promise<{ before: SnapshotInfo | null }> {
  checkSource(source);
  await recoverInterrupted(library, source);
  const manifest = await verifySnapshot(library, source.emulator, id);
  const root = snapshotRoot(library, source.emulator);
  const snapshot = path.join(root, id);
  const staged: Record<string, string> = {};
  const token = stamp(now, 'before-restore');
  try {
    for (const [name, live] of Object.entries(source.folders)) {
      const staging = `${live}.restoring-${token}`;
      await makeDirectories(path.dirname(live), path.basename(staging));
      staged[name] = staging;
      for (const file of manifest.files.filter((item) =>
        item.path.startsWith(`${name}/`),
      )) {
        const parts = file.path.split('/').slice(1);
        await makeDirectories(staging, parts.slice(0, -1).join('/'));
        const target = path.join(staging, ...parts);
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
    for (const staging of Object.values(staged))
      await fs
        .rm(staging, { recursive: true, force: true })
        .catch(() => undefined);
    throw error;
  }
  const beforePartial = path.join(root, `${token}.partial`);
  await fs.mkdir(beforePartial);
  const modified = new Map<string, number>();
  for (const file of await currentFiles(source))
    modified.set(file.path, file.modified);
  for (const [name, live] of Object.entries(source.folders)) {
    if (await realDirectory(live))
      await fs.rename(live, path.join(beforePartial, name));
    await fs.rename(staged[name], live);
  }
  const beforeManifest = await seal(
    beforePartial,
    source,
    'before-restore',
    now,
    modified,
  );
  await fs.rename(beforePartial, path.join(root, token));
  await prune(library, source.emulator);
  return {
    before: beforeManifest.files.length ? info(token, beforeManifest) : null,
  };
}
