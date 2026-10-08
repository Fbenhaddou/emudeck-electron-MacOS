/* eslint-disable no-bitwise -- POSIX permission checks are bit masks. */
import { execFile, spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { dolphin } from '../components/dolphin';
import { applyManagedInput, isInputFamily } from '../components/dolphin/input';
import { detectControllers, primaryController } from './controllers';
import { diagnosticEvent } from './diagnostics';
import { readStickResponse } from './preferences';
import { prepareDolphinLibrary } from './dolphin-library';
import { createSystemsCatalog } from '../components/es-de/catalog';
import { inspectGameEntry } from '../components/shared/games';
import { stableGameID } from '../components/es-de/ids';
import { installedFrontend } from '../components/es-de/install';
import { publishProfile } from '../components/es-de/profile';
import { startConsoleBroker } from './console-broker';
import type {
  ConsoleDependencies,
  ConsoleGame,
  ConsoleSystem,
} from './console-session';
import type { ComponentAdapter } from '../components/types';
import { relativeGamePath } from './console-session';
import { restoreFocus } from './focus';

const MAX_GAMES = 10000;
/** Entries inspected per system folder, games or not: bounds work on huge folders. */
const MAX_SCANNED = 20000;

export interface ConsoleHostPaths {
  /** Machine-local, private: managed ES-DE installations. */
  frontendRoot: string;
  /** Machine-local, private: the persistent ES-DE --home profile. */
  profileHome: string;
  /** Machine-local, private: secret keying stable opaque game IDs. */
  secretPath: string;
  /** Signed helper binaries shipped with the app. */
  launcherHelper: string;
  activateHelper: string;
  guardianHelper: string;
  /** Machine-local controller preferences (stick response). */
  preferencesFile: string;
}

export async function privateDirectory(directory: string): Promise<string> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o022) !== 0
  )
    throw new Error('Console Mode storage is not a private folder');
  return fs.realpath(directory);
}

async function readSecret(file: string): Promise<Uint8Array> {
  await privateDirectory(path.dirname(file));
  try {
    await fs.writeFile(file, Uint8Array.from(randomBytes(32)), {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const stat = await fs.lstat(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o077) !== 0 ||
    stat.size !== 32
  )
    throw new Error('Console Mode identity key is not a private file');
  return Uint8Array.from(await fs.readFile(file));
}

/** Supported top-level GameCube files; never follows links or leaves the library. */
/** One emulator offered in Console Mode: its ES-DE system and adapter. */
export interface ConsoleEmulator {
  system: ConsoleSystem;
  adapter: ComponentAdapter;
  installed(): Promise<boolean>;
}

/** Supported top-level games (files or folder games) per system; never follows links or leaves the library. */
export async function listGames(
  library: string,
  emulators: readonly ConsoleEmulator[],
): Promise<ConsoleGame[]> {
  const games: ConsoleGame[] = [];
  // eslint-disable-next-line no-restricted-syntax -- Bounded sequential inspection.
  for (const { system, adapter } of emulators) {
    const { roms } = adapter.paths(library);
    // eslint-disable-next-line no-await-in-loop
    const names = await fs.readdir(roms).catch(() => [] as string[]);
    // eslint-disable-next-line no-restricted-syntax -- Bounded sequential inspection.
    for (const name of names.sort().slice(0, MAX_SCANNED)) {
      if (games.length >= MAX_GAMES) break;
      // Cheap filter first: file-only systems never need to touch other names.
      if (
        !adapter.manifest.folderGame &&
        !adapter.manifest.romExtensions.includes(
          path.extname(name).toLowerCase(),
        )
      )
        continue; // eslint-disable-line no-continue
      // eslint-disable-next-line no-await-in-loop
      const entry = await inspectGameEntry(roms, name, adapter.manifest);
      if (entry)
        games.push({
          system: system.id,
          path: entry.path,
          relativePath: relativeGamePath(library, entry.path),
          name: entry.name,
        });
    }
  }
  return games;
}

/** PIDs whose executable is exactly the managed frontend (comm only; no arguments). */
export function strayFrontends(executable: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    execFile(
      '/bin/ps',
      ['-axo', 'pid=,comm='],
      { timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(new Error('Running applications could not be checked'));
          return;
        }
        resolve(
          stdout
            .split('\n')
            .map((line) => /^\s*(\d+)\s+(.+)$/.exec(line))
            .filter((match): match is RegExpExecArray =>
              Boolean(match && match[2] === executable),
            )
            .map((match) => Number(match[1]))
            .filter((pid) => pid > 1 && pid !== process.pid),
        );
      },
    );
  });
}

