import { dialog, shell } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import type {
  ActionResult,
  LibraryOverview,
  LibraryResult,
} from '../../../shared/macos';
import { listGames } from '../console-host';
import { firmwareStatus } from '../firmware';
import { readLibrary, recoverLibrarySettings, selectLibrary } from '../library';
import { acceptsOneOf } from '../security';
import { BUSY } from './context';
import type { AppContext } from './context';
import type { Emulators } from './emulators';

export function libraryOverview(
  context: AppContext,
  { systems: emulators }: Emulators,
) {
  return async (): Promise<LibraryOverview> => {
    let library: string;
    try {
      library = await context.availableLibrary();
    } catch {
      return { available: false, systems: [], firmware: [] };
    }
    const games = await listGames(library, emulators);
    const systems = await Promise.all(
      emulators.map(async (emulator) => ({
        id: emulator.system.id,
        name: emulator.adapter.system.shortName,
        emulator: emulator.system.label,
        installed: await emulator.installed().catch(() => false),
        games: games.filter((game) => game.system === emulator.system.id)
          .length,
        folder: path.relative(library, emulator.adapter.paths(library).roms),
      })),
    );
    const firmware = (
      await firmwareStatus(
        library,
        emulators.map((emulator) => emulator.adapter),
      ).catch(() => [])
    ).map((item) => ({
      id: item.id,
      system: item.system,
      title: item.title,
      purpose: item.purpose,
      required: item.required,
      state: item.state,
      detail: item.detail,
    }));
    return { available: true, systems, firmware };
  };
}

export function registerLibraryHandlers(
  context: AppContext,
  emulators: Emulators,
  overview: () => Promise<LibraryOverview>,
): void {
  const { manager, systems } = emulators;
  const systemIDs = systems.map((emulator) => emulator.system.id);

  context.handle('mac:library-overview', overview);

  context.handle(
    'mac:reveal-system',
    async (args): Promise<ActionResult> => {
      try {
        const library = await context.availableLibrary();
        const emulator = systems.find(
          (candidate) => candidate.system.id === args[0],
        )!;
        const folder = emulator.adapter.paths(library).roms;
        await fs.mkdir(folder, { recursive: true, mode: 0o755 });
        const stat = await fs.lstat(folder);
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw new Error('Not a real folder');
        const failure = await shell.openPath(folder);
        return failure
          ? { ok: false, error: 'Finder could not open the folder.' }
          : { ok: true };
      } catch {
        return {
          ok: false,
          error:
            'The folder could not be opened. Reconnect your library drive and try again.',
        };
      }
    },
    (values) => acceptsOneOf(values, systemIDs),
  );

  context.handle('mac:choose-library', async (): Promise<LibraryResult> => {
    if (context.busy())
      return {
        ok: false,
        error:
          'Finish the current operation or quit the game before changing your library.',
      };
    return context.exclusive(async (): Promise<LibraryResult> => {
      try {
        await manager.status();
        if (manager.isBusy) throw new Error('A managed game is still running');
        const selection = await dialog.showOpenDialog(context.window()!, {
          title: 'Choose Your Emulation Library',
          buttonLabel: 'Choose Library',
          properties: ['openDirectory', 'createDirectory'],
        });
        if (selection.canceled || selection.filePaths.length !== 1) {
          return { ok: false, cancelled: true, error: 'No folder selected.' };
        }
        await manager.status();
        if (manager.isBusy) throw new Error('A managed game is still running');
        return {
          ok: true,
          library: await selectLibrary(
            context.statePath,
            selection.filePaths[0],
          ),
        };
      } catch {
        return {
          ok: false,
          error:
            'The library could not be saved. Check folder permissions and existing library settings. Your files have been preserved.',
        };
      }
    });
  });

  context.handle('mac:reveal-library', async (): Promise<ActionResult> => {
    try {
      const library = await readLibrary(context.statePath);
      if (!library?.available)
        return {
          ok: false,
          error:
            'The library folder is unavailable. Reconnect its drive and try again.',
        };
      const error = await shell.openPath(library.path);
      return error
        ? { ok: false, error: 'Finder could not open this folder.' }
        : { ok: true };
    } catch {
      return { ok: false, error: 'Library settings could not be read.' };
    }
  });

  context.handle(
    'mac:recover-library-settings',
    async (): Promise<ActionResult> => {
      if (context.busy()) return { ok: false, error: BUSY };
      return context.exclusive(async () => {
        try {
          await manager.status();
          if (manager.isBusy)
            throw new Error('A managed game is still running');
          const choice = await dialog.showMessageBox(context.window()!, {
            type: 'question',
            message: 'Recover your library settings?',
            detail:
              'The unreadable folder preference will be kept in a backup on this Mac. You can then choose your library again. Your game files, emulator settings, and saves stay where they are.',
            buttons: ['Cancel', 'Back Up and Recover'],
            defaultId: 0,
            cancelId: 0,
          });
          if (choice.response !== 1) return { ok: true };
          await manager.status();
          if (manager.isBusy)
            throw new Error('A managed game is still running');
          await recoverLibrarySettings(context.statePath);
          return { ok: true };
        } catch {
          return {
            ok: false,
            error:
              'Library settings could not be recovered. Existing preferences and library data have been preserved.',
          };
        }
      });
    },
  );
}
