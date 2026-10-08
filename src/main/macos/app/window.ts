import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  session,
  systemPreferences,
} from 'electron';
import path from 'path';
import type { MacStatus } from '../../../shared/macos';
import { setWindowZoom, stepZoom } from '../chrome';
import type SmokeHarness from '../smoke';
import { symbolCSS } from '../symbols';
import type { AppContext } from './context';

export function createWindow(
  context: AppContext,
  smoke: SmokeHarness | null,
  getStatus: () => Promise<MacStatus>,
): void {
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
  context.setWindow(window);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) =>
    event.preventDefault(),
  );
  window.on('closed', () => {
    if (context.window() === window) context.setWindow(null);
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
      ?.capture(window, context.statePath, getStatus)
      .catch((error: unknown) => {
        smoke.fail(
          error instanceof Error ? error.message : 'Smoke capture failed.',
        );
      });
  });
  window.loadURL(context.rendererURL).catch(() => {
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

function applicationMenu(context: AppContext): Menu {
  const zoom = (step: (window: BrowserWindow) => void) => () => {
    const window = context.window();
    if (window) step(window);
  };
  return Menu.buildFromTemplate([
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
          click: () => context.refreshStatus(),
        },
        { type: 'separator' },
        // Custom items: every zoom path must also re-center the traffic lights.
        {
          id: 'mac-actual-size',
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          click: zoom((window) => setWindowZoom(window, 1)),
        },
        {
          id: 'mac-zoom-in',
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: zoom((window) => stepZoom(window, 1)),
        },
        {
          id: 'mac-zoom-out',
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: zoom((window) => stepZoom(window, -1)),
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
  ]);
}

/**
 * Single instance, a quit guard that protects running games and saves, the
 * menu and the window. `refreshBusy` lets managers notice a game that exited.
 */
export function startApplication(
  context: AppContext,
  options: {
    smoke: SmokeHarness | null;
    getStatus: () => Promise<MacStatus>;
    refreshBusy: () => Promise<unknown>;
  },
): void {
  const open = () => createWindow(context, options.smoke, options.getStatus);
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  let quitting = false;
  let checkingQuit = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    if (checkingQuit) return;
    checkingQuit = true;
    void (async () => {
      try {
        await options.refreshBusy();
        if (context.busy()) {
          const messageOptions: Electron.MessageBoxOptions = {
            type: 'info',
            message: 'Finish your current session first',
            detail:
              'Quit the game, leave Console Mode, or wait for the current operation to finish, then quit Emulation Workspace. This keeps your settings and saves protected.',
            buttons: ['OK'],
          };
          const window = context.window();
          if (window) await dialog.showMessageBox(window, messageOptions);
          else await dialog.showMessageBox(messageOptions);
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
    if (!context.window() && app.isReady()) open();
    const window = context.window();
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });
  app
    .whenReady()
    .then(() => {
      session.defaultSession.setPermissionRequestHandler(denyPermission);
      session.defaultSession.setPermissionCheckHandler(() => false);
      Menu.setApplicationMenu(applicationMenu(context));
      open();
      app.on('activate', () => {
        if (!context.window()) open();
      });
      return undefined;
    })
    .catch(() => app.exit(1));
  app.on('window-all-closed', () => {
    /* macOS keeps the application in the Dock. */
  });
}
