import { dialog } from 'electron';
import path from 'path';
import type { ActionResult } from '../../../shared/macos';
import { dolphin } from '../../components/dolphin';
import { managedEmulators } from '../../components/registry';
import type { ManagedEmulator } from '../../components/registry-types';
import { LaunchRefusal } from '../../components/shared/refusal';
import type { ComponentAdapter } from '../../components/types';
import { ComponentManager } from '../component-manager';
import type { ConsoleEmulator } from '../console-host';
import type { GameRunner } from '../console-session';
import { diagnosticEvent } from '../diagnostics';
import { prepareDolphinLibrary } from '../dolphin-library';
import { EmulatorRuntime, defaultSpawn } from '../emulator-runtime';
import { acceptsOneOf } from '../security';
import { BUSY } from './context';
import type { AppContext } from './context';
import type { Saves } from './saves';

/** Dolphin (the original manager), the pinned-app emulators and their systems. */
/** A Console Mode system for an adapter: ES-DE name plus the emulator's name. */
function consoleSystem(adapter: ComponentAdapter) {
  return {
    id: adapter.system.id,
    fullname: adapter.system.fullname,
    label: adapter.manifest.name,
  };
}

/** Dolphin (the original manager) plus every registered pinned-app emulator. */
export function createEmulators(
  context: AppContext,
  registry: readonly ManagedEmulator[] = managedEmulators,
) {
  const assertLibrary = async (root: string) => {
    if ((await context.availableLibrary()) !== root)
      throw new Error('Library changed or its drive is unavailable');
  };
  const manager = new ComponentManager(
    path.join(context.userData, 'components', 'dolphin'),
    // In Console Mode the frontend, not the manager, must regain focus.
    () => context.showWindow(),
    undefined,
    undefined,
    assertLibrary,
  );
  const pinned: Record<string, EmulatorRuntime> = Object.fromEntries(
    registry.map((entry) => {
      const { id } = entry.adapter.manifest;
      const runtime = new EmulatorRuntime(
        entry.adapter,
        entry.app,
        path.join(context.userData, 'components', id),
        {
          spawn: defaultSpawn,
          preflight: entry.preflight || (async () => undefined),
          prepareLaunch:
            entry.prepareLaunch &&
            (async (library) => {
              const result = await entry.prepareLaunch!(library);
              diagnosticEvent({ event: `${id}-input`, result });
            }),
          assertLibrary,
        },
        () => context.showWindow(),
      );
      return [id, runtime];
    }),
  );
  const pinnedIDs = Object.keys(pinned);
  /** Installed-emulator systems, shared by Console Mode and the library overview. */
  const systems: ConsoleEmulator[] = [
    {
      system: consoleSystem(dolphin),
      adapter: dolphin,
      installed: async () => Boolean((await manager.status()).version),
    },
    ...registry.map((entry) => ({
      system: consoleSystem(entry.adapter),
      adapter: entry.adapter,
      installed: async () =>
        (await pinned[entry.adapter.manifest.id].status()).health ===
        'installed',
    })),
  ];
  const runners: Record<string, GameRunner> = {
    [dolphin.system.id]: manager,
    ...Object.fromEntries(
      registry.map((entry) => [
        entry.adapter.system.id,
        pinned[entry.adapter.manifest.id],
      ]),
    ),
  };
  context.addBusy(
    () =>
      manager.isBusy || Object.values(pinned).some((runtime) => runtime.isBusy),
  );
  return {
    manager,
    pinned,
    pinnedIDs,
    systems,
    /** Console Mode runners by system id. */
    runners,
  };
}

export type Emulators = ReturnType<typeof createEmulators>;

