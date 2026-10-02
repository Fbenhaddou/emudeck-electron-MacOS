import fs from 'fs/promises';
import { constants } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { LibraryInfo } from '../../shared/macos';

interface SavedLibrary {
  format: 'emulation-workspace-library';
  version: 1;
  path: string;
  identity?: { device: string; inode: string };
}

function validState(value: unknown): value is SavedLibrary {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<SavedLibrary>;
  return (
    state.format === 'emulation-workspace-library' &&
    state.version === 1 &&
    typeof state.path === 'string' &&
    path.isAbsolute(state.path) &&
    !state.path.includes('\0') &&
    (state.identity === undefined ||
      (state.identity !== null &&
        typeof state.identity === 'object' &&
        typeof state.identity.device === 'string' &&
        /^\d+$/.test(state.identity.device) &&
        typeof state.identity.inode === 'string' &&
        /^\d+$/.test(state.identity.inode)))
  );
}

export async function readLibrary(
  statePath: string,
): Promise<LibraryInfo | null> {
  let data: string;
  try {
    const stat = await fs.lstat(statePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) {
      throw new Error('Library settings are not a supported regular file.');
    }
    data = await fs.readFile(statePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const state: unknown = JSON.parse(data);
  if (!validState(state))
    throw new Error('Library settings have an unsupported format.');
  const available = await fs.lstat(state.path).then(
    async (stat) =>
      stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      (await fs.realpath(state.path)) === state.path &&
      Boolean(
        state.identity &&
        state.identity.device === String(stat.dev) &&
        state.identity.inode === String(stat.ino),
      ),
    () => false,
  );
  return { path: state.path, available };
}

// Selecting a library never renames, deletes or creates files inside it.
// Emulator-specific folders belong to a future explicit installation transaction.
export async function selectLibrary(
  statePath: string,
  selected: string,
): Promise<LibraryInfo> {
  if (!path.isAbsolute(selected) || selected.includes('\0'))
    throw new Error('Choose an absolute folder path.');
  const canonical = await fs.realpath(selected);
  const identity = await fs.stat(canonical);
  if (!identity.isDirectory()) throw new Error('Choose a folder.');
  await fs.access(canonical, constants.R_OK);
  await fs.access(canonical, constants.W_OK);
  // Refuse to replace unknown settings, directories or symlinks.
  await readLibrary(statePath);
  const state: SavedLibrary = {
    format: 'emulation-workspace-library',
    version: 1,
    path: canonical,
    identity: {
      device: String(identity.dev),
      inode: String(identity.ino),
    },
  };
  await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
  const current = await fs.lstat(canonical);
  if (
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    current.dev !== identity.dev ||
    current.ino !== identity.ino
  )
    throw new Error('Library changed while selecting its location');
  const temporary = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    await fs.rename(temporary, statePath);
  } finally {
    await fs.unlink(temporary).catch(() => undefined);
  }
  return { path: canonical, available: true };
}

/** Explicit recovery of this Mac's corrupt preference; never touches portable library data. */
export async function recoverLibrarySettings(
  statePath: string,
): Promise<string> {
  const stat = await fs.lstat(statePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024)
    throw new Error(
      'Settings recovery requires a bounded regular preference file',
    );
  let corrupt = false;
  try {
    await readLibrary(statePath);
  } catch {
    corrupt = true;
  }
  if (!corrupt) throw new Error('Existing library settings are valid');
  const current = await fs.lstat(statePath);
  if (
    !current.isFile() ||
    current.isSymbolicLink() ||
    current.dev !== stat.dev ||
    current.ino !== stat.ino ||
    current.size !== stat.size
  )
    throw new Error('Settings changed during recovery');
  const backup = `${statePath}.backup-${randomUUID()}`;
  await fs.rename(statePath, backup);
  return backup;
}
