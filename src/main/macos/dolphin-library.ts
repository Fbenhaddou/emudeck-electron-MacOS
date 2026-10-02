import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { dolphin } from '../components/dolphin';

// These checks reject existing symlinks and recheck boundaries before mutation.
// Node path APIs cannot prevent an external process swapping ancestors between
// check and use; this is not protection against a malicious concurrent local actor.
const operations = new Map<string, Promise<unknown>>();

function serialized<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const key = path.resolve(root);
  const previous = operations.get(key) || Promise.resolve();
  const pending = previous.catch(() => undefined).then(operation);
  operations.set(key, pending);
  const cleanup = () => {
    if (operations.get(key) === pending) operations.delete(key);
  };
  // eslint-disable-next-line promise/catch-or-return -- Both settlement handlers are nonthrowing cleanup.
  pending.then(cleanup, cleanup);
  return pending;
}

async function assertRealDirectory(directory: string): Promise<void> {
  const stat = await fs.lstat(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (await fs.realpath(directory)) !== directory
  )
    throw new Error('Library directory is not a real folder');
}

/** Check existing directory boundaries; caller owns operation serialization. */
export async function ensureDirectory(
  root: string,
  directory: string,
): Promise<void> {
  if (
    (await fs.realpath(root)) !== root ||
    !(await fs.lstat(root)).isDirectory()
  )
    throw new Error('Library root changed');
  const relative = path.relative(root, directory);
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Directory is outside library');
  let current = root;
  // eslint-disable-next-line no-restricted-syntax -- Parent directories must be checked before their children.
  for (const part of relative.split(path.sep).filter(Boolean)) {
    // eslint-disable-next-line no-await-in-loop -- Recheck parent before mutation.
    await assertRealDirectory(current);
    current = path.join(current, part);
    // eslint-disable-next-line no-await-in-loop -- Check every boundary before writing below it.
    await fs.mkdir(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    // eslint-disable-next-line no-await-in-loop -- Do not follow a user-controlled symlink.
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('Library directory is not a real folder');
  }
}

// Dolphin's Metal/VideoBackend.h names this backend Metal; MainSettings.cpp
// defines GFXBackend in Core. Leave all other upstream defaults untouched.
// The managed preview opts out of emulator analytics explicitly. PermissionAsked
// suppresses an unrelated first-run prompt; it never enables collection.
const defaults =
  '[Core]\nGFXBackend = Metal\n[Analytics]\nEnabled = False\nPermissionAsked = True\n';
async function prepare(root: string): Promise<void> {
  const directories = dolphin.paths(root);
  // eslint-disable-next-line no-restricted-syntax -- Avoid concurrent traversal of shared ancestors.
  for (const directory of Object.values(directories)) {
    // eslint-disable-next-line no-await-in-loop -- Preserve directory validation order.
    await ensureDirectory(root, directory);
  }
  const config = path.join(directories.configuration, 'Dolphin.ini');
  await assertRealDirectory(directories.configuration);
  try {
    await fs.writeFile(config, defaults, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const stat = await fs.lstat(config);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('Configuration is not a regular file');
  }
}

export function prepareDolphinLibrary(root: string): Promise<void> {
  return serialized(root, () => prepare(root));
}

export interface DolphinResetResult {
  backupPath: string;
}

export class DolphinResetError extends Error {
  constructor(
    public readonly backupPath: string,
    public readonly restored: boolean,
  ) {
    super(
      restored
        ? 'Reset failed. The original configuration was restored.'
        : 'Reset failed. The original configuration is preserved in the backup folder.',
    );
    this.name = 'DolphinResetError';
  }
}

/** Caller must also prevent reset while Dolphin is running. No saves are deleted. */
export function resetDolphinConfiguration(
  root: string,
): Promise<DolphinResetResult> {
  return serialized(root, async () => {
    const directories = dolphin.paths(root);
    await prepare(root);
    const backupPath = path.join(
      directories.user,
      `Config.backup-${randomUUID()}`,
    );
    await assertRealDirectory(directories.configuration);
    await fs.rename(directories.configuration, backupPath);
    try {
      await prepare(root);
      return { backupPath };
    } catch {
      // Never replace or delete a partial/new configuration to restore a backup.
      // Restore only when no replacement directory exists; otherwise leave both
      // available and report the original backup's exact location to the caller.
      let restored = false;
      try {
        await assertRealDirectory(directories.user);
        const missing = await fs.lstat(directories.configuration).then(
          () => false,
          (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return true;
            throw error;
          },
        );
        if (missing) {
          await fs.rename(backupPath, directories.configuration);
          restored = true;
        }
      } catch {
        // Original remains in backupPath for recovery.
      }
      throw new DolphinResetError(
        restored ? directories.configuration : backupPath,
        restored,
      );
    }
  });
}

export async function validateGame(
  root: string,
  file: string,
): Promise<string> {
  const { roms } = dolphin.paths(root);
  const canonical = await fs.realpath(file);
  if (
    !canonical.startsWith(`${roms}${path.sep}`) ||
    canonical !== file ||
    !dolphin.manifest.romExtensions.includes(path.extname(file).toLowerCase())
  )
    throw new Error('Choose a supported GameCube file inside this library');
  const stat = await fs.lstat(canonical);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('Game is not a regular file');
  return canonical;
}
