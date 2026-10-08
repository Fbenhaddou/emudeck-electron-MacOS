/** @jest-environment node */
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { ChildProcess } from 'child_process';
import { createSystemsCatalog } from '../es-de/catalog';
import { validateManifest } from '../schema';
import { inspectGameEntry, resolveGame } from '../shared/games';
import type { ComponentAdapter, LaunchRequest } from '../types';
import { listGames } from '../../macos/console-host';
import { EmulatorRuntime } from '../../macos/emulator-runtime';

// Synthetic PS4-style layout; every byte is test data, never a real game.
const policy = {
  id: 'folderemu',
  bundleName: 'FolderEmu.app',
  executable: 'Contents/MacOS/FolderEmu',
  urls: ['https://folder.test/', 'https://folder.test/download/'],
};
function manifestInput(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: 'folderemu',
    name: 'FolderEmu',
    systems: ['ps4'],
    platform: 'darwin',
    architecture: 'arm64',
    minimumOS: '14.0',
    homepage: policy.urls[0],
    releasePage: policy.urls[1],
    license: 'GPL-2.0-or-later',
    bundleName: policy.bundleName,
    executable: policy.executable,
    romExtensions: [],
    folderGame: {
      markers: ['eboot.bin', 'sce_sys/param.sfo'],
      launchTarget: 'eboot.bin',
      companionSuffixes: ['-UPDATE', '-patch'],
    },
    capabilities: {
      installation: 'planned',
      configuration: 'planned',
      launch: 'plan-only',
      frontend: 'planned',
    },
    ...overrides,
  };
}
const manifest = validateManifest(manifestInput(), policy);

const adapter: ComponentAdapter = {
  manifest,
  system: { id: 'ps4', fullname: 'Sony PlayStation 4', shortName: 'PS4' },
  paths: (libraryRoot) => ({
    roms: path.join(libraryRoot, 'roms', 'ps4'),
    user: path.join(libraryRoot, 'emulators', 'folderemu'),
    configuration: path.join(libraryRoot, 'emulators', 'folderemu', 'user'),
    saves: path.join(libraryRoot, 'emulators', 'folderemu', 'user', 'data'),
    states: path.join(libraryRoot, 'emulators', 'folderemu', 'user', 'data'),
  }),
  planLaunch: ({ libraryRoot, appBundlePath, romPath }: LaunchRequest) => {
    const roms = path.join(libraryRoot, 'roms', 'ps4');
    // The adapter receives only a launch target directly inside a game folder.
    if (
      path.basename(romPath) !== 'eboot.bin' ||
      path.dirname(path.dirname(romPath)) !== roms
    )
      throw new Error('Unexpected launch target');
    return {
      executable: path.join(appBundlePath, policy.executable),
      args: ['--fullscreen', 'true', '-g', romPath],
      cwd: path.join(libraryRoot, 'emulators', 'folderemu'),
    };
  },
};

let root: string;
let library: string;
let roms: string;
let outside: string;

async function folderGame(folder: string, eboot = 'ELF') {
  await fs.mkdir(path.join(folder, 'sce_sys'), { recursive: true });
  await fs.writeFile(path.join(folder, 'eboot.bin'), eboot);
  await fs.writeFile(path.join(folder, 'sce_sys', 'param.sfo'), 'PSF');
}

beforeEach(async () => {
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'folder-games-')),
  );
  library = path.join(root, 'Library — مكتبة');
  roms = path.join(library, 'roms', 'ps4');
  outside = path.join(root, 'outside');
  await fs.mkdir(roms, { recursive: true });
  await folderGame(path.join(outside, 'Elsewhere'));
  await fs.writeFile(path.join(outside, 'eboot.bin'), 'ELF');
  await fs.mkdir(path.join(outside, 'sce_sys'));
  await fs.writeFile(path.join(outside, 'sce_sys', 'param.sfo'), 'PSF');

  await folderGame(path.join(roms, 'CUSA00001 $(id) `x`'));
  await folderGame(path.join(roms, 'CUSA00001-UPDATE'));
  await folderGame(path.join(roms, 'CUSA00002-patch'));
  await folderGame(path.join(roms, '.Hidden'));
  await folderGame(path.join(roms, 'Empty eboot'), '');
  await fs.mkdir(path.join(roms, 'No param'));
  await fs.writeFile(path.join(roms, 'No param', 'eboot.bin'), 'ELF');
  // eboot.bin is a link to a file outside the library.
  await fs.mkdir(path.join(roms, 'Linked eboot', 'sce_sys'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(roms, 'Linked eboot', 'sce_sys', 'param.sfo'),
    'PSF',
  );
  await fs.symlink(
    path.join(outside, 'eboot.bin'),
    path.join(roms, 'Linked eboot', 'eboot.bin'),
  );
  // sce_sys is a link to a folder outside the library.
  await fs.mkdir(path.join(roms, 'Linked sce_sys'));
  await fs.writeFile(path.join(roms, 'Linked sce_sys', 'eboot.bin'), 'ELF');
  await fs.symlink(
    path.join(outside, 'sce_sys'),
    path.join(roms, 'Linked sce_sys', 'sce_sys'),
  );
  // The whole game folder is a link to a valid game outside the library.
  await fs.symlink(
    path.join(outside, 'Elsewhere'),
    path.join(roms, 'Linked folder'),
  );
  // A loose file with no file extensions declared is not a game.
  await fs.writeFile(path.join(roms, 'eboot.bin'), 'ELF');
});

