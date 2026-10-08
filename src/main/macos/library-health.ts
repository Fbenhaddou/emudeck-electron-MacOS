/* eslint-disable no-restricted-syntax, no-await-in-loop -- Bounded, ordered inspection. */
import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import {
  inspectGameEntry,
  isCompanionFolder,
} from '../components/shared/games';
import type { ComponentAdapter } from '../components/types';

/**
 * A read-only check of a library's game folders. It never changes anything;
 * the only fix it supports (moving a game to its right system folder) is done
 * by `moveToSystem`, after the person confirms, and never overwrites.
 */

export type HealthKind =
  | 'wrong-system'
  | 'unsupported'
  | 'empty'
  | 'duplicate'
  | 'link'
  | 'apple-double'
  | 'incomplete-folder'
  | 'multi-disc'
  | 'outside-system';

export interface HealthIssue {
  /** Stable within one check: kind plus the library-relative path. */
  id: string;
  kind: HealthKind;
  /** Library-relative POSIX path of the file or folder. */
  path: string;
  /** For wrong-system: the system id it belongs in. */
  target?: string;
  /** For duplicate: the library-relative path it matches. */
  other?: string;
}

export interface HealthReport {
  checked: number;
  issues: HealthIssue[];
  /** True when a size limit stopped the check early. */
  truncated: boolean;
}

const MAX_ENTRIES = 20000;
const SAMPLE = 1024 * 1024;
/** Files people keep beside games that are never reported as unsupported. */
const COMPANIONS = new Set([
  '.txt',
  '.nfo',
  '.md',
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.m3u',
  '.cue',
  '.sav',
  '.srm',
  '.ds_store',
]);
const DISC =
  /^(.*?)[\s._-]*[([]?\s*(?:disc|disk|cd)\s*(\d+)(?:\s*of\s*\d+)?\s*[)\]]?/i;

function relative(library: string, target: string): string {
  return path.relative(library, target).split(path.sep).join('/');
}