async function makeRuntime(launcherHelper: string): Promise<string> {
  // Short ASCII location: the socket path limit and the frontend's command parser.
  const root = await fs.realpath(await fs.mkdtemp('/private/tmp/ew-console-'));
  await fs.chmod(root, 0o700);
  const helper = path.join(root, 'helper');
  const original = await fs.readFile(launcherHelper);
  await fs.writeFile(helper, Uint8Array.from(original), {
    flag: 'wx',
    mode: 0o500,
  });
  if (
    Buffer.compare(
      Uint8Array.from(await fs.readFile(helper)),
      Uint8Array.from(original),
    ) !== 0
  )
    throw new Error('Console helper copy could not be verified');
  return root;
}

async function removeRuntime(root: string): Promise<void> {
  if (!/^\/private\/tmp\/ew-console-[A-Za-z0-9]{6}$/.test(root))
    throw new Error('Refusing to remove an unexpected location');
  await fs.chmod(path.join(root, 'helper'), 0o700).catch(() => undefined);
  await fs.rm(root, { recursive: true, force: true });
}

export function consoleDependencies(
  paths: ConsoleHostPaths,
  manager: { hide(): void; show(): void },
  emulators: readonly ConsoleEmulator[],
): ConsoleDependencies {
  return {
    systems: async () => {
      const available = await Promise.all(
        emulators.map((emulator) => emulator.installed().catch(() => false)),
      );
      return emulators
        .filter((_, index) => available[index])
        .map((emulator) => emulator.system);
    },
    frontend: async () =>
      installedFrontend(await privateDirectory(paths.frontendRoot)),
    listGames: (library) => listGames(library, emulators),
    gameID: async (library, game) => {
      // Library identity plus relative path: stable across remounts, even on
      // exFAT where per-file inodes are synthesized at each mount.
      const libraryStat = await fs.stat(library);
      return stableGameID(await readSecret(paths.secretPath), {
        volume: `library:${libraryStat.ino}`,
        file: 0,
        relativePath: game.relativePath,
      });
    },
    makeRuntime: () => makeRuntime(paths.launcherHelper),
    removeRuntime,
    createCatalog: createSystemsCatalog,
    publishProfile: async (home, catalog, entries) => {
      // Button glyphs follow the connected controller; unknown families keep ES-DE's default.
      const family = primaryController(await detectControllers())?.family;
      return publishProfile(
        await privateDirectory(home),
        catalog,
        entries,
        family && family !== 'other' ? { controllerType: family } : {},
      );
    },
    watchExitHold: (onHold) => {
      const guardian = spawn(paths.guardianHelper, ['--hold-seconds', '1.5'], {
        shell: false,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      let buffer = '';
      guardian.stdout?.on('data', (chunk: Buffer) => {
        buffer = (buffer + chunk.toString('utf8')).slice(-256);
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        lines.forEach((line) => {
          if (line !== 'exit-hold') return;
          diagnosticEvent({ event: 'exit-hold' });
          onHold();
        });
      });
      guardian.on('error', () => undefined);
      // Closing its input ends the helper; it never outlives the session.
      return { stop: () => guardian.stdin?.end() };
    },
    prepareGameInput: async (library, system) => {
      // Dolphin's managed input; PPSSPP prepares its controls in its runtime.
      if (system !== 'gc') return;
      const controller = primaryController(await detectControllers());
      const family = controller?.family || 'none';
      if (!isInputFamily(family)) {
        diagnosticEvent({ event: 'game-input', family, result: 'unmanaged' });
        return;
      }
      await prepareDolphinLibrary(library);
      const { configuration, user } = dolphin.paths(library);
      const result = await applyManagedInput(
        configuration,
        path.join(path.dirname(user), '.emulation-workspace-input.json'),
        family,
        await readStickResponse(paths.preferencesFile),
      );
      diagnosticEvent({ event: 'game-input', family, result: result.files });
    },
    startBroker: startConsoleBroker,
    restoreFocus: (pid, bundle) =>
      restoreFocus(paths.activateHelper, pid, bundle),
    strayFrontends,
    terminate: (pid) => {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* Already exited. */
      }
    },
    spawn: (command, args, options) => spawn(command, [...args], options),
    delay: (milliseconds) =>
      new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
      }),
    hideManager: manager.hide,
    showManager: manager.show,
  };
}
