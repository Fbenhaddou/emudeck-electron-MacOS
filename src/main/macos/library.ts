import fs from 'fs/promises';
import { constants } from 'fs';
import path from 'path';
import type { LibraryInfo } from '../../shared/macos';

interface SavedLibrary {
  format: 'emulation-workspace-library';
  version: 1;
  path: string;
}

function validState(value: unknown): value is SavedLibrary {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<SavedLibrary>;
  return (
    state.format === 'emulation-workspace-library' &&
    state.version === 1 &&
    typeof state.path === 'string' &&
    path.isAbsolute(state.path) &&
    !state.path.includes('\0')
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
  const available = await fs.stat(state.path).then(
    (stat) => stat.isDirectory(),
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
  if (!(await fs.stat(canonical)).isDirectory())
    throw new Error('Choose a folder.');
  await fs.access(canonical, constants.R_OK | constants.W_OK);
  // Refuse to replace unknown settings, directories or symlinks.
  await readLibrary(statePath);
  const state: SavedLibrary = {
    format: 'emulation-workspace-library',
    version: 1,
    path: canonical,
  };
  await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
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
