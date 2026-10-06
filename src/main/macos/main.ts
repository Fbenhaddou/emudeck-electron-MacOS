import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  screen,
  session,
  shell,
  systemPreferences,
} from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import type {
  ActionResult,
  LibraryResult,
  MacStatus,
} from '../../shared/macos';
import { setWindowZoom, stepZoom } from './chrome';
import { consoleDependencies, privateDirectory } from './console-host';
import { ConsoleSession } from './console-session';
import { activateUntilHeld, restoreFocus } from './focus';
import {
  ESDE_RELEASE,
  frontendHealth,
  installFrontend,
} from '../components/es-de/install';
import { ComponentManager } from './component-manager';
import { symbolCSS } from './symbols';
import { prepareDolphinLibrary } from './dolphin-library';
import { dolphin } from '../components/dolphin';
import { readLibrary, selectLibrary, recoverLibrarySettings } from './library';
import { acceptsEmptyArguments, isTrustedDocument } from './security';
import SmokeHarness from './smoke';

app.setName('Emulation Workspace');
// Attribution lives in the About panel, as in other Mac apps, not in window chrome.
app.setAboutPanelOptions({
  applicationName: 'Emulation Workspace',
  credits:
    'Development Preview. Built on EmuDeck. An independent project; not an official EmuDeck or RetroDECK product.',
});
app.setPath(
  'userData',
  path.join(app.getPath('appData'), 'Emulation Workspace'),
);
const smokeDirectory = process.env.EMULATION_SMOKE_DIR;
if (smokeDirectory) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const candidate = path.resolve(smokeDirectory);
  if (
    !path.isAbsolute(smokeDirectory) ||
    !candidate.startsWith(`${temporaryRoot}${path.sep}`)
  ) {
    throw new Error(
      'EMULATION_SMOKE_DIR must be an absolute directory inside the system temporary directory.',
    );
  }
  app.setPath('userData', path.join(candidate, 'user-data'));
}

// Interactive native review keeps the same isolated test data and real bridge,
// but lets the reviewer control the window instead of running synthetic captures.
const smoke =
  smokeDirectory && process.env.EMULATION_SMOKE_INTERACTIVE !== '1'
    ? new SmokeHarness(smokeDirectory)
    : null;
const statePath = path.join(app.getPath('userData'), 'library.json');
const rendererURL =
  process.env.NODE_ENV === 'development'
    ? `http://localhost:${process.env.PORT || 1212}/index.html`
    : pathToFileURL(path.join(__dirname, '../renderer/index.html')).href;
let mainWindow: BrowserWindow | null = null;
let choosingLibrary = false;
async function availableLibrary(): Promise<string> {
  const library = await readLibrary(statePath);
  if (!library?.available) throw new Error('Library unavailable');
  return library.path;
}
// Assigned below; the manager's exit callback must know about Console Mode.
// eslint-disable-next-line prefer-const
let consoleSession: ConsoleSession;
const manager = new ComponentManager(
  path.join(app.getPath('userData'), 'components', 'dolphin'),
  () => {
    // In Console Mode the frontend, not the manager, must regain focus.
    if (consoleSession?.isActive) return;
    mainWindow?.show();
    mainWindow?.focus();
  },
  undefined,
  undefined,
  async (root) => {
    if ((await availableLibrary()) !== root)
      throw new Error('Library changed or its drive is unavailable');
  },
);

const consoleRoot = path.join(app.getPath('userData'), 'console');
const frontendRoot = path.join(app.getPath('userData'), 'components', 'es-de');
// Packaged helpers ship in Resources/helpers; development uses the native build.
const helpers = app.isPackaged
  ? path.join(process.resourcesPath, 'helpers')
  : path.resolve(app.getAppPath(), '..', 'native');