/** Hash of the first and last MiB: cheap, and equal for identical files. */
async function sampleHash(file: string, size: number): Promise<string> {
  const handle = await fs.open(file, 'r');
  try {
    const hash = createHash('sha256');
    const read = async (position: number) => {
      const length = Math.min(SAMPLE, size - position);
      if (length <= 0) return;
      const buffer = new Uint8Array(length);
      await handle.read(buffer, 0, length, position);
      hash.update(buffer);
    };
    await read(0);
    if (size > SAMPLE) await read(Math.max(SAMPLE, size - SAMPLE));
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

export async function checkLibrary(
  library: string,
  adapters: readonly ComponentAdapter[],
): Promise<HealthReport> {
  const issues: HealthIssue[] = [];
  let checked = 0;
  let truncated = false;
  const add = (issue: Omit<HealthIssue, 'id'>) =>
    issues.push({ ...issue, id: `${issue.kind}:${issue.path}` });
  // Extensions only one system plays: a file with one elsewhere is misplaced.
  const owners = new Map<string, Set<string>>();
  for (const adapter of adapters)
    for (const extension of adapter.manifest.romExtensions)
      owners.set(
        extension,
        new Set([...(owners.get(extension) || []), adapter.system.id]),
      );
  const sizes = new Map<number, string[]>();
  const romsRoot = path.join(library, 'roms');
  const systemFolders = new Set(
    adapters.map((adapter) => path.basename(adapter.paths(library).roms)),
  );

  for (const adapter of adapters) {
    const { roms } = adapter.paths(library);
    const names = (await fs.readdir(roms).catch(() => [] as string[])).sort();
    const discs = new Map<string, string[]>();
    for (const name of names) {
      if (checked >= MAX_ENTRIES) {
        truncated = true;
        break;
      }
      checked += 1;
      const entry = path.join(roms, name);
      const where = relative(library, entry);
      const stat = await fs.lstat(entry).catch(() => null);
      if (!stat) continue; // eslint-disable-line no-continue
      if (name.startsWith('._')) {
        add({ kind: 'apple-double', path: where });
        continue; // eslint-disable-line no-continue
      }
      if (name.startsWith('.')) continue; // eslint-disable-line no-continue
      if (stat.isSymbolicLink()) {
        add({ kind: 'link', path: where });
        continue; // eslint-disable-line no-continue
      }
      const extension = path.extname(name).toLowerCase();
      if (stat.isDirectory()) {
        const spec = adapter.manifest.folderGame;
        if (!spec) continue; // eslint-disable-line no-continue
        // Update and DLC folders beside their game are the expected layout.
        if (isCompanionFolder(name, spec)) continue; // eslint-disable-line no-continue
        if (!(await inspectGameEntry(roms, name, adapter.manifest)))
          add({ kind: 'incomplete-folder', path: where });
        continue; // eslint-disable-line no-continue
      }
      if (!stat.isFile()) continue; // eslint-disable-line no-continue
      const plays = adapter.manifest.romExtensions.includes(extension);
      const elsewhere = [...(owners.get(extension) || [])].filter(
        (system) => system !== adapter.system.id,
      );
      if (!plays && elsewhere.length === 1)
        add({ kind: 'wrong-system', path: where, target: elsewhere[0] });
      else if (!plays && !COMPANIONS.has(extension))
        add({ kind: 'unsupported', path: where });
      if (!plays) continue; // eslint-disable-line no-continue
      if (stat.size === 0) {
        add({ kind: 'empty', path: where });
        continue; // eslint-disable-line no-continue
      }
      sizes.set(stat.size, [...(sizes.get(stat.size) || []), entry]);
      const disc = DISC.exec(path.basename(name, extension));
      if (disc) {
        const key = disc[1].trim().toLowerCase();
        discs.set(key, [...(discs.get(key) || []), where]);
      }
    }
    for (const [key, set] of discs) {
      if (set.length < 2) continue; // eslint-disable-line no-continue
      const playlist = names.some(
        (name) =>
          path.extname(name).toLowerCase() === '.m3u' &&
          path.basename(name, path.extname(name)).trim().toLowerCase() === key,
      );
      if (!playlist) add({ kind: 'multi-disc', path: set[0] });
    }
  }

  // Loose files beside the system folders, where no emulator will look.
  for (const name of (
    await fs.readdir(romsRoot).catch(() => [] as string[])
  ).sort()) {
    if (name.startsWith('.') || systemFolders.has(name)) continue; // eslint-disable-line no-continue
    const stat = await fs.lstat(path.join(romsRoot, name)).catch(() => null);
    const extension = path.extname(name).toLowerCase();
    if (stat?.isFile() && owners.has(extension))
      add({
        kind: 'outside-system',
        path: relative(library, path.join(romsRoot, name)),
        ...(owners.get(extension)!.size === 1
          ? { target: [...owners.get(extension)!][0] }
          : {}),
      });
  }

  // Likely duplicates: same size and same first/last MiB.
  for (const group of sizes.values()) {
    if (group.length < 2) continue; // eslint-disable-line no-continue
    const seen = new Map<string, string>();
    for (const file of group) {
      const { size } = await fs.lstat(file);
      const hash = await sampleHash(file, size).catch(() => null);
      if (!hash) continue; // eslint-disable-line no-continue
      const first = seen.get(hash);
      if (first)
        add({
          kind: 'duplicate',
          path: relative(library, file),
          other: relative(library, first),
        });
      else seen.set(hash, file);
    }
  }
  return { checked, issues, truncated };
}

/**
 * Moves one misplaced game into the system folder it belongs in. Refuses
 * anything but a regular file directly inside a roms folder, a target outside
 * the library, or an existing file of the same name: nothing is overwritten.
 */
export async function moveToSystem(
  library: string,
  relativePath: string,
  adapter: ComponentAdapter,
): Promise<string> {
  const parts = relativePath.split('/');
  if (
    parts[0] !== 'roms' ||
    parts.length < 2 ||
    parts.length > 3 ||
    parts.some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Not a game in the library');
  const source = path.join(library, ...parts);
  const stat = await fs.lstat(source);
  if (!stat.isFile() || (await fs.realpath(source)) !== source)
    throw new Error('Not a game in the library');
  const { roms } = adapter.paths(library);
  await fs.mkdir(roms, { recursive: true });
  const folder = await fs.lstat(roms);
  if (!folder.isDirectory() || folder.isSymbolicLink())
    throw new Error('System folder is not a real folder');
  const target = path.join(roms, path.basename(source));
  try {
    // link + unlink is a move that fails instead of replacing an existing file.
    await fs.link(source, target);
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'EEXIST')
      throw new Error('A file with that name is already there');
    // exFAT and some network volumes have no hard links: check, then rename.
    if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EXDEV') throw error;
    if (
      await fs.lstat(target).then(
        () => true,
        () => false,
      )
    )
      throw new Error('A file with that name is already there');
    await fs.rename(source, target);
    return relative(library, target);
  }
  await fs.unlink(source);
  return relative(library, target);
}
