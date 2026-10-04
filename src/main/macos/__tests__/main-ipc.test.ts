/** @jest-environment node */
import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';
import type { MenuItemConstructorOptions } from 'electron';

interface Frame {
  url: string;
}
interface Caller {
  sender: { mainFrame: Frame };
  senderFrame: Frame;
}
type Handler = (event: Caller, ...args: unknown[]) => Promise<unknown>;
const channels = [
  'mac:status',
  'mac:install-dolphin',
  'mac:play-game',
  'mac:reset-dolphin',
  'mac:choose-library',
  'mac:reveal-library',
  'mac:recover-library-settings',
];

function createFixture() {
  const handlers = new Map<string, Handler>();
  // eslint-disable-next-line no-use-before-define -- The constructor records its instances in this array.
  const windows: FixtureWindow[] = [];
  const applicationSupport = path.join(
    os.tmpdir(),
    'main-ipc-test-application-support',
  );
  const paths = new Map([['appData', applicationSupport]]);
  const libraryPath = path.join(os.tmpdir(), 'main-ipc-test-library');
  const manager = {
    isBusy: false,
    status: jest.fn(async () => ({ version: null, operation: 'idle' })),
    install: jest.fn(async (): Promise<void> => undefined),
    launch: jest.fn(async (): Promise<void> => undefined),
    reset: jest.fn(async () => ({ backupPath: '/test-backup' })),
  };
  const readLibrary = jest.fn(async () => ({
    path: libraryPath,
    available: true,
  }));
  const selectLibrary = jest.fn(async () => ({
    path: libraryPath,
    available: true,
  }));
  const recoverLibrary = jest.fn(async () => '/test-library.json.backup');
  const prepareLibrary = jest.fn(async (): Promise<void> => undefined);
  const nativeWrites = { mkdir: jest.fn(), writeFile: jest.fn() };
  const dialog = {
    showOpenDialog: jest.fn(
      async (): Promise<{ canceled: boolean; filePaths: string[] }> => ({
        canceled: true,
        filePaths: [],
      }),
    ),
    showMessageBox: jest.fn(async () => ({ response: 0 })),
    showErrorBox: jest.fn(),
  };
  const shell = { openPath: jest.fn(async () => '') };
  const ready = Promise.resolve();
  const app = Object.assign(new EventEmitter(), {
    name: 'Emulation Workspace',
    isPackaged: false,
    setName: jest.fn(),
    setAboutPanelOptions: jest.fn(),
    setPath: jest.fn((name: string, value: string) => paths.set(name, value)),
    getPath: jest.fn((name: string) => {
      const value = paths.get(name);
      if (!value) throw new Error(`Unexpected application path: ${name}`);
      return value;
    }),
    getVersion: jest.fn(() => 'test-version'),
    requestSingleInstanceLock: jest.fn(() => true),
    whenReady: jest.fn(() => ready),
    isReady: jest.fn(() => true),
    quit: jest.fn(),
    exit: jest.fn(),
  });

  class FixtureWindow extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: { url: '' },
      setWindowOpenHandler: jest.fn(),
      executeJavaScript: jest.fn(async () => undefined),
      send: jest.fn(),
      isDestroyed: jest.fn(() => false),
    });

    show = jest.fn();

    focus = jest.fn();

    restore = jest.fn();

    isMinimized = jest.fn(() => false);

    loadURL = jest.fn(async (url: string) => {
      this.webContents.mainFrame.url = url;
    });

    constructor() {
      super();
      windows.push(this);
    }
  }

  const electron = {
    app,
    BrowserWindow: FixtureWindow,
    dialog,
    shell,
    ipcMain: {
      handle: jest.fn((channel: string, handler: Handler) =>
        handlers.set(channel, handler),
      ),
    },
    Menu: {
      buildFromTemplate: jest.fn(
        (template: MenuItemConstructorOptions[]) => template,
      ),
      setApplicationMenu: jest.fn(),
    },
    nativeTheme: {},
    systemPreferences: {
      getAccentColor: jest.fn(() => '007affff'),
      subscribeNotification: jest.fn(() => 1),
      unsubscribeNotification: jest.fn(),
    },
    screen: {
      getAllDisplays: jest.fn(() => [
        {
          size: { width: 1920, height: 1080 },
          scaleFactor: 2,
          displayFrequency: 60,
        },
      ]),
    },
    session: {
      defaultSession: {
        setPermissionRequestHandler: jest.fn(),
        setPermissionCheckHandler: jest.fn(),
      },
    },
  };
  function caller(): Caller {
    const sender = windows[0].webContents;
    return { sender, senderFrame: sender.mainFrame };
  }
  function invoke(channel: string, event = caller(), ...args: unknown[]) {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`IPC handler is missing: ${channel}`);
    return handler(event, ...args);
  }
  function assertNoProtectedWork() {
    expect(manager.status).not.toHaveBeenCalled();
    expect(manager.install).not.toHaveBeenCalled();
    expect(manager.launch).not.toHaveBeenCalled();
    expect(manager.reset).not.toHaveBeenCalled();
    expect(readLibrary).not.toHaveBeenCalled();
    expect(selectLibrary).not.toHaveBeenCalled();
    expect(recoverLibrary).not.toHaveBeenCalled();
    expect(prepareLibrary).not.toHaveBeenCalled();
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(shell.openPath).not.toHaveBeenCalled();
  }
  function assertReady() {
    expect(windows).toHaveLength(1);
    expect(app.exit).not.toHaveBeenCalled();
  }
  function assertNoNativeWrites() {
    expect(nativeWrites.mkdir).not.toHaveBeenCalled();
    expect(nativeWrites.writeFile).not.toHaveBeenCalled();
  }
  return {
    electron,
    app,
    ready,
    handlers,
    windows,
    caller,
    invoke,
    manager,
    readLibrary,
    selectLibrary,
    recoverLibrary,
    prepareLibrary,
    nativeWrites,
    dialog,
    shell,
    assertNoProtectedWork,
    assertReady,
    assertNoNativeWrites,
  };
}

