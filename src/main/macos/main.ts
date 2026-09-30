import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
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

async function captureSmoke(window: BrowserWindow): Promise<void> {
  if (!smokeDirectory) return;
  const started = Date.now();
  const deadline = started + 15000;
  let ready = false;
  while (!ready && Date.now() < deadline && !window.isDestroyed()) {
    ready = await window.webContents.executeJavaScript(
      'Boolean(document.querySelector("#root")?.textContent?.trim() && window.mac && !window.electron && !window.require)',
    );
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await fs.mkdir(smokeDirectory, { recursive: true });
  const screenshot = await window.webContents.capturePage();
  await fs.writeFile(
    path.join(smokeDirectory, 'window.png'),
    Uint8Array.from(screenshot.toPNG()),
  );
  await fs.writeFile(
    path.join(smokeDirectory, 'report.json'),
    JSON.stringify(
      {
        ready,
        packaged: app.isPackaged,
        architecture: process.arch,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
        status: await getStatus(),
      },
      null,
      2,
    ),
  );
  app.exit(ready ? 0 : 1);
}

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
  window.webContents.once('did-finish-load', () => {
    captureSmoke(window).catch(async () => {
      if (smokeDirectory) {
        await fs.mkdir(smokeDirectory, { recursive: true });
        await fs.writeFile(
          path.join(smokeDirectory, 'report.json'),
          JSON.stringify({ ready: false, error: 'Smoke capture failed.' }),
        );
        app.exit(1);
      }
    });
  });
  window.loadURL(rendererURL).catch(() => {
    if (smokeDirectory) app.exit(1);
  });
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
      session.defaultSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
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
    })
    .catch(() => app.exit(1));
  app.on('window-all-closed', () => {
    /* macOS keeps the application in the Dock. */
  });
}