afterEach(() => fs.rm(root, { recursive: true, force: true }));

const game = () => path.join(roms, 'CUSA00001 $(id) `x`');

describe('folder game manifests', () => {
  it.each([
    ['a parent segment', { markers: ['../eboot.bin'] }],
    ['an absolute marker', { markers: ['/eboot.bin'] }],
    ['a hidden marker', { markers: ['.eboot.bin'] }],
    ['a nested parent', { markers: ['sce_sys/../eboot.bin'] }],
    ['too deep a marker', { markers: ['a/b/c/d/eboot.bin'] }],
    ['a launch target that is not a marker', { launchTarget: 'other.bin' }],
    ['a bad companion suffix', { companionSuffixes: ['UPDATE'] }],
  ])('refuses %s', (_label, change) => {
    const folder = { ...manifestInput().folderGame, ...change };
    expect(() =>
      validateManifest(manifestInput({ folderGame: folder }), policy),
    ).toThrow();
  });

  it('allows no file extensions only for folder-game components', () => {
    expect(manifest.romExtensions).toEqual([]);
    const { folderGame: omitted, ...withoutFolders } = manifestInput();
    expect(omitted).toBeDefined();
    expect(() => validateManifest(withoutFolders, policy)).toThrow();
  });
});

describe('folder games in the library', () => {
  it('lists only complete, real game folders: no links, updates, DLC or hidden folders', async () => {
    const games = await listGames(library, [
      {
        system: {
          id: 'ps4',
          fullname: 'Sony PlayStation 4',
          label: 'FolderEmu',
        },
        adapter,
        installed: async () => true,
      },
    ]);
    expect(games).toEqual([
      {
        system: 'ps4',
        path: game(),
        relativePath: 'roms/ps4/CUSA00001 $(id) `x`',
        name: 'CUSA00001 $(id) `x`',
      },
    ]);
  });

  it('reports the folder as the game and eboot.bin as its launch target', async () => {
    await expect(
      inspectGameEntry(roms, 'CUSA00001 $(id) `x`', manifest),
    ).resolves.toEqual({
      kind: 'folder',
      path: game(),
      launchPath: path.join(game(), 'eboot.bin'),
      name: 'CUSA00001 $(id) `x`',
    });
  });

  it('gives ES-DE only an opaque marker, never the folder path', async () => {
    await fs.writeFile(path.join(root, 'helper'), 'placeholder\n', {
      mode: 0o700,
    });
    const runtime = path.join(root, 'runtime');
    await fs.mkdir(runtime, { mode: 0o700 });
    await fs.copyFile(path.join(root, 'helper'), path.join(runtime, 'helper'));
    const id = 'c'.repeat(32);
    const catalog = await createSystemsCatalog(runtime, [
      {
        id: 'ps4',
        fullname: 'Sony PlayStation 4',
        label: 'FolderEmu',
        entries: [{ id, name: 'CUSA00001 $(id) `x`' }],
      },
    ]);
    expect(Object.keys(catalog.markers)).toEqual([id]);
    const marker = catalog.markers[id];
    expect(marker.startsWith(runtime)).toBe(true);
    expect(marker).not.toContain('CUSA00001');
    const files = await fs.readdir(path.dirname(marker));
    expect(files.join('\n')).not.toContain('$(id)');
  });
});

