/** @jest-environment node */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { ManagedEmulator } from '../../components/registry-types';
import type { ComponentAdapter } from '../../components/types';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

/**
 * Roadmap "Done when": adding an emulator is its component folder plus one
 * registry line. A stub registered only in the registry must reach Console
 * Mode, the library overview, firmware and the install/play allowlists.
 */
describe('emulator registry', () => {
  let root: string;
  let library: string;
  const handlers = new Map<string, Handler>();
  const rendererURL = 'file:///test/renderer/index.html';

  const stubAdapter: ComponentAdapter = Object.freeze({
    manifest: Object.freeze({
      schemaVersion: 1 as const,
      id: 'stubemu',
      name: 'StubEmu',
      systems: Object.freeze(['stub']),
      platform: 'darwin' as const,
      architecture: 'arm64' as const,
      minimumOS: '13.0',
      homepage: 'https://stub.test/',
      releasePage: 'https://stub.test/download/',
      license: 'MIT',
      bundleName: 'StubEmu.app',
      executable: 'Contents/MacOS/StubEmu',
      romExtensions: Object.freeze(['.stub']),
      capabilities: Object.freeze({
        installation: 'planned' as const,
        configuration: 'planned' as const,
        launch: 'plan-only' as const,
        frontend: 'planned' as const,
      }),
    }),
    system: Object.freeze({
      id: 'stub',
      fullname: 'Stub Console',
      shortName: 'Stub',
    }),
    firmware: Object.freeze([
      Object.freeze({
        id: 'stub-bios',
        system: 'stub',
        title: 'Stub BIOS',
        purpose: 'Synthetic test requirement.',
        required: true,
        maxBytes: 1024,
        source: 'Synthetic',
        knownDumps: Object.freeze([
          Object.freeze({
            label: 'Synthetic',
            crc32: '00000000',
            destinations: Object.freeze(['emulators/stubemu/bios.bin']),
          }),
        ]),
      }),
    ]),
    paths: (libraryRoot: string) =>
      Object.freeze({
        roms: path.join(libraryRoot, 'roms', 'stub'),
        user: path.join(libraryRoot, 'emulators', 'stubemu'),
        configuration: path.join(libraryRoot, 'emulators', 'stubemu', 'cfg'),
        saves: path.join(libraryRoot, 'emulators', 'stubemu', 'saves'),
        states: path.join(libraryRoot, 'emulators', 'stubemu', 'states'),
      }),
    planLaunch: () => {
      throw new Error('Not launched in this test');
    },
  });
  const stubApp = {
    spec: { version: '1.0' },
    health: jest.fn(async () => 'missing' as const),
    installed: jest.fn(async () => null),
    install: jest.fn(async () => ({}) as never),
  };
  const stub: ManagedEmulator = { adapter: stubAdapter, app: stubApp };

  beforeEach(async () => {
    jest.resetModules();
    handlers.clear();
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'registry-test-')),
    );
    library = path.join(root, 'library');
    await fs.mkdir(path.join(library, 'roms', 'stub'), { recursive: true });
    await fs.writeFile(path.join(library, 'roms', 'stub', 'Demo.stub'), 'x');
    jest.doMock('electron', () => ({
      ipcMain: {
        handle: (channel: string, handler: Handler) =>
          handlers.set(channel, handler),
      },
      dialog: {},
    }));
    jest.doMock('../library', () => ({
      readLibrary: async () => ({ path: library, available: true }),
    }));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  function load() {
    /* eslint-disable global-require -- Modules load after their mocks. */
    const { createContext } = require('../app/context');
    const { managedEmulators } = require('../../components/registry');
    const {
      createEmulators,
      registerEmulatorHandlers,
    } = require('../app/emulators');
    const { libraryOverview } = require('../app/library');
    const registerFirmwareHandlers = require('../app/firmware').default;
    /* eslint-enable global-require */
    const context = createContext({
      userData: path.join(root, 'user-data'),
      rendererURL,
      helpers: path.join(root, 'helpers'),
    });
    const contents = { mainFrame: { url: rendererURL } };
    context.setWindow({ webContents: contents });
    const emulators = createEmulators(context, [...managedEmulators, stub]);
    registerEmulatorHandlers(context, emulators);
    registerFirmwareHandlers(context, emulators);
    const caller = { sender: contents, senderFrame: contents.mainFrame };
    return {
      emulators,
      overview: libraryOverview(context, emulators),
      invoke: (channel: string, ...args: unknown[]) =>
        handlers.get(channel)!(caller, ...args),
    };
  }

  it('reaches Console Mode systems and runners', () => {
    const { emulators } = load();
    expect(emulators.pinnedIDs).toEqual(['ppsspp', 'stubemu']);
    expect(
      emulators.systems.map((entry: { system: unknown }) => entry.system),
    ).toEqual([
      { id: 'gc', fullname: 'Nintendo GameCube', label: 'Dolphin' },
      { id: 'psp', fullname: 'Sony PlayStation Portable', label: 'PPSSPP' },
      { id: 'stub', fullname: 'Stub Console', label: 'StubEmu' },
    ]);
    expect(Object.keys(emulators.runners)).toEqual(['gc', 'psp', 'stub']);
    expect(emulators.runners.stub).toBe(emulators.pinned.stubemu);
  });

  it('reaches the library overview, firmware and status', async () => {
    const { emulators, overview } = load();
    const result = await overview();
    expect(result.systems).toContainEqual({
      id: 'stub',
      name: 'Stub',
      emulator: 'StubEmu',
      installed: false,
      games: 1,
      folder: path.join('roms', 'stub'),
    });
    expect(result.firmware).toContainEqual(
      expect.objectContaining({
        id: 'stub-bios',
        system: 'stub',
        required: true,
        state: 'missing',
      }),
    );
    await expect(emulators.pinned.stubemu.status()).resolves.toMatchObject({
      id: 'stubemu',
      systemName: 'Stub',
      architecture: 'arm64',
      health: 'missing',
    });
  });

  it('reaches the install allowlist, and unknown ids stay refused', async () => {
    const { invoke } = load();
    await expect(invoke('mac:install-emulator', 'stubemu')).resolves.toEqual({
      ok: true,
    });
    expect(stubApp.install).toHaveBeenCalledTimes(1);
    await expect(invoke('mac:install-emulator', 'unknown')).rejects.toThrow(
      'not permitted',
    );
    await expect(invoke('mac:play-emulator', 'stub')).rejects.toThrow(
      'not permitted',
    );
  });

  it('reaches the firmware allowlist', async () => {
    const { invoke } = load();
    // Accepted: it reaches the (absent) native file sheet and fails safely.
    await expect(invoke('mac:add-firmware', 'stub-bios')).resolves.toEqual({
      ok: false,
      error: expect.stringContaining('Nothing was changed'),
    });
    await expect(invoke('mac:add-firmware', 'other-bios')).rejects.toThrow(
      'not permitted',
    );
  });
});
