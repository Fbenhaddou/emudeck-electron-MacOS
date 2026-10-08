/** @jest-environment node */
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { ChildProcess } from 'child_process';
import { EmulatorRuntime } from '../emulator-runtime';
import type { PinnedAppInstaller } from '../emulator-runtime';
import { ppsspp } from '../../components/ppsspp';
import { ppssppPreflight } from '../../components/ppsspp/preflight';

async function until(condition: () => boolean) {
  for (let i = 0; i < 200 && !condition(); i += 1)
    // eslint-disable-next-line no-await-in-loop -- Poll a bounded number of ticks.
    await new Promise((resolve) => {
      setTimeout(resolve, 2);
    });
}

class FakeChild extends EventEmitter {
  exitCode: number | null = null;

  signalCode: string | null = null;

  kill = jest.fn(() => true);
}

describe('EmulatorRuntime (PPSSPP)', () => {
  let root: string;
  let library: string;
  let installRoot: string;
  let bundle: string;
  let child: FakeChild;
  beforeEach(async () => {
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-')),
    );
    library = path.join(root, 'Library — مكتبة');
    installRoot = path.join(root, 'components', 'ppsspp');
    bundle = path.join(installRoot, '1.20.4', 'PPSSPPSDL.app');
    await fs.mkdir(path.join(library, 'roms', 'psp'), { recursive: true });
    child = new FakeChild();
  });
  afterEach(() => fs.rm(root, { recursive: true, force: true }));

  function runtime(overrides: Partial<PinnedAppInstaller> = {}) {
    const app: PinnedAppInstaller = {
      spec: { version: '1.20.4' },
      health: jest.fn(async () => 'installed' as const),
      installed: jest.fn(async () => ({
        version: '1.20.4',
        bundle,
        executable: `${bundle}/Contents/MacOS/PPSSPPSDL`,
      })),
      install: jest.fn(),
      ...overrides,
    };
    const deps = {
      spawn: jest.fn(() => {
        process.nextTick(() => child.emit('spawn'));
        return child as unknown as ChildProcess;
      }),
      preflight: jest.fn(async () => undefined),
      assertLibrary: jest.fn(async () => undefined),
    };
    return {
      runtime: new EmulatorRuntime(ppsspp, app, installRoot, deps),
      deps,
      app,
    };
  }

  async function game(name = 'homebrew $(id) `x`.pbp') {
    const file = path.join(library, 'roms', 'psp', name);
    await fs.writeFile(file, 'fixture');
    return fs.realpath(file);
  }

  it('launches with argv only, an isolated HOME and a minimal environment', async () => {
    const { runtime: r, deps } = runtime();
    const rom = await game();
    const finished = r.launchAndWait(
      await fs.realpath(library),
      rom,
      'console',
    );
    await until(() => (deps.spawn as jest.Mock).mock.calls.length > 0);
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    expect(r.isBusy).toBe(true);
    const [executable, args, options] = (deps.spawn as jest.Mock).mock.calls[0];
    expect(executable).toBe(`${bundle}/Contents/MacOS/PPSSPPSDL`);
    expect(args).toEqual(['--fullscreen', '--pause-menu-exit', rom]);
    expect(options.shell).toBe(false);
    expect(Object.keys(options.env).sort()).toEqual([
      'HOME',
      'LANG',
      'PATH',
      'TMPDIR',
    ]);
    expect(options.env.HOME).toBe(
      `${await fs.realpath(library)}/emulators/ppsspp`,
    );
    child.emit('exit', 0, null);
    await expect(finished).resolves.toEqual({ code: 0, signal: null });
    expect(r.isBusy).toBe(false);
  });

  it('refuses before spawning when not installed or preflight fails', async () => {
    const rom = await game('a.iso');
    const missing = runtime({ installed: jest.fn(async () => null) });
    await expect(missing.runtime.launchAndWait(library, rom)).rejects.toThrow(
      'Install PPSSPP first',
    );
    expect(missing.deps.spawn).not.toHaveBeenCalled();
    const blocked = runtime();
    blocked.deps.preflight.mockRejectedValue(new Error('custom memory stick'));
    await expect(blocked.runtime.launchAndWait(library, rom)).rejects.toThrow(
      'custom memory stick',
    );
    expect(blocked.deps.spawn).not.toHaveBeenCalled();
    expect(blocked.runtime.isBusy).toBe(false);
  });

  it.each(['../outside.iso', 'link.iso', 'archive.zip'])(
    'refuses %s',
    async (name) => {
      const outside = path.join(root, 'outside.iso');
      await fs.writeFile(outside, 'x');
      if (name === 'link.iso')
        await fs.symlink(outside, path.join(library, 'roms', 'psp', name));
      if (name === 'archive.zip')
        await fs.writeFile(path.join(library, 'roms', 'psp', name), 'x');
      const { runtime: r, deps } = runtime();
      await expect(
        r.launchAndWait(library, path.join(library, 'roms', 'psp', name)),
      ).rejects.toThrow();
      expect(deps.spawn).not.toHaveBeenCalled();
    },
  );

  it('reports status without creating folders and refuses overlapping work', async () => {
    const { runtime: r } = runtime({
      health: jest.fn(async () => 'missing' as const),
    });
    await expect(r.status()).resolves.toMatchObject({
      id: 'ppsspp',
      systems: ['psp'],
      systemName: 'PSP',
      version: null,
      health: 'missing',
    });
    await expect(fs.lstat(installRoot)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('force-stops only its own running game', async () => {
    const { runtime: r, deps } = runtime();
    expect(r.forceStop()).toBe(false);
    const finished = r.launchAndWait(library, await game('b.iso'));
    await until(() => (deps.spawn as jest.Mock).mock.calls.length > 0);
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    expect(r.forceStop(10)).toBe(true);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('exit', null, 'SIGTERM');
    await finished;
  });
});

describe('PPSSPP preflight', () => {
  it('refuses while a global memory stick folder is set, and only reads', async () => {
    const read = jest.fn(async () => true);
    await expect(ppssppPreflight(read)()).rejects.toThrow(
      'custom memory stick',
    );
    expect(read).toHaveBeenCalledWith([
      'read',
      'org.ppsspp.ppsspp',
      'UserPreferredMemoryStickDirectoryPath',
    ]);
    await expect(ppssppPreflight(async () => false)()).resolves.toBeUndefined();
  });
});