let installingConsole = false;
consoleSession = new ConsoleSession(
  path.join(consoleRoot, 'esde-home'),
  manager,
  consoleDependencies(
    {
      frontendRoot,
      profileHome: path.join(consoleRoot, 'esde-home'),
      secretPath: path.join(consoleRoot, 'game-id.key'),
      launcherHelper: path.join(helpers, 'console-launcher'),
      activateHelper: path.join(helpers, 'activate-app'),
    },
    {
      // Hidden, not closed: the manager stays ready but never competes for focus.
      hide: () => app.hide(),
      show: () => {
        app.show();
        mainWindow?.show();
        mainWindow?.focus();
        // app.focus() is ignored under cooperative activation once the frontend
        // quits; activate this exact app through the verified helper instead.
        void activateUntilHeld(
          () =>
            restoreFocus(
              path.join(helpers, 'activate-app'),
              process.pid,
              path.resolve(process.execPath, '..', '..', '..'),
            ),
          (milliseconds) =>
            new Promise((resolve) => {
              setTimeout(resolve, milliseconds);
            }),
        ).then((outcome) =>
          process.stderr.write(
            `${JSON.stringify({ event: 'manager-focus', outcome })}\n`,
          ),
        );
      },
    },
  ),
  // eslint-disable-next-line no-use-before-define -- Hoisted; runs after startup.
  () => {
    // Structured, path-free diagnostics: states and outcomes only.
    const report = consoleSession?.report;
    process.stderr.write(
      `${JSON.stringify({
        event: 'console-mode',
        state: consoleSession?.state,
        startFocus: report?.startFocus ?? null,
        gameFocus: report?.focus ?? [],
        exit: report?.frontendExit ?? null,
        error: report?.error ?? null,
      })}\n`,
    );
    // eslint-disable-next-line no-use-before-define -- Hoisted; runs after startup.
    refreshStatusFromMenu();
  },
);
function operationBusy(): boolean {
  return (
    choosingLibrary ||
    manager.isBusy ||
    consoleSession.isActive ||
    installingConsole
  );
}

function validateCaller(event: IpcMainInvokeEvent, args: unknown[]): void {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    !isTrustedDocument(event.senderFrame.url, rendererURL) ||
    !acceptsEmptyArguments(args)
  ) {
    throw new Error('This request is not permitted.');
  }
}

async function getStatus(): Promise<MacStatus> {
  let library = null;
  let libraryError = null;
  try {
    library = await readLibrary(statePath);
  } catch {
    libraryError =
      'Library settings could not be read. Existing files have been preserved.';
  }
  let frontendState: 'missing' | 'installed' | 'damaged' = 'missing';
  try {
    // Status is read-only: never create folders; absent means not installed.
    frontendState = await frontendHealth(await fs.realpath(frontendRoot));
  } catch {
    frontendState = 'missing';
  }
  const { report } = consoleSession;
  return {
    dolphin: await manager.status(),
    console: {
      frontend: frontendState === 'missing' ? null : ESDE_RELEASE.version,
      frontendState,
      state: installingConsole ? 'installing' : consoleSession.state,
      lastError: report?.error || null,
      games: report ? report.games : null,
    },
    appVersion: app.getVersion(),
    platform: 'darwin',
    architecture: process.arch,
    osVersion: process.getSystemVersion(),
    memoryBytes: os.totalmem(),
    displays: screen.getAllDisplays().map((display) => ({
      width: display.size.width,
      height: display.size.height,
      scaleFactor: display.scaleFactor,
      refreshRate:
        display.displayFrequency > 0 ? display.displayFrequency : null,
      hdr: 'unknown',
    })),
    library,
    libraryError,
    capabilities: {
      controllers: 'untested',
      installation: 'planned',
      consoleMode: 'preview',
    },
  };
}