// Flush asynchronous before-quit completion without launching processes or sleeping.
async function finishLifecycle() {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

describe('actual macOS main IPC and quit boundaries', () => {
  let fixture: ReturnType<typeof createFixture>;
  let systemVersionDescriptor: PropertyDescriptor | undefined;
  let smokeDirectory: string | undefined;
  beforeEach(async () => {
    jest.resetModules();
    fixture = createFixture();
    smokeDirectory = process.env.EMULATION_SMOKE_DIR;
    delete process.env.EMULATION_SMOKE_DIR;
    systemVersionDescriptor = Object.getOwnPropertyDescriptor(
      process,
      'getSystemVersion',
    );
    Object.defineProperty(process, 'getSystemVersion', {
      configurable: true,
      value: jest.fn(() => '27.0'),
    });
    jest.doMock('electron', () => fixture.electron);
    jest.doMock('fs/promises', () => fixture.nativeWrites);
    jest.doMock('../component-manager', () => ({
      ComponentManager: jest.fn(() => fixture.manager),
    }));
    jest.doMock('../library', () => ({
      readLibrary: fixture.readLibrary,
      selectLibrary: fixture.selectLibrary,
      recoverLibrarySettings: fixture.recoverLibrary,
    }));
    jest.doMock('../dolphin-library', () => ({
      prepareDolphinLibrary: fixture.prepareLibrary,
    }));
    jest.isolateModules(() => {
      jest.requireActual('../main');
    });
    await fixture.ready;
    fixture.assertReady();
  });

  afterEach(() => {
    if (smokeDirectory === undefined) delete process.env.EMULATION_SMOKE_DIR;
    else process.env.EMULATION_SMOKE_DIR = smokeDirectory;
    if (systemVersionDescriptor)
      Object.defineProperty(
        process,
        'getSystemVersion',
        systemVersionDescriptor,
      );
    else delete (process as Partial<NodeJS.Process>).getSystemVersion;
    fixture.app.removeAllListeners();
    fixture.windows.forEach((window) => {
      window.removeAllListeners();
      window.webContents.removeAllListeners();
    });
    fixture.assertNoNativeWrites();
  });

  it.each(channels)(
    'rejects a foreign WebContents before performing work: %s',
    async (channel) => {
      const sender = { mainFrame: { url: fixture.caller().senderFrame.url } };
      await expect(
        fixture.invoke(channel, { sender, senderFrame: sender.mainFrame }),
      ).rejects.toThrow('not permitted');
      fixture.assertNoProtectedWork();
    },
  );

  it.each(channels)(
    'rejects a subframe even when its URL matches: %s',
    async (channel) => {
      const event = fixture.caller();
      event.senderFrame = { url: event.senderFrame.url };
      await expect(fixture.invoke(channel, event)).rejects.toThrow(
        'not permitted',
      );
      fixture.assertNoProtectedWork();
    },
  );

  it.each(channels)(
    'rejects a main-frame document from another origin: %s',
    async (channel) => {
      const event = fixture.caller();
      event.senderFrame.url = 'https://untrusted.test/index.html';
      await expect(fixture.invoke(channel, event)).rejects.toThrow(
        'not permitted',
      );
      fixture.assertNoProtectedWork();
    },
  );

  it.each(channels)(
    'rejects renderer-supplied arguments: %s',
    async (channel) => {
      await expect(
        fixture.invoke(channel, fixture.caller(), {
          path: '/untrusted',
          command: 'execute',
        }),
      ).rejects.toThrow('not permitted');
      fixture.assertNoProtectedWork();
    },
  );

  it('returns status through the trusted main-frame handler', async () => {
    await expect(fixture.invoke('mac:status')).resolves.toMatchObject({
      platform: 'darwin',
      appVersion: 'test-version',
      osVersion: '27.0',
      dolphin: { operation: 'idle' },
      library: { available: true },
      libraryError: null,
    });
    expect(fixture.readLibrary).toHaveBeenCalledTimes(1);
    expect(fixture.manager.status).toHaveBeenCalledTimes(1);
    expect(fixture.manager.install).not.toHaveBeenCalled();
  });

  it('offers native Close and status refresh without renderer reload or production developer tools', () => {
    const template = fixture.electron.Menu.buildFromTemplate.mock.calls[0][0];
    const file = template.find((item) => item.label === 'File');
    expect(file?.submenu).toEqual([
      { role: 'close', accelerator: 'CmdOrCtrl+W' },
    ]);
    const view = template.find((item) => item.label === 'View');
    const commands = view?.submenu as MenuItemConstructorOptions[];
    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'mac-refresh-status',
          label: 'Refresh Status',
          accelerator: 'CmdOrCtrl+R',
        }),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
      ]),
    );
    expect(
      commands.some((command) =>
        ['reload', 'forceReload', 'toggleDevTools'].includes(
          command.role || '',
        ),
      ),
    ).toBe(false);
  });

  it('sends only a fixed no-data refresh notification to the trusted current window', () => {
    const template = fixture.electron.Menu.buildFromTemplate.mock.calls[0][0];
    const commands = template.find((item) => item.label === 'View')
      ?.submenu as MenuItemConstructorOptions[];
    const refresh = commands.find((item) => item.id === 'mac-refresh-status')!;
    refresh.click!(undefined as never, undefined, undefined as never);
    expect(fixture.windows[0].webContents.send).toHaveBeenCalledWith(
      'mac:refresh-status',
    );
    expect(fixture.windows[0].webContents.send).toHaveBeenCalledTimes(1);
    expect(fixture.windows[0].loadURL).toHaveBeenCalledTimes(1);
    expect(fixture.windows[0].focus).not.toHaveBeenCalled();
    fixture.assertNoProtectedWork();

    fixture.windows[0].webContents.isDestroyed.mockReturnValue(true);
    refresh.click!(undefined as never, undefined, undefined as never);
    expect(fixture.windows[0].webContents.send).toHaveBeenCalledTimes(1);
    fixture.windows[0].webContents.isDestroyed.mockReturnValue(false);
    fixture.windows[0].webContents.mainFrame.url =
      'https://untrusted.test/index.html';
    refresh.click!(undefined as never, undefined, undefined as never);
    expect(fixture.windows[0].webContents.send).toHaveBeenCalledTimes(1);
    fixture.windows[0].emit('closed');
    refresh.click!(undefined as never, undefined, undefined as never);
    expect(fixture.windows[0].webContents.send).toHaveBeenCalledTimes(1);
    fixture.electron.app.emit('second-instance');
    expect(fixture.windows).toHaveLength(2);
    expect(fixture.windows[1].loadURL).toHaveBeenCalledTimes(1);
    expect(fixture.windows[1].focus).toHaveBeenCalledTimes(1);
    fixture.assertNoProtectedWork();
  });

  it('blocks choose, play, reset, preference recovery, and a second install until the first install finishes', async () => {
    let completeInstall!: () => void;
    fixture.manager.install.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          completeInstall = resolve;
        }),
    );
    const install = fixture.invoke('mac:install-dolphin');
    await finishLifecycle();
    expect(fixture.manager.install).toHaveBeenCalledTimes(1);
    const results = await Promise.all(
      [
        'mac:choose-library',
        'mac:play-game',
        'mac:reset-dolphin',
        'mac:recover-library-settings',
        'mac:install-dolphin',
      ].map((channel) => fixture.invoke(channel)),
    );
    expect(results).toEqual(
      Array.from({ length: 5 }, () => expect.objectContaining({ ok: false })),
    );
    expect(fixture.dialog.showOpenDialog).not.toHaveBeenCalled();
    expect(fixture.dialog.showMessageBox).not.toHaveBeenCalled();
    expect(fixture.manager.launch).not.toHaveBeenCalled();
    expect(fixture.manager.reset).not.toHaveBeenCalled();
    expect(fixture.recoverLibrary).not.toHaveBeenCalled();
    expect(fixture.manager.install).toHaveBeenCalledTimes(1);
    completeInstall();
    await expect(install).resolves.toEqual({ ok: true });
    await fixture.invoke('mac:choose-library');
    expect(fixture.dialog.showOpenDialog).toHaveBeenCalledTimes(1);
  });

  it('checks a restarted manager before showing the library chooser', async () => {
    fixture.manager.status.mockImplementation(async () => {
      fixture.manager.isBusy = true;
      return { version: null, operation: 'running' };
    });
    await expect(fixture.invoke('mac:choose-library')).resolves.toMatchObject({
      ok: false,
    });
    expect(fixture.manager.status).toHaveBeenCalledTimes(1);
    expect(fixture.dialog.showOpenDialog).not.toHaveBeenCalled();
    expect(fixture.selectLibrary).not.toHaveBeenCalled();
  });

  it('does not save a selected folder if a managed game starts while the chooser is open', async () => {
    fixture.dialog.showOpenDialog.mockImplementation(async () => {
      fixture.manager.isBusy = true;
      return { canceled: false, filePaths: ['/chosen-library'] };
    });
    await expect(fixture.invoke('mac:choose-library')).resolves.toMatchObject({
      ok: false,
    });
    expect(fixture.manager.status).toHaveBeenCalledTimes(2);
    expect(fixture.selectLibrary).not.toHaveBeenCalled();
  });

  it('cancels preference recovery without backing up settings and releases the operation lock', async () => {
    fixture.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    await expect(
      fixture.invoke('mac:recover-library-settings'),
    ).resolves.toEqual({ ok: true });
    expect(fixture.recoverLibrary).not.toHaveBeenCalled();
    await fixture.invoke('mac:choose-library');
    expect(fixture.dialog.showOpenDialog).toHaveBeenCalledTimes(1);
  });

  it('backs up only the machine-local preference after explicit recovery confirmation', async () => {
    fixture.dialog.showMessageBox.mockResolvedValue({ response: 1 });
    await expect(
      fixture.invoke('mac:recover-library-settings'),
    ).resolves.toEqual({ ok: true });
    expect(fixture.recoverLibrary).toHaveBeenCalledWith(
      path.join(
        os.tmpdir(),
        'main-ipc-test-application-support',
        'Emulation Workspace',
        'library.json',
      ),
    );
    expect(fixture.manager.status).toHaveBeenCalledTimes(2);
    expect(fixture.selectLibrary).not.toHaveBeenCalled();
    expect(fixture.prepareLibrary).not.toHaveBeenCalled();
    expect(fixture.manager.reset).not.toHaveBeenCalled();
  });

  it('refuses recovery when the fresh status probe discovers a surviving game', async () => {
    fixture.manager.status.mockImplementation(async () => {
      fixture.manager.isBusy = true;
      return { version: null, operation: 'running' };
    });
    await expect(
      fixture.invoke('mac:recover-library-settings'),
    ).resolves.toMatchObject({ ok: false });
    expect(fixture.dialog.showMessageBox).not.toHaveBeenCalled();
    expect(fixture.recoverLibrary).not.toHaveBeenCalled();
  });

  it('rechecks the session after recovery confirmation before backing up settings', async () => {
    fixture.dialog.showMessageBox.mockImplementation(async () => {
      fixture.manager.isBusy = true;
      return { response: 1 };
    });
    await expect(
      fixture.invoke('mac:recover-library-settings'),
    ).resolves.toMatchObject({ ok: false });
    expect(fixture.manager.status).toHaveBeenCalledTimes(2);
    expect(fixture.recoverLibrary).not.toHaveBeenCalled();
  });

  it('holds the install lock through post-install library configuration', async () => {
    let completeConfiguration!: () => void;
    fixture.prepareLibrary.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          completeConfiguration = resolve;
        }),
    );
    const install = fixture.invoke('mac:install-dolphin');
    await finishLifecycle();
    expect(fixture.prepareLibrary).toHaveBeenCalledTimes(1);
    await expect(fixture.invoke('mac:choose-library')).resolves.toMatchObject({
      ok: false,
    });
    expect(fixture.dialog.showOpenDialog).not.toHaveBeenCalled();
    fixture.app.emit('before-quit', { preventDefault: jest.fn() });
    await finishLifecycle();
    expect(fixture.app.quit).not.toHaveBeenCalled();
    completeConfiguration();
    await expect(install).resolves.toEqual({ ok: true });
  });

  it('keeps the management app alive while a managed game is running', async () => {
    // The status probe discovers a surviving game; the previous snapshot was idle.
    fixture.manager.status.mockImplementation(async () => {
      fixture.manager.isBusy = true;
      return { version: null, operation: 'running' };
    });
    const event = { preventDefault: jest.fn() };
    fixture.app.emit('before-quit', event);
    await finishLifecycle();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(fixture.manager.status).toHaveBeenCalledTimes(1);
    expect(fixture.app.quit).not.toHaveBeenCalled();
    expect(fixture.dialog.showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('completes quitting after an idle session check and permits the resumed quit event', async () => {
    const event = { preventDefault: jest.fn() };
    fixture.app.emit('before-quit', event);
    await finishLifecycle();
    expect(fixture.app.quit).toHaveBeenCalledTimes(1);
    expect(fixture.dialog.showMessageBox).not.toHaveBeenCalled();
    const resumed = { preventDefault: jest.fn() };
    fixture.app.emit('before-quit', resumed);
    expect(resumed.preventDefault).not.toHaveBeenCalled();
  });

  it('keeps the app alive if running sessions cannot be verified', async () => {
    fixture.manager.status.mockRejectedValue(
      new Error('Session probe unavailable'),
    );
    fixture.app.emit('before-quit', { preventDefault: jest.fn() });
    await finishLifecycle();
    expect(fixture.app.quit).not.toHaveBeenCalled();
    expect(fixture.dialog.showErrorBox).toHaveBeenCalledTimes(1);
  });
});
