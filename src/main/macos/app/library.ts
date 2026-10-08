import { dialog, shell } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import type {
  ActionResult,
  LibraryCheck,
  LibraryOverview,
  LibraryResult,
} from '../../../shared/macos';
import { checkLibrary, moveToSystem } from '../library-health';
import type { HealthIssue } from '../library-health';
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

  /** The last check's issues, by id: the only targets fix and reveal accept. */
  let lastCheck = new Map<string, { issue: HealthIssue; library: string }>();
  const shortName = (system?: string) =>
    systems.find((entry) => entry.system.id === system)?.adapter.system
      .shortName;

  context.handle('mac:check-library', async (): Promise<LibraryCheck> => {
    let library: string;
    try {
      library = await context.availableLibrary();
    } catch {
      return { available: false, checked: 0, truncated: false, issues: [] };
    }
    const report = await checkLibrary(
      library,
      systems.map((entry) => entry.adapter),
    );
    lastCheck = new Map(
      report.issues.map((issue) => [issue.id, { issue, library }]),
    );
    return {
      available: true,
      checked: report.checked,
      truncated: report.truncated,
      issues: report.issues.map((issue) => ({
        id: issue.id,
        kind: issue.kind,
        path: issue.path,
        other: issue.other,
        targetName: shortName(issue.target),
        movable: Boolean(issue.target),
      })),
    };
  });

  context.handle(
    'mac:fix-library-issue',
    async (args): Promise<ActionResult> => {
      const entry = lastCheck.get(args[0] as string)!;
      const target = systems.find(
        (candidate) => candidate.system.id === entry.issue.target,
      );
      if (!target) return { ok: false, error: 'This can’t be fixed here.' };
      if (context.busy()) return { ok: false, error: BUSY };
      return context.exclusive(async () => {
        try {
          if ((await context.availableLibrary()) !== entry.library)
            throw new Error('Library changed');
          const name = path.posix.basename(entry.issue.path);
          const folder = target.adapter.system.shortName;
          const choice = await dialog.showMessageBox(context.window()!, {
            type: 'question',
            message: `Move “${name}” to the ${folder} folder?`,
            detail: `It is moved, not copied, so it appears with your other ${folder} games. Nothing is replaced if a file with the same name is already there.`,
            buttons: ['Cancel', 'Move'],
            defaultId: 1,
            cancelId: 0,
          });
          if (choice.response !== 1) return { ok: true };
          await moveToSystem(entry.library, entry.issue.path, target.adapter);
          lastCheck.delete(entry.issue.id);
          return { ok: true };
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof Error && error.message.includes('already there')
                ? 'A file with that name is already in that folder, so nothing was moved.'
                : 'The file could not be moved. Check that your library drive is connected. Nothing was changed.',
          };
        }
      });
    },
    (values) => acceptsOneOf(values, [...lastCheck.keys()]),
  );

  context.handle(
    'mac:reveal-library-issue',
    async (args): Promise<ActionResult> => {
      const entry = lastCheck.get(args[0] as string)!;
      try {
        if ((await context.availableLibrary()) !== entry.library)
          throw new Error('Library changed');
        const target = path.join(entry.library, ...entry.issue.path.split('/'));
        await fs.lstat(target);
        shell.showItemInFolder(target);
        return { ok: true };
      } catch {
        return {
          ok: false,
          error:
            'That file is no longer there. Check the library again to refresh the list.',
        };
      }
    },
    (values) => acceptsOneOf(values, [...lastCheck.keys()]),
  );
}
