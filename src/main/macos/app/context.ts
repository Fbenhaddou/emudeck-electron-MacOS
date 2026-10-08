import { ipcMain } from 'electron';
import path from 'path';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { readLibrary } from '../library';
import { acceptsEmptyArguments, isTrustedDocument } from '../security';

export const BUSY = 'Finish the current operation or quit the game first.';

/** What every domain module shares: the window, the library and the busy guard. */
export interface AppContext {
  readonly userData: string;
  readonly statePath: string;
  readonly rendererURL: string;
  /** Packaged helpers ship in Resources/helpers; development uses the native build. */
  readonly helpers: string;
  window(): BrowserWindow | null;
  setWindow(window: BrowserWindow | null): void;
  availableLibrary(): Promise<string>;
  /** True while any emulator, Console Mode or exclusive operation is active. */
  busy(): boolean;
  /** Adds a source of busy state (an emulator runtime, Console Mode). */
  addBusy(source: () => boolean): void;
  /** Holds the exclusive-operation flag (a native dialog, an install) while it runs. */
  exclusive<T>(run: () => Promise<T>): Promise<T>;
  /** Registers an IPC handler that only the trusted main frame may call. */
  handle<T>(
    channel: string,
    run: (args: unknown[]) => Promise<T>,
    accept?: (values: unknown[]) => boolean,
  ): void;
  /** Whether Console Mode owns the screen (the manager must not take focus). */
  consoleActive(): boolean;
  setConsoleActive(active: () => boolean): void;
  /** Brings the manager window forward, unless Console Mode owns the screen. */
  showWindow(): void;
  /** Tells the renderer to reload its status (menu command, Console Mode change). */
  refreshStatus(): void;
}

export function createContext(options: {
  userData: string;
  rendererURL: string;
  helpers: string;
}): AppContext {
  const statePath = path.join(options.userData, 'library.json');
  let mainWindow: BrowserWindow | null = null;
  let exclusiveOperation = false;
  let consoleActive = () => false;
  const busySources: Array<() => boolean> = [() => exclusiveOperation];

  function validateCaller(
    event: IpcMainInvokeEvent,
    args: unknown[],
    acceptArguments: (values: unknown[]) => boolean,
  ): void {
    if (
      !mainWindow ||
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      !isTrustedDocument(event.senderFrame.url, options.rendererURL) ||
      !acceptArguments(args)
    ) {
      throw new Error('This request is not permitted.');
    }
  }

  return {
    userData: options.userData,
    statePath,
    rendererURL: options.rendererURL,
    helpers: options.helpers,
    window: () => mainWindow,
    setWindow: (window) => {
      mainWindow = window;
    },
    async availableLibrary() {
      const library = await readLibrary(statePath);
      if (!library?.available) throw new Error('Library unavailable');
      return library.path;
    },
    busy: () => busySources.some((source) => source()),
    addBusy: (source) => {
      busySources.push(source);
    },
    async exclusive(run) {
      exclusiveOperation = true;
      try {
        return await run();
      } finally {
        exclusiveOperation = false;
      }
    },
    handle(channel, run, accept = acceptsEmptyArguments) {
      ipcMain.handle(channel, async (event, ...args) => {
        validateCaller(event, args, accept);
        return run(args);
      });
    },
    consoleActive: () => consoleActive(),
    setConsoleActive: (active) => {
      consoleActive = active;
    },
    showWindow() {
      if (consoleActive()) return;
      mainWindow?.show();
      mainWindow?.focus();
    },
    refreshStatus() {
      const contents = mainWindow?.webContents;
      if (
        !contents ||
        contents.isDestroyed() ||
        !isTrustedDocument(contents.mainFrame.url, options.rendererURL)
      )
        return;
      contents.send('mac:refresh-status');
    },
  };
}