describe('folder games on case-insensitive volumes and mixed systems', () => {
  it('launches the on-disk spelling of the launch target', async () => {
    const folder = path.join(roms, 'Upper');
    await fs.mkdir(path.join(folder, 'sce_sys'), { recursive: true });
    await fs.writeFile(path.join(folder, 'EBOOT.BIN'), 'ELF');
    await fs.writeFile(path.join(folder, 'sce_sys', 'param.sfo'), 'PSF');
    const entry = await inspectGameEntry(roms, 'Upper', manifest);
    // APFS is case-insensitive by default; a case-sensitive volume has no game here.
    if (!entry) return;
    expect(entry.launchPath).toBe(path.join(folder, 'EBOOT.BIN'));
    await expect(
      resolveGame(roms, manifest, path.join(folder, 'EBOOT.BIN')),
    ).resolves.toBe(path.join(folder, 'EBOOT.BIN'));
  });

  it('never launches a loose file from inside a game, update or DLC folder', async () => {
    const mixed = validateManifest(
      manifestInput({ romExtensions: ['.bin'] }),
      policy,
    );
    await expect(
      resolveGame(roms, mixed, path.join(roms, 'CUSA00002-patch', 'eboot.bin')),
    ).rejects.toThrow('Choose a supported game');
    await expect(
      resolveGame(roms, mixed, path.join(roms, '.Hidden', 'eboot.bin')),
    ).rejects.toThrow('Choose a supported game');
    // A top-level file and a real folder game's own target still launch.
    await expect(
      resolveGame(roms, mixed, path.join(roms, 'eboot.bin')),
    ).resolves.toBe(path.join(roms, 'eboot.bin'));
    await expect(
      resolveGame(roms, mixed, path.join(game(), 'eboot.bin')),
    ).resolves.toBe(path.join(game(), 'eboot.bin'));
  });
});

describe('launching a folder game', () => {
  class FakeChild extends EventEmitter {
    exitCode: number | null = null;

    signalCode: string | null = null;

    kill = jest.fn(() => true);
  }

  function runtime() {
    const bundle = path.join(root, 'components', '1.0', 'FolderEmu.app');
    const deps = {
      spawn: jest.fn(() => {
        const child = new FakeChild();
        process.nextTick(() => child.emit('spawn'));
        return child as unknown as ChildProcess;
      }),
      preflight: jest.fn(async () => undefined),
      assertLibrary: jest.fn(async () => undefined),
    };
    const app = {
      spec: { version: '1.0' },
      health: jest.fn(async () => 'installed' as const),
      installed: jest.fn(async () => ({
        version: '1.0',
        bundle,
        executable: path.join(bundle, policy.executable),
      })),
      install: jest.fn(),
    };
    return {
      runtime: new EmulatorRuntime(
        adapter,
        app,
        path.join(root, 'components'),
        deps,
      ),
      deps,
    };
  }

  it.each([
    ['the game folder', () => game()],
    ['its launch target', () => path.join(game(), 'eboot.bin')],
  ])(
    'passes the absolute eboot.bin as argv when given %s',
    async (_label, chosen) => {
      const { runtime: r, deps } = runtime();
      await r.launch(library, chosen());
      expect(deps.spawn).toHaveBeenCalledTimes(1);
      const [, args, options] = deps.spawn.mock.calls[0] as unknown[] as [
        string,
        string[],
        { shell: boolean },
      ];
      expect(args).toEqual([
        '--fullscreen',
        'true',
        '-g',
        path.join(game(), 'eboot.bin'),
      ]);
      expect(options.shell).toBe(false);
    },
  );

  it.each([
    ['a traversal path', () => `${game()}/../CUSA00001-UPDATE`],
    [
      'a path that leaves the library',
      () => path.join(roms, '..', '..', '..', 'outside', 'Elsewhere'),
    ],
    ['a linked game folder', () => path.join(roms, 'Linked folder')],
    ['a game with a linked eboot.bin', () => path.join(roms, 'Linked eboot')],
    ['a game with a linked sce_sys', () => path.join(roms, 'Linked sce_sys')],
    ['an update folder', () => path.join(roms, 'CUSA00001-UPDATE')],
    ['a DLC/patch folder', () => path.join(roms, 'CUSA00002-patch')],
    ['an incomplete folder', () => path.join(roms, 'No param')],
    ['an empty eboot.bin', () => path.join(roms, 'Empty eboot')],
    [
      'a marker that is not the launch target',
      () => path.join(game(), 'sce_sys', 'param.sfo'),
    ],
    ['a loose eboot.bin', () => path.join(roms, 'eboot.bin')],
    ['the roms folder itself', () => roms],
    ['a folder outside the library', () => path.join(outside, 'Elsewhere')],
  ])('refuses %s and starts nothing', async (_label, chosen) => {
    await expect(resolveGame(roms, manifest, chosen())).rejects.toThrow(
      'Choose a supported game inside this library',
    );
    const { runtime: r, deps } = runtime();
    await expect(r.launch(library, chosen())).rejects.toThrow();
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(r.isBusy).toBe(false);
  });
});
