import { dialog } from 'electron';
import path from 'path';
import type { ActionResult } from '../../../shared/macos';
import { dolphin } from '../../components/dolphin';
import { ppsspp, ppssppApp } from '../../components/ppsspp';
import { applyManagedControls } from '../../components/ppsspp/input';
import { ppssppPreflight } from '../../components/ppsspp/preflight';
import { ComponentManager } from '../component-manager';
import type { ConsoleEmulator } from '../console-host';
import { diagnosticEvent } from '../diagnostics';
import { prepareDolphinLibrary } from '../dolphin-library';
import { EmulatorRuntime, defaultSpawn } from '../emulator-runtime';
import { acceptsOneOf } from '../security';
import { BUSY } from './context';
import type { AppContext } from './context';

/** Dolphin (the original manager), the pinned-app emulators and their systems. */
export function createEmulators(context: AppContext) {
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
  const ppssppRuntime = new EmulatorRuntime(
    ppsspp,
    ppssppApp,
    path.join(context.userData, 'components', 'ppsspp'),
    {
      spawn: defaultSpawn,
      preflight: ppssppPreflight(),
      // PPSSPP 1.20.4's default L/R bindings are unreachable on game controllers.
      prepareLaunch: async (library) => {
        const { configuration, user } = ppsspp.paths(library);
        const result = await applyManagedControls(
          configuration,
          path.join(user, '.emulation-workspace-input.json'),
        );
        diagnosticEvent({ event: 'ppsspp-input', result: result.files });
      },
      assertLibrary,
    },
    () => context.showWindow(),
  );
  const pinned = { ppsspp: ppssppRuntime } as const;
  const pinnedIDs = Object.keys(pinned) as Array<keyof typeof pinned>;
  /** Installed-emulator systems, shared by Console Mode and the library overview. */
  const systems: ConsoleEmulator[] = [
    {
      system: { id: 'gc', fullname: 'Nintendo GameCube', label: 'Dolphin' },
      adapter: dolphin,
      installed: async () => Boolean((await manager.status()).version),
    },
    {
      system: {
        id: 'psp',
        fullname: 'Sony PlayStation Portable',
        label: 'PPSSPP',
      },
      adapter: ppsspp,
      installed: async () =>
        (await ppssppRuntime.status()).health === 'installed',
    },
  ];
  context.addBusy(() => manager.isBusy || ppssppRuntime.isBusy);
  return {
    manager,
    pinned,
    pinnedIDs,
    systems,
    /** Console Mode runners by system id. */
    runners: { gc: manager, psp: ppssppRuntime },
  };
}

export type Emulators = ReturnType<typeof createEmulators>;

export function registerEmulatorHandlers(
  context: AppContext,
  { manager, pinned, pinnedIDs }: Emulators,
): void {
  context.handle('mac:install-dolphin', async (): Promise<ActionResult> => {
    if (context.busy()) return { ok: false, error: BUSY };
    return context.exclusive(async () => {
      try {
        const library = await context.availableLibrary();
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
      const runtime = pinned[args[0] as keyof typeof pinned];
      if (context.busy()) return { ok: false, error: BUSY };
      try {
        await context.availableLibrary();
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
      const runtime = pinned[args[0] as keyof typeof pinned];
      if (context.busy()) return { ok: false, error: BUSY };
      return context.exclusive(async () => {
        try {
          const library = await context.availableLibrary();
          await runtime.prepareLibrary(library);
          const { manifest } = runtime.adapter;
          const choice = await dialog.showOpenDialog(context.window()!, {
            title: `Choose a ${manifest.systems.join(', ').toUpperCase()} Game`,
            buttonLabel: 'Play',
            defaultPath: runtime.adapter.paths(library).roms,
            properties: ['openFile'],
            filters: [
              {
                name: `${manifest.name} games and homebrew`,
                extensions: manifest.romExtensions.map((extension) =>
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
          await runtime.launch(library, choice.filePaths[0]);
          return { ok: true };
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          return {
            ok: false,
            error: message.startsWith('Your own PPSSPP')
              ? message
              : `The game could not start. Choose a supported file inside this library’s roms/${runtime.adapter.manifest.systems[0]} folder, check the drive is connected, and verify ${runtime.adapter.manifest.name} is installed.`,
          };
        }
      });
    },
    (values) => acceptsOneOf(values, pinnedIDs),
  );
}
