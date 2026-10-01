import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { ChildProcess, spawn } from 'child_process';
import { ComponentManager } from '../component-manager';
import { installDolphin } from '../../components/dolphin/install';

describe('component manager operation and installation boundaries', () => {
  let root: string;
  let child: ChildProcess;
  const release = {
    version: '2609',
    revision: 'a'.repeat(40),
    artifactURL:
      'https://dl.dolphin-emu.org/releases/2609/dolphin-2609-universal.dmg',
  };
  const dependencies = () => ({
    discoverRelease: jest.fn(async () => release),
    installDolphin: jest.fn(installDolphin),
    verifyBundle: jest.fn(async () => undefined),
    prepareDolphinLibrary: jest.fn(async () => undefined),
    resetDolphinConfiguration: jest.fn(async () => ({ backupPath: '/backup' })),
    validateGame: jest.fn(async (_library: string, game: string) => game),
    spawn: jest.fn(() => child) as unknown as typeof spawn,
  });
  beforeEach(async () => {
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'component-manager-')),
    );
    child = new ChildProcess();
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function receipt(
    version = '2609',
    changes: Record<string, unknown> = {},
  ) {
    const directory = path.join(root, version);
    const bundle = path.join(directory, 'Dolphin.app');
    await fs.mkdir(bundle, { recursive: true });
    await fs.writeFile(
      path.join(directory, 'receipt.json'),
      JSON.stringify({
        version,
        bundlePath: bundle,
        verification: 'codesign-and-gatekeeper',
        ...changes,
      }),
    );
    return bundle;
  }

  it('ignores spoofed paths and preserves unknown newer versions', async () => {
    await receipt('2610', { bundlePath: '/Applications/Dolphin.app' });
    await receipt('2609');
    const manager = new ComponentManager(root, jest.fn(), dependencies());
    expect(await manager.status()).toEqual({
      version: '2609',
      operation: 'idle',
    });
    expect(
      await fs.readFile(path.join(root, '2610/receipt.json'), 'utf8'),
    ).toContain('/Applications/Dolphin.app');
  });

  it('rejects symlinked version directories and receipts', async () => {
    await receipt('2609');
    await fs.symlink(path.join(root, '2609'), path.join(root, '2610'));
    await fs.rename(
      path.join(root, '2609/receipt.json'),
      path.join(root, 'saved-receipt'),
    );
    await fs.symlink(
      path.join(root, 'saved-receipt'),
      path.join(root, '2609/receipt.json'),
    );
    const manager = new ComponentManager(root, jest.fn(), dependencies());
    expect((await manager.status()).version).toBeNull();
  });

  it('rejects redirected bundles', async () => {
    const bundle = await receipt();
    await fs.rename(bundle, path.join(root, 'outside'));
    await fs.symlink(path.join(root, 'outside'), bundle);
    expect(
      (await new ComponentManager(root, jest.fn(), dependencies()).status())
        .version,
    ).toBeNull();
  });

  it('blocks reset and launch during release discovery and unlocks on failure', async () => {
    const deps = dependencies();
    let rejectDiscovery!: (error: Error) => void;
    deps.discoverRelease.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectDiscovery = reject;
        }),
    );
    const manager = new ComponentManager(root, jest.fn(), deps);
    const installation = manager.install();
    expect(manager.isBusy).toBe(true);
    await expect(manager.reset(root)).rejects.toThrow('active');
    await expect(manager.launch(root, '/game.dol')).rejects.toThrow('active');
    rejectDiscovery(new Error('offline'));
    await expect(installation).rejects.toThrow('offline');
    expect(manager.isBusy).toBe(false);
  });

  it('preserves existing unknown installation directories', async () => {
    await fs.mkdir(path.join(root, release.version));
    await fs.writeFile(
      path.join(root, release.version, 'precious'),
      'preserve',
    );
    const manager = new ComponentManager(root, jest.fn(), dependencies());
    await expect(manager.install()).rejects.toThrow();
    expect(
      await fs.readFile(path.join(root, release.version, 'precious'), 'utf8'),
    ).toBe('preserve');
    expect(manager.isBusy).toBe(false);
  });

  it('reverifies an installed version without reinstalling', async () => {
    const bundle = await receipt();
    const deps = dependencies();
    const manager = new ComponentManager(root, jest.fn(), deps);
    await manager.install();
    expect(deps.verifyBundle).toHaveBeenCalledWith(bundle);
    expect(deps.installDolphin).not.toHaveBeenCalled();
  });

  it('holds the lock while running and releases it on exit', async () => {
    await receipt();
    const deps = dependencies();
    const exited = jest.fn();
    (deps.spawn as jest.Mock).mockImplementation(() => {
      process.nextTick(() => child.emit('spawn'));
      return child;
    });
    const manager = new ComponentManager(root, exited, deps);
    await manager.launch(root, path.join(root, 'roms/gc/legal.dol'));
    expect((await manager.status()).operation).toBe('running');
    await expect(manager.install()).rejects.toThrow('active');
    await expect(manager.reset(root)).rejects.toThrow('active');
    child.emit('exit', 0);
    expect(manager.isBusy).toBe(false);
    expect(exited).toHaveBeenCalledTimes(1);
    expect((deps.spawn as jest.Mock).mock.calls[0][2].shell).toBe(false);
  });

  it('does not let a failed old child unlock a later reset', async () => {
    await receipt();
    const deps = dependencies();
    (deps.spawn as jest.Mock).mockImplementation(() => {
      process.nextTick(() => child.emit('error', new Error('spawn failed')));
      return child;
    });
    const manager = new ComponentManager(root, jest.fn(), deps);
    await expect(
      manager.launch(root, path.join(root, 'roms/gc/legal.dol')),
    ).rejects.toThrow('spawn failed');
    expect(manager.isBusy).toBe(false);
    let completeReset!: (value: { backupPath: string }) => void;
    deps.resetDolphinConfiguration.mockImplementation(
      () =>
        new Promise((resolve) => {
          completeReset = resolve;
        }),
    );
    const reset = manager.reset(root);
    child.emit('exit', 1);
    expect(manager.isBusy).toBe(true);
    await expect(manager.install()).rejects.toThrow('active');
    completeReset({ backupPath: '/preserved-config' });
    await expect(reset).resolves.toEqual({ backupPath: '/preserved-config' });
    expect(manager.isBusy).toBe(false);
  });

  it('unlocks on synchronous process creation failure without reporting an exit', async () => {
    await receipt();
    const deps = dependencies();
    const exited = jest.fn();
    (deps.spawn as jest.Mock).mockImplementation(() => {
      throw new Error('cannot spawn');
    });
    const manager = new ComponentManager(root, exited, deps);
    await expect(
      manager.launch(root, path.join(root, 'roms/gc/legal.dol')),
    ).rejects.toThrow('cannot spawn');
    expect(manager.isBusy).toBe(false);
    expect(exited).not.toHaveBeenCalled();
  });

  it('preserves reset recovery errors and releases its operation lock', async () => {
    const deps = dependencies();
    const failure = Object.assign(new Error('original preserved'), {
      backupPath: '/recoverable',
      restored: false,
    });
    deps.resetDolphinConfiguration.mockRejectedValue(failure);
    const manager = new ComponentManager(root, jest.fn(), deps);
    await expect(manager.reset(root)).rejects.toBe(failure);
    expect(manager.isBusy).toBe(false);
  });
});