ipcMain.handle(
  'mac:install-dolphin',
  async (event, ...args): Promise<ActionResult> => {
    validateCaller(event, args);
    if (operationBusy())
      return {
        ok: false,
        error: 'Finish the current operation or quit the game first.',
      };
    choosingLibrary = true;
    try {
      const library = await availableLibrary();
      await manager.install();
      if ((await availableLibrary()) !== library)
        throw new Error('Library changed');
      await prepareDolphinLibrary(library);
      return { ok: true };
    } catch {
      return {
        ok: false,
        error:
          'Dolphin could not be installed or configured. Check your connection and library drive. Installation requires an official ARM64 build accepted by macOS security checks; existing games and saves are preserved.',
      };
    } finally {
      choosingLibrary = false;
    }
  },
);
ipcMain.handle(
  'mac:play-game',
  async (event, ...args): Promise<ActionResult> => {
    validateCaller(event, args);
    if (operationBusy())
      return {
        ok: false,
        error: 'Finish the current operation or quit the game first.',
      };
    choosingLibrary = true;
    try {
      const library = await availableLibrary();
      const choice = await dialog.showOpenDialog(mainWindow!, {
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
        (await availableLibrary()) !== library
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
    } finally {
      choosingLibrary = false;
    }
  },
);
ipcMain.handle(
  'mac:reset-dolphin',
  async (event, ...args): Promise<ActionResult> => {
    validateCaller(event, args);
    if (operationBusy())
      return {
        ok: false,
        error:
          'Quit the game and finish the current operation before resetting settings.',
      };
    choosingLibrary = true;
    try {
      const library = await availableLibrary();
      const choice = await dialog.showMessageBox(mainWindow!, {
        type: 'question',
        message: 'Reset Dolphin settings?',
        detail:
          'Your current settings will be kept in a dated backup folder. Games, memory cards, and save states will stay in place.',
        buttons: ['Cancel', 'Reset Settings'],
        defaultId: 0,
        cancelId: 0,
      });
      if (choice.response !== 1) return { ok: true };
      if ((await availableLibrary()) !== library)
        throw new Error('Library changed');
      await manager.reset(library);
      return { ok: true };
    } catch {
      return {
        ok: false,
        error:
          'Settings could not be reset. Any original settings are preserved in the Dolphin User folder or its Config.backup folder. Games and saves have not been removed.',
      };
    } finally {
      choosingLibrary = false;
    }
  },
);

ipcMain.handle(
  'mac:install-console',
  async (event, ...args): Promise<ActionResult> => {
    validateCaller(event, args);
    if (operationBusy())
      return {
        ok: false,
        error: 'Finish the current operation or quit the game first.',
      };
    installingConsole = true;
    try {
      await installFrontend(await privateDirectory(frontendRoot), {
        // The image's own license text, in a native sheet. Never answered for the user.
        acceptLicense: async (text) => {
          if (!mainWindow) return false;
          const choice = await dialog.showMessageBox(mainWindow, {
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
      installingConsole = false;
    }
  },
);
ipcMain.handle(
  'mac:enter-console',
  async (event, ...args): Promise<ActionResult> => {
    validateCaller(event, args);
    if (operationBusy())
      return {
        ok: false,
        error: 'Finish the current operation or quit the game first.',
      };
    try {
      const library = await availableLibrary();
      if (!(await manager.status()).version)
        return {
          ok: false,
          error: 'Install Dolphin before opening Console Mode.',
        };
      await consoleSession.enter(library);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      return {
        ok: false,
        // The session's report carries the plain-language reason for the page.
        error:
          consoleSession.report?.error ||
          (message.startsWith('Install ES-DE')
            ? 'Install ES-DE before opening Console Mode.'
            : 'Console Mode could not start. Check that your library drive is connected. Your games and saves are unchanged.'),
      };
    }
  },
);
ipcMain.handle('mac:status', async (event, ...args) => {
  validateCaller(event, args);
  return getStatus();
});
ipcMain.handle(
  'mac:choose-library',
  async (event, ...args): Promise<LibraryResult> => {
    validateCaller(event, args);
    if (operationBusy())
      return {
        ok: false,
        error:
          'Finish the current operation or quit the game before changing your library.',
      };
    choosingLibrary = true;
    try {
      await manager.status();
      if (manager.isBusy) throw new Error('A managed game is still running');
      const selection = await dialog.showOpenDialog(mainWindow!, {
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
        library: await selectLibrary(statePath, selection.filePaths[0]),
      };
    } catch {
      return {
        ok: false,
        error:
          'The library could not be saved. Check folder permissions and existing library settings. Your files have been preserved.',
      };
    } finally {
      choosingLibrary = false;
    }
  },
);
ipcMain.handle(
  'mac:reveal-library',
  async (event, ...args): Promise<ActionResult> => {
    validateCaller(event, args);
    try {
      const library = await readLibrary(statePath);
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
  },
);

ipcMain.handle(
  'mac:recover-library-settings',
  async (event, ...args): Promise<ActionResult> => {
    validateCaller(event, args);
    if (operationBusy())
      return {
        ok: false,
        error: 'Finish the current operation or quit the game first.',
      };
    choosingLibrary = true;
    try {
      await manager.status();
      if (manager.isBusy) throw new Error('A managed game is still running');
      const choice = await dialog.showMessageBox(mainWindow!, {
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
      if (manager.isBusy) throw new Error('A managed game is still running');
      await recoverLibrarySettings(statePath);
      return { ok: true };
    } catch {
      return {
        ok: false,
        error:
          'Library settings could not be recovered. Existing preferences and library data have been preserved.',
      };
    } finally {
      choosingLibrary = false;
    }
  },
);

function createWindow(): void {
  const window = new BrowserWindow({
    title: 'Emulation Workspace',
    width: 1120,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    show: false,
    titleBarStyle: 'hidden',
    // Center the traffic lights in the 52pt unified toolbar.
    trafficLightPosition: { x: 20, y: 19 },
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  mainWindow = window;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) =>
    event.preventDefault(),
  );
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.once('ready-to-show', () => window.show());
  // Pinch magnification would scale content without the toolbar's native chrome.
  window.webContents.once('did-finish-load', () => {
    void window.webContents
      .setVisualZoomLevelLimits(1, 1)
      .catch(() => undefined);
  });
  window.webContents.on('zoom-changed', (_event, direction) => {
    stepZoom(window, direction === 'in' ? 1 : -1);
  });
  let accentKey: string | undefined;
  let symbolKey: string | undefined;
  let accentChain = Promise.resolve();
  const applyAccentNow = async () => {
    if (window.isDestroyed()) return;
    // getAccentColor returns RRGGBBAA; only a validated hex reaches insertCSS.
    const color = systemPreferences.getAccentColor().slice(0, 6);
    if (!/^[0-9a-f]{6}$/i.test(color)) return;
    const previous = accentKey;
    accentKey = await window.webContents.insertCSS(
      `:root { --accent: #${color}; }`,
    );
    if (previous) await window.webContents.removeInsertedCSS(previous);
  };
  // Serialized so overlapping notifications cannot orphan an inserted rule.
  const applyAccent = () => {
    accentChain = accentChain.then(applyAccentNow, applyAccentNow);
    return accentChain;
  };
  const applySymbols = async () => {
    if (window.isDestroyed()) return;
    const previous = symbolKey;
    symbolKey = await window.webContents.insertCSS(symbolCSS());
    if (previous) await window.webContents.removeInsertedCSS(previous);
  };
  window.webContents.on('did-finish-load', () => {
    void applyAccent().catch(() => undefined);
    // Real SF Symbols, rendered by AppKit, replace the fallback vector glyphs.
    void applySymbols().catch(() => undefined);
    // A restored zoom level must also move the traffic lights.
    setWindowZoom(window, window.webContents.getZoomFactor());
  });
  const accentSubscription = systemPreferences.subscribeNotification(
    'AppleColorPreferencesChangedNotification',
    () => {
      void applyAccent().catch(() => undefined);
    },
  );
  window.once('closed', () =>
    systemPreferences.unsubscribeNotification(accentSubscription),
  );
  smoke?.observe(window);
  window.webContents.once('did-finish-load', () => {
    void smoke
      ?.capture(window, statePath, getStatus)
      .catch((error: unknown) => {
        smoke.fail(
          error instanceof Error ? error.message : 'Smoke capture failed.',
        );
      });
  });
  window.loadURL(rendererURL).catch(() => {
    smoke?.fail('Renderer document failed to load.');
  });
}

function denyPermission(
  _contents: Electron.WebContents,
  _permission: string,
  callback: (allowed: boolean) => void,
): void {
  callback(false);
}

function refreshStatusFromMenu(): void {
  const contents = mainWindow?.webContents;
  if (
    !contents ||
    contents.isDestroyed() ||
    !isTrustedDocument(contents.mainFrame.url, rendererURL)
  )
    return;
  contents.send('mac:refresh-status');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let quitting = false;
  let checkingQuit = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    if (checkingQuit) return;
    checkingQuit = true;
    void (async () => {
      try {
        await manager.status();
        if (operationBusy()) {
          const options: Electron.MessageBoxOptions = {
            type: 'info',
            message: 'Finish your current session first',
            detail:
              'Quit the game, leave Console Mode, or wait for the current operation to finish, then quit Emulation Workspace. This keeps your settings and saves protected.',
            buttons: ['OK'],
          };
          if (mainWindow) await dialog.showMessageBox(mainWindow, options);
          else await dialog.showMessageBox(options);
          return;
        }
        quitting = true;
        app.quit();
      } finally {
        checkingQuit = false;
      }
    })().catch(() => {
      dialog.showErrorBox(
        'Could not check your session',
        'Running applications could not be checked. Quit Dolphin, then try quitting Emulation Workspace again.',
      );
    });
  });
  app.on('second-instance', () => {
    if (!mainWindow && app.isReady()) createWindow();
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  });
  app
    .whenReady()
    .then(() => {
      session.defaultSession.setPermissionRequestHandler(denyPermission);
      session.defaultSession.setPermissionCheckHandler(() => false);
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
          {
            label: 'File',
            submenu: [{ role: 'close', accelerator: 'CmdOrCtrl+W' }],
          },
          { role: 'editMenu' },
          {
            label: 'View',
            submenu: [
              {
                id: 'mac-refresh-status',
                label: 'Refresh Status',
                accelerator: 'CmdOrCtrl+R',
                click: refreshStatusFromMenu,
              },
              { type: 'separator' },
              // Custom items: every zoom path must also re-center the traffic lights.
              {
                id: 'mac-actual-size',
                label: 'Actual Size',
                accelerator: 'CmdOrCtrl+0',
                click: () => {
                  if (mainWindow) setWindowZoom(mainWindow, 1);
                },
              },
              {
                id: 'mac-zoom-in',
                label: 'Zoom In',
                accelerator: 'CmdOrCtrl+Plus',
                click: () => {
                  if (mainWindow) stepZoom(mainWindow, 1);
                },
              },
              {
                id: 'mac-zoom-out',
                label: 'Zoom Out',
                accelerator: 'CmdOrCtrl+-',
                click: () => {
                  if (mainWindow) stepZoom(mainWindow, -1);
                },
              },
              { type: 'separator' },
              { role: 'togglefullscreen' },
              ...(process.env.NODE_ENV === 'development'
                ? ([
                    { type: 'separator' },
                    { role: 'toggleDevTools' },
                  ] as Electron.MenuItemConstructorOptions[])
                : []),
            ],
          },
          { role: 'windowMenu' },
        ]),
      );
      createWindow();
      app.on('activate', () => {
        if (!mainWindow) createWindow();
      });
      return undefined;
    })
    .catch(() => app.exit(1));
  app.on('window-all-closed', () => {
    /* macOS keeps the application in the Dock. */
  });
}
