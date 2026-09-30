import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  session,
  shell,
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
import { readLibrary, selectLibrary } from './library';
import { acceptsEmptyArguments, isTrustedDocument } from './security';

app.setName('Emulation Workspace');
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

const statePath = path.join(app.getPath('userData'), 'library.json');
const rendererURL =
  process.env.NODE_ENV === 'development'
    ? `http://localhost:${process.env.PORT || 1212}/index.html`
    : pathToFileURL(path.join(__dirname, '../renderer/index.html')).href;
let mainWindow: BrowserWindow | null = null;
let choosingLibrary = false;

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
  return {
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
      consoleMode: 'planned',
    },
  };
}

ipcMain.handle('mac:status', async (event, ...args) => {
  validateCaller(event, args);
  return getStatus();
});
ipcMain.handle(
  'mac:choose-library',
  async (event, ...args): Promise<LibraryResult> => {
    validateCaller(event, args);
    if (choosingLibrary)
      return { ok: false, error: 'A folder chooser is already open.' };
    choosingLibrary = true;
    try {
      const selection = await dialog.showOpenDialog(mainWindow!, {
        title: 'Choose Your Emulation Library',
        buttonLabel: 'Choose Library',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (selection.canceled || selection.filePaths.length !== 1) {
        return { ok: false, cancelled: true, error: 'No folder selected.' };
      }
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

const smokeErrors: string[] = [];
let smokeFinished = false;
let smokeWatchdog: ReturnType<typeof setTimeout> | undefined;

async function finishSmoke(
  report: Record<string, unknown>,
  success: boolean,
): Promise<void> {
  if (!smokeDirectory || smokeFinished) return;
  smokeFinished = true;
  if (smokeWatchdog) clearTimeout(smokeWatchdog);
  try {
    await fs.mkdir(smokeDirectory, { recursive: true });
    await fs.writeFile(
      path.join(smokeDirectory, 'report.json'),
      JSON.stringify(
        {
          ...report,
          ready: success,
          errors: smokeErrors.map((message) =>
            message.split(os.homedir()).join('<home>'),
          ),
          packaged: app.isPackaged,
          architecture: process.arch,
        },
        null,
        2,
      ),
    );
  } finally {
    app.exit(success ? 0 : 1);
  }
}

// Polling readiness and changing one window's appearance must run sequentially.
/* eslint-disable no-await-in-loop, no-restricted-syntax */
async function captureSmoke(window: BrowserWindow): Promise<void> {
  if (!smokeDirectory) return;
  const deadline = Date.now() + 15000;
  let ready = false;
  while (!ready && Date.now() < deadline && !window.isDestroyed()) {
    ready = await window.webContents.executeJavaScript(
      `Boolean(document.querySelector('[data-ready="true"]') && document.querySelector("#root")?.textContent?.trim() && window.mac && !window.electron && !window.require)`,
    );
    if (!ready)
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
  }
  if (!ready) throw new Error('Renderer did not reach data-ready=true.');
  // This crosses the actual isolated preload and validated main-process IPC boundary.
  const status: MacStatus = await window.webContents.executeJavaScript(
    'window.mac.getStatus()',
  );
  if (
    status.platform !== 'darwin' ||
    !status.appVersion ||
    !(status.memoryBytes > 0) ||
    status.libraryError
  ) {
    throw new Error(
      'Preload status IPC returned an invalid or unsuccessful status.',
    );
  }
  // Electron exposes this runtime inspection method but omits it from public typings.
  const inspected = window.webContents as unknown as {
    getLastWebPreferences(): Record<string, unknown>;
  };
  const preferences = inspected.getLastWebPreferences();
  const safe =
    preferences.sandbox === true &&
    preferences.contextIsolation === true &&
    preferences.nodeIntegration === false &&
    preferences.webSecurity === true;
  if (!safe)
    throw new Error(
      'Actual web preferences do not satisfy the security boundary.',
    );
  await fs.mkdir(smokeDirectory, { recursive: true });
  const screenshots: string[] = [];
  const variants: Array<{
    name: string;
    theme: 'light' | 'dark';
    width: number;
    height: number;
  }> = [
    { name: 'light', theme: 'light', width: 1120, height: 760 },
    { name: 'dark', theme: 'dark', width: 1120, height: 760 },
    { name: 'small', theme: 'light', width: 760, height: 560 },
  ];
  for (const variant of variants) {
    nativeTheme.themeSource = variant.theme;
    window.setSize(variant.width, variant.height);
    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
    await window.webContents.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const screenshot = await window.webContents.capturePage();
    if (screenshot.isEmpty()) throw new Error('Screenshot was empty.');
    const filename = `window-${variant.name}.png`;
    await fs.writeFile(
      path.join(smokeDirectory, filename),
      Uint8Array.from(screenshot.toPNG()),
    );
    screenshots.push(filename);
  }
  await finishSmoke(
    { status, webPreferences: preferences, screenshots },
    smokeErrors.length === 0,
  );
}
/* eslint-enable no-await-in-loop, no-restricted-syntax */

function createWindow(): void {
  const window = new BrowserWindow({
    title: 'Emulation Workspace',
    width: 1120,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f5f5f7',
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
  if (smokeDirectory) {
    smokeWatchdog = setTimeout(() => {
      smokeErrors.push('Application smoke watchdog expired.');
      void finishSmoke({}, false);
    }, 30000);
    window.webContents.on('console-message', (details) => {
      if (details.level === 'error')
        smokeErrors.push(`Renderer: ${details.message}`);
    });
    window.webContents.on('preload-error', (_event, _preload, error) => {
      smokeErrors.push(`Preload: ${error.message}`);
      void finishSmoke({}, false);
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      smokeErrors.push(`Renderer exited: ${details.reason}`);
      void finishSmoke({}, false);
    });
    window.webContents.on('dom-ready', () => {
      void window.webContents
        .executeJavaScript(
          `
        window.addEventListener('error', event => console.error('Smoke page error:', event.message));
        window.addEventListener('unhandledrejection', event => console.error('Smoke unhandled rejection:', String(event.reason)));
      `,
        )
        .catch(() => {
          smokeErrors.push('Could not attach page error observers.');
        });
    });
  }
  window.webContents.once('did-finish-load', () => {
    captureSmoke(window).catch((error: unknown) => {
      smokeErrors.push(
        error instanceof Error ? error.message : 'Smoke capture failed.',
      );
      void finishSmoke({}, false);
    });
  });
  window.loadURL(rendererURL).catch(() => {
    if (smokeDirectory) {
      smokeErrors.push('Renderer document failed to load.');
      void finishSmoke({}, false);
    }
  });
}

function denyPermission(
  _contents: Electron.WebContents,
  _permission: string,
  callback: (allowed: boolean) => void,
): void {
  callback(false);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
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
          { role: 'editMenu' },
          { role: 'viewMenu' },
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
