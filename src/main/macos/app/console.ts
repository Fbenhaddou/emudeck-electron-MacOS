import { app, dialog } from 'electron';
import path from 'path';
import type { ActionResult } from '../../../shared/macos';
import { installFrontend } from '../../components/es-de/install';
import { consoleDependencies, privateDirectory } from '../console-host';
import { ConsoleSession } from '../console-session';
import { diagnosticEvent } from '../diagnostics';
import { activateUntilHeld, restoreFocus } from '../focus';
import { BUSY } from './context';
import type { AppContext } from './context';
import type { Emulators } from './emulators';
import type { Saves } from './saves';

/** Console Mode: the ES-DE session, its installation and its handlers. */
export function createConsole(
  context: AppContext,
  emulators: Emulators,
  saves: Saves,
) {
  const consoleRoot = path.join(context.userData, 'console');
  const frontendRoot = path.join(context.userData, 'components', 'es-de');
  let installing = false;
  const dependencies = consoleDependencies(
    {
      frontendRoot,
      profileHome: path.join(consoleRoot, 'esde-home'),
      secretPath: path.join(consoleRoot, 'game-id.key'),
      launcherHelper: path.join(context.helpers, 'console-launcher'),
      activateHelper: path.join(context.helpers, 'activate-app'),
      guardianHelper: path.join(context.helpers, 'console-guardian'),
      preferencesFile: path.join(context.userData, 'controllers.json'),
    },
    {
      // Hidden, not closed: the manager stays ready but never competes for focus.
      hide: () => app.hide(),
      show: () => {
        app.show();
        context.window()?.show();
        context.window()?.focus();
        // app.focus() is ignored under cooperative activation once the frontend
        // quits; activate this exact app through the verified helper instead.
        void activateUntilHeld(
          () =>
            restoreFocus(
              path.join(context.helpers, 'activate-app'),
              process.pid,
              path.resolve(process.execPath, '..', '..', '..'),
            ),
          (milliseconds) =>
            new Promise((resolve) => {
              setTimeout(resolve, milliseconds);
            }),
        ).then((outcome) =>
          diagnosticEvent({ event: 'manager-focus', outcome }),
        );
      },
    },
    emulators.systems,
  );
  const { prepareGameInput } = dependencies;
  // A daily save snapshot (best effort) before every Console Mode game.
  dependencies.prepareGameInput = async (library, system) => {
    await saves.daily(library, system);
    await prepareGameInput(library, system);
  };
  const session: ConsoleSession = new ConsoleSession(
    path.join(consoleRoot, 'esde-home'),
    emulators.runners,
    dependencies,
    () => {
      // Structured, path-free diagnostics: states and outcomes only.
      // eslint-disable-next-line no-use-before-define -- Runs after construction.
      const report = session?.report;
      diagnosticEvent({
        event: 'console-mode',
        // eslint-disable-next-line no-use-before-define -- Runs after construction.
        state: session?.state,
        startFocus: report?.startFocus ?? null,
        gameFocus: report?.focus ?? [],
        exit: report?.frontendExit ?? null,
        exitRequests: report?.exitRequests ?? 0,
        forcedStops: report?.forcedStops ?? 0,
        error: report?.error ?? null,
      });
      context.refreshStatus();
    },
  );
  context.setConsoleActive(() => session.isActive);
  context.addBusy(() => session.isActive || installing);
  return {
    session,
    frontendRoot,
    installing: () => installing,
    setInstalling: (value: boolean) => {
      installing = value;
    },
  };
}

export type ConsoleMode = ReturnType<typeof createConsole>;

export function registerConsoleHandlers(
  context: AppContext,
  consoleMode: ConsoleMode,
  emulators: Emulators,
): void {
  const { session } = consoleMode;
  context.handle('mac:install-console', async (): Promise<ActionResult> => {
    if (context.busy()) return { ok: false, error: BUSY };
    consoleMode.setInstalling(true);
    try {
      await installFrontend(await privateDirectory(consoleMode.frontendRoot), {
        // The image's own license text, in a native sheet. Never answered for the user.
        acceptLicense: async (text) => {
          const window = context.window();
          if (!window) return false;
          const choice = await dialog.showMessageBox(window, {
            type: 'info',
            message: 'ES-DE License Agreement',
            detail: `To install ES-DE for Console Mode, you must agree to its license.\n\n${text}`,
            buttons: ['Agree', 'Disagree'],
            defaultId: 0,
            cancelId: 1,
          });
          return choice.response === 0;
        },
      });
      return { ok: true };
    } catch (error) {
      const declined =
        error instanceof Error && error.message.includes('declined');
      return {
        ok: false,
        error: declined
          ? 'ES-DE was not installed because its license was not accepted.'
          : 'ES-DE could not be installed. Check your connection and try again. Only the reviewed official release, verified by its publisher signature and macOS, is installed.',
      };
    } finally {
      consoleMode.setInstalling(false);
    }
  });

  context.handle('mac:enter-console', async (): Promise<ActionResult> => {
    if (context.busy()) return { ok: false, error: BUSY };
    try {
      const library = await context.availableLibrary();
      if (!(await emulators.manager.status()).version)
        return {
          ok: false,
          error: 'Install Dolphin before opening Console Mode.',
        };
      await session.enter(library);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      return {
        ok: false,
        // The session's report carries the plain-language reason for the page.
        error:
          session.report?.error ||
          (message.startsWith('Install ES-DE')
            ? 'Install ES-DE before opening Console Mode.'
            : 'Console Mode could not start. Check that your library drive is connected. Your games and saves are unchanged.'),
      };
    }
  });
}