export function registerEmulatorHandlers(
  context: AppContext,
  { manager, pinned, pinnedIDs }: Emulators,
  saves: Saves,
): void {
  context.handle('mac:install-dolphin', async (): Promise<ActionResult> => {
    if (context.busy()) return { ok: false, error: BUSY };
    return context.exclusive(async () => {
      try {
        const library = await context.availableLibrary();
        // An update or repair never starts without a verified copy of the saves.
        if ((await manager.status()).version)
          await saves.before(library, 'dolphin', 'before-update');
        await manager.install();
        if ((await context.availableLibrary()) !== library)
          throw new Error('Library changed');
        await prepareDolphinLibrary(library);
        return { ok: true };
      } catch {
        return {
          ok: false,
          error:
            'Dolphin could not be installed or configured. Check your connection and library drive. Installation requires an official ARM64 build accepted by macOS security checks; existing games and saves are preserved.',
        };
      }
    });
  });

  context.handle('mac:play-game', async (): Promise<ActionResult> => {
    if (context.busy()) return { ok: false, error: BUSY };
    return context.exclusive(async () => {
      try {
        const library = await context.availableLibrary();
        const choice = await dialog.showOpenDialog(context.window()!, {
          title: 'Choose a GameCube Game',
          buttonLabel: 'Play',
          defaultPath: dolphin.paths(library).roms,
          properties: ['openFile'],
          filters: [
            {
              name: 'GameCube games and homebrew',
              extensions: dolphin.manifest.romExtensions.map((extension) =>
                extension.slice(1),
              ),
            },
          ],
        });
        if (choice.canceled) return { ok: true };
        if (
          choice.filePaths.length !== 1 ||
          (await context.availableLibrary()) !== library
        )
          throw new Error('Library changed');
        await saves.daily(library, dolphin.system.id);
        await manager.launch(library, choice.filePaths[0]);
        return { ok: true };
      } catch {
        return {
          ok: false,
          error:
            'The game could not start. Choose a supported file inside this library’s roms/gc folder, check the drive is connected, and verify Dolphin is installed.',
        };
      }
    });
  });

  context.handle('mac:reset-dolphin', async (): Promise<ActionResult> => {
    if (context.busy())
      return {
        ok: false,
        error:
          'Quit the game and finish the current operation before resetting settings.',
      };
    return context.exclusive(async () => {
      try {
        const library = await context.availableLibrary();
        const choice = await dialog.showMessageBox(context.window()!, {
          type: 'question',
          message: 'Reset Dolphin settings?',
          detail:
            'Your current settings will be kept in a dated backup folder. Games, memory cards, and save states will stay in place.',
          buttons: ['Cancel', 'Reset Settings'],
          defaultId: 0,
          cancelId: 0,
        });
        if (choice.response !== 1) return { ok: true };
        if ((await context.availableLibrary()) !== library)
          throw new Error('Library changed');
        await saves.before(library, 'dolphin', 'before-reset');
        await manager.reset(library);
        return { ok: true };
      } catch {
        return {
          ok: false,
          error:
            'Settings could not be reset. Any original settings are preserved in the Dolphin User folder or its Config.backup folder. Games and saves have not been removed.',
        };
      }
    });
  });

  context.handle(
    'mac:install-emulator',
    async (args): Promise<ActionResult> => {
      const runtime = pinned[args[0] as string];
      if (context.busy()) return { ok: false, error: BUSY };
      try {
        const library = await context.availableLibrary();
        if ((await runtime.status()).health !== 'missing')
          await saves.before(
            library,
            runtime.adapter.manifest.id,
            'before-update',
          );
        await runtime.install();
        await runtime.prepareLibrary(await context.availableLibrary());
        return { ok: true };
      } catch {
        return {
          ok: false,
          error: `${runtime.adapter.manifest.name} could not be installed. Check your connection and library drive. Only the reviewed official release, verified by its publisher signature and macOS, is installed; games and saves are preserved.`,
        };
      }
    },
    (values) => acceptsOneOf(values, pinnedIDs),
  );

  context.handle(
    'mac:play-emulator',
    async (args): Promise<ActionResult> => {
      const runtime = pinned[args[0] as string];
      if (context.busy()) return { ok: false, error: BUSY };
      return context.exclusive(async () => {
        try {
          const library = await context.availableLibrary();
          await runtime.prepareLibrary(library);
          const { manifest } = runtime.adapter;
          const choice = await dialog.showOpenDialog(context.window()!, {
            title: `Choose a ${runtime.adapter.system.shortName} Game`,
            buttonLabel: 'Play',
            defaultPath: runtime.adapter.paths(library).roms,
            // Folder games (PS4 and similar) are chosen as their folder.
            properties: manifest.folderGame
              ? ['openFile', 'openDirectory']
              : ['openFile'],
            // Folder-only systems have no file types to filter by.
            filters: manifest.romExtensions.length
              ? [
                  {
                    name: `${manifest.name} games and homebrew`,
                    extensions: manifest.romExtensions.map((extension) =>
                      extension.slice(1),
                    ),
                  },
                ]
              : [],
          });
          if (choice.canceled) return { ok: true };
          if (
            choice.filePaths.length !== 1 ||
            (await context.availableLibrary()) !== library
          )
            throw new Error('Library changed');
          await saves.daily(library, runtime.adapter.system.id);
          await runtime.launch(library, choice.filePaths[0]);
          return { ok: true };
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof LaunchRefusal
                ? error.message
                : `The game could not start. Choose a supported file inside this library’s roms/${runtime.adapter.manifest.systems[0]} folder, check the drive is connected, and verify ${runtime.adapter.manifest.name} is installed.`,
          };
        }
      });
    },
    (values) => acceptsOneOf(values, pinnedIDs),
  );
}
