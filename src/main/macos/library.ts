import { execFile } from 'child_process';
import fs from 'fs/promises';
import { constants } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { LibraryInfo } from '../../shared/macos';

interface SavedLibrary {
  format: 'emulation-workspace-library';
  version: 1;
  path: string;
  /** Internal disk: device and inode of the library folder (stable there). */
  identity?: { device: string; inode: string };
  /**
   * External drive: which volume, and where on it. Device numbers change when
   * drives are re-plugged and exFAT inodes are synthetic, so a drive is known
   * by its volume UUID; its mount path may change ("Games 1", a rename).
   */
  volume?: { uuid: string; relative: string };
}

/** Reads a mounted volume's UUID; null when it has none (some network shares). */
export type VolumeProbe = (mountPoint: string) => Promise<string | null>;

const UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

/** `diskutil info -plist <mount>`, argv only; only the VolumeUUID value is used. */
export const diskutilProbe: VolumeProbe = (mountPoint) =>
  new Promise((resolve) => {
    execFile(
      '/usr/sbin/diskutil',
      ['info', '-plist', mountPoint],
      { timeout: 5000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        const match =
          /<key>VolumeUUID<\/key>\s*<string>([0-9A-Fa-f-]{36})<\/string>/.exec(
            stdout || '',
          );
        resolve(!error && match ? match[1].toUpperCase() : null);
      },
    );
  });

export interface LibraryEnvironment {
  /** Where external volumes mount; '/Volumes' on macOS. */
  volumesRoot: string;
  probe: VolumeProbe;
}

const defaultEnvironment: LibraryEnvironment = {
  volumesRoot: '/Volumes',
  probe: diskutilProbe,
};

/** The /Volumes/<name> mount and the rest of the path, for external drives. */
function splitVolume(
  target: string,
  volumesRoot: string,
): { mount: string; relative: string } | null {
  const rest = path.relative(volumesRoot, target);
  if (!rest || rest.startsWith('..') || path.isAbsolute(rest)) return null;
  const [name, ...parts] = rest.split(path.sep);
  return { mount: path.join(volumesRoot, name), relative: parts.join('/') };
}

async function realFolder(target: string): Promise<boolean> {
  return fs.lstat(target).then(
    async (stat) =>
      stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      (await fs.realpath(target)) === target,
    () => false,
  );
}

async function writeState(statePath: string, state: SavedLibrary) {
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
        /^\d+$/.test(state.identity.inode))) &&
    (state.volume === undefined ||
      (state.volume !== null &&
        typeof state.volume === 'object' &&
        typeof state.volume.uuid === 'string' &&
        UUID.test(state.volume.uuid) &&
        typeof state.volume.relative === 'string' &&
        !state.volume.relative.split('/').some((part) => part === '..') &&
        !state.volume.relative.includes('\0')))
  );
}

export async function readLibrary(
  statePath: string,
  environment: LibraryEnvironment = defaultEnvironment,
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
  const { volume } = state;
  if (volume) {
    // The recorded place, if that drive is the right drive.
    const recorded = splitVolume(state.path, environment.volumesRoot);
    if (
      recorded &&
      (await realFolder(state.path)) &&
      (await environment.probe(recorded.mount)) === volume.uuid
    )
      return { path: state.path, available: true };
    // The same drive mounted elsewhere ("Games 1", or renamed): find it.
    const names = await fs
      .readdir(environment.volumesRoot)
      .catch(() => [] as string[]);
    // eslint-disable-next-line no-restricted-syntax -- Few mounted volumes.
    for (const name of names.sort()) {
      const mount = path.join(environment.volumesRoot, name);
      const candidate = volume.relative
        ? path.join(mount, ...volume.relative.split('/'))
        : mount;
      if (
        candidate !== state.path &&
        // eslint-disable-next-line no-await-in-loop
        (await realFolder(candidate)) &&
        // eslint-disable-next-line no-await-in-loop
        (await environment.probe(mount)) === volume.uuid
      ) {
        // eslint-disable-next-line no-await-in-loop
        await writeState(statePath, { ...state, path: candidate });
        return { path: candidate, available: true };
      }
    }
    return { path: state.path, available: false };
  }
  const external = splitVolume(state.path, environment.volumesRoot);
  const available = await fs.lstat(state.path).then(
    async (stat) =>
      stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      (await fs.realpath(state.path)) === state.path &&
      (external && !state.identity
        ? // A volume without a UUID (a network share) is known by path alone.
          (await environment.probe(external.mount)) === null
        : Boolean(
            state.identity &&
            state.identity.device === String(stat.dev) &&
            state.identity.inode === String(stat.ino),
          )),
    () => false,
  );
  // An external library chosen before volume identity: upgrade it while the
  // old identity still proves it is the same folder.
  if (available && external && state.identity) {
    const uuid = await environment.probe(external.mount);
    if (uuid)
      await writeState(statePath, {
        format: state.format,
        version: state.version,
        path: state.path,
        volume: { uuid, relative: external.relative },
      }).catch(() => undefined);
  }
  return { path: state.path, available };
}

// Selecting a library never renames, deletes or creates files inside it.
// Emulator-specific folders belong to a future explicit installation transaction.
export async function selectLibrary(
  statePath: string,
  selected: string,
  environment: LibraryEnvironment = defaultEnvironment,
): Promise<LibraryInfo> {
  if (!path.isAbsolute(selected) || selected.includes('\0'))
    throw new Error('Choose an absolute folder path.');
  const canonical = await fs.realpath(selected);
  const identity = await fs.stat(canonical);
  if (!identity.isDirectory()) throw new Error('Choose a folder.');
  await fs.access(canonical, constants.R_OK);
  await fs.access(canonical, constants.W_OK);
  // Refuse to replace unknown settings, directories or symlinks.
  await readLibrary(statePath, environment);
  const external = splitVolume(canonical, environment.volumesRoot);
  const uuid = external ? await environment.probe(external.mount) : null;
  const state: SavedLibrary = {
    format: 'emulation-workspace-library',
    version: 1,
    path: canonical,
    ...(external && uuid
      ? { volume: { uuid, relative: external.relative } }
      : {}),
    ...(!external
      ? {
          identity: {
            device: String(identity.dev),
            inode: String(identity.ino),
          },
        }
      : {}),
  };
  const current = await fs.lstat(canonical);
  if (
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    current.dev !== identity.dev ||
    current.ino !== identity.ino
  )
    throw new Error('Library changed while selecting its location');
  await writeState(statePath, state);
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
