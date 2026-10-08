import fs from 'fs/promises';
import path from 'path';
import type { ComponentManifest, FolderGameSpec } from '../types';

/** A game found in a system's roms folder. */
export interface GameEntry {
  kind: 'file' | 'folder';
  /** The game's identity: the file, or the game folder. */
  path: string;
  /** What the emulator is given: the file, or the folder's launch marker. */
  launchPath: string;
  /** Display name: file name without extension, or the folder name. */
  name: string;
}

const REFUSAL = 'Choose a supported game inside this library';

/** lstat that treats anything unreadable as absent. */
function inspect(target: string) {
  return fs.lstat(target).catch(() => null);
}

/** True when the folder name marks an update or DLC folder beside a game. */
export function isCompanionFolder(name: string, spec: FolderGameSpec): boolean {
  const lower = name.toLowerCase();
  return spec.companionSuffixes.some((suffix) =>
    lower.endsWith(suffix.toLowerCase()),
  );
}

/**
 * Checks every marker is a non-empty regular file reached through real
 * folders only (no symlink at any step). Returns the launch target, or null.
 * Bounded: at most eight markers of at most four segments (see schema).
 */
async function folderLaunchTarget(
  folder: string,
  spec: FolderGameSpec,
): Promise<string | null> {
  // eslint-disable-next-line no-restricted-syntax -- Few, bounded, sequential checks.
  for (const marker of spec.markers) {
    const parts = marker.split('/');
    let current = folder;
    // eslint-disable-next-line no-restricted-syntax
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      // eslint-disable-next-line no-await-in-loop
      const stat = await inspect(current);
      if (!stat || stat.isSymbolicLink()) return null;
      const last = index === parts.length - 1;
      if (!last && !stat.isDirectory()) return null;
      if (last && (!stat.isFile() || stat.size === 0)) return null;
    }
  }
  // The on-disk spelling (case-insensitive volumes may store EBOOT.BIN).
  return fs
    .realpath(path.join(folder, ...spec.launchTarget.split('/')))
    .catch(() => null);
}

/**
 * Whether one entry of a roms folder is a game. Never follows links: the
 * entry must be its own canonical path, so nothing outside the library is
 * reached. Hidden entries and update/DLC folders are never games.
 */
export async function inspectGameEntry(
  roms: string,
  name: string,
  manifest: ComponentManifest,
): Promise<GameEntry | null> {
  if (name.startsWith('.') || name.includes('/')) return null;
  const entry = path.join(roms, name);
  const stat = await inspect(entry);
  if (!stat || stat.isSymbolicLink()) return null;
  if ((await fs.realpath(entry).catch(() => null)) !== entry) return null;
  if (stat.isFile()) {
    const extension = path.extname(name).toLowerCase();
    if (!manifest.romExtensions.includes(extension)) return null;
    return {
      kind: 'file',
      path: entry,
      launchPath: entry,
      name: path.basename(name, path.extname(name)).normalize('NFC'),
    };
  }
  const spec = manifest.folderGame;
  if (!stat.isDirectory() || !spec || isCompanionFolder(name, spec))
    return null;
  const launchPath = await folderLaunchTarget(entry, spec);
  return launchPath
    ? { kind: 'folder', path: entry, launchPath, name: name.normalize('NFC') }
    : null;
}

/**
 * Validates a game chosen for launch and returns what the emulator is given.
 * Accepts a supported file inside the roms folder (top level only for systems
 * with folder games), a folder game directly inside it, or that folder game's
 * own launch target. Accepted residual risks, both needing write access to the
 * library: a marker swapped for a link between this check and the emulator
 * opening it, and files hard-linked into the library.
 */
export async function resolveGame(
  roms: string,
  manifest: ComponentManifest,
  game: string,
): Promise<string> {
  const canonical = await fs.realpath(game).catch(() => null);
  if (!canonical || canonical !== game || !canonical.startsWith(`${roms}/`))
    throw new Error(REFUSAL);
  const stat = await inspect(canonical);
  if (!stat || stat.isSymbolicLink()) throw new Error(REFUSAL);
  const topLevel = path.dirname(canonical) === roms;
  if (
    stat.isFile() &&
    manifest.romExtensions.includes(path.extname(canonical).toLowerCase()) &&
    // With folder games, a loose file must not come from inside a game,
    // update or DLC folder.
    (!manifest.folderGame || topLevel)
  )
    return canonical;
  if (!manifest.folderGame) throw new Error(REFUSAL);
  // A folder game, or the launch target inside one: judge the top-level folder.
  const [top] = path.relative(roms, canonical).split(path.sep);
  const folder = await inspectGameEntry(roms, top, manifest);
  if (
    folder?.kind === 'folder' &&
    (canonical === folder.path || canonical === folder.launchPath)
  )
    return folder.launchPath;
  throw new Error(REFUSAL);
}
