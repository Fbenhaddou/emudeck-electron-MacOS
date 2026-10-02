/** @jest-environment node */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { installDolphin, ProcessRunner } from '../dolphin/install';

const release = {
  version: '2609',
  revision: 'a'.repeat(40),
  artifactURL:
    'https://dl.dolphin-emu.org/releases/2609/dolphin-2609-universal.dmg',
};
const marker = '.dolphin-install.json';

describe('Dolphin installer interruption and mount recovery', () => {
  let root: string;
  let mounts: string[];
  let attachFails: boolean;
  let detachFails: boolean;
  let inventoryFails: boolean;
  let unexpectedMount: boolean;
  let receiptAtDetach: boolean;
  let run: ProcessRunner;
  const download = jest.fn(async () => ({ sha256: 'b'.repeat(64), bytes: 7 }));

  beforeEach(async () => {
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'dolphin-recovery-')),
    );
    mounts = [];
    attachFails = false;
    detachFails = false;
    inventoryFails = false;
    unexpectedMount = false;
    receiptAtDetach = false;
    download.mockClear();
    run = jest.fn(async (binary, args, input) => {
      if (binary.endsWith('hdiutil')) {
        if (args[0] === 'info') {
          if (inventoryFails) throw new Error('Inventory unavailable');
          return '<inventory/>';
        }
        if (args[0] === 'detach') {
          receiptAtDetach = await fs
            .access(path.join(root, release.version, 'receipt.json'))
            .then(
              () => true,
              () => false,
            );
          if (detachFails) throw new Error('Image busy');
          mounts = mounts.filter((mount) => mount !== args[1]);
          return '';
        }
        if (attachFails) throw new Error('Attach failed before mounting');
        const mountPoint = args[args.indexOf('-mountpoint') + 1];
        mounts.push(
          unexpectedMount ? path.join(mountPoint, 'unexpected') : mountPoint,
        );
        await fs.mkdir(path.join(mountPoint, 'Dolphin.app'));
        await fs.writeFile(
          path.join(mountPoint, 'Dolphin.app', 'data'),
          'fixture',
        );
        return JSON.stringify({
          'system-entities': [{ 'mount-point': mountPoint }],
        });
      }
      if (binary.endsWith('plutil')) {
        if (input === '<inventory/>')
          return JSON.stringify({
            images: mounts.map((mount) => ({
              'image-path': `${mount.split('/mount')[0]}/download.dmg`,
              'system-entities': [{ 'mount-point': mount }],
            })),
          });
        if (input) return input;
        return JSON.stringify({
          CFBundleIdentifier: 'org.dolphin-emu.dolphin',
          CFBundleExecutable: 'Dolphin',
          CFBundleShortVersionString: release.version,
          CFBundleLongVersionString: release.revision,
          CFBundleVersion: '2609.0',
          LSMinimumSystemVersion: '11.0.0',
        });
      }
      if (binary.endsWith('sw_vers')) return '27.0\n';
      if (binary.endsWith('lipo')) return 'arm64 x86_64';
      if (binary.endsWith('ditto'))
        await fs.cp(args[0], args[1], {
          recursive: true,
          force: false,
          errorOnExist: true,
        });
      return '';
    });
  });

  afterEach(async () => {
    // Mounts in these tests are filesystem fixtures, never actual attached images.
    await fs.rm(root, { recursive: true, force: true });
  });

  async function ownedStage(
    name = '.dolphin-stage-ABC123',
    stagedRelease = release,
  ) {
    const staged = path.join(root, name);
    await fs.mkdir(staged, { mode: 0o700 });
    const journal = {
      format: 'emulation-workspace-dolphin-install',
      schemaVersion: 1,
      release: stagedRelease,
      stagingDirectory: name,
    };
    await fs.writeFile(path.join(staged, marker), JSON.stringify(journal));
    return { staged, journal };
  }

  it('cleans a failed attach without a mount and permits the next attempt', async () => {
    attachFails = true;
    await expect(installDolphin(release, root, run, download)).rejects.toThrow(
      'Attach failed',
    );
    expect(await fs.readdir(root)).toEqual([]);
    expect(
      (run as jest.Mock).mock.calls.some(([, args]) => args[0] === 'detach'),
    ).toBe(false);
    attachFails = false;
    const receipt = await installDolphin(release, root, run, download);
    expect(receipt.bundlePath).toBe(
      path.join(root, release.version, 'Dolphin.app'),
    );
    expect(receiptAtDetach).toBe(false);
  });

  it('preserves a busy mounted transaction without activation, then recovers on retry', async () => {
    detachFails = true;
    await expect(installDolphin(release, root, run, download)).rejects.toThrow(
      'Image busy',
    );
    const stageNames = (await fs.readdir(root)).filter((name) =>
      name.startsWith('.dolphin-stage-'),
    );
    expect(stageNames).toHaveLength(1);
    expect(
      await fs.readFile(
        path.join(root, stageNames[0], 'mount/Dolphin.app/data'),
        'utf8',
      ),
    ).toBe('fixture');
    await expect(fs.stat(path.join(root, release.version))).rejects.toThrow();
    detachFails = false;
    await installDolphin(release, root, run, download);
    expect(await fs.readdir(root)).toEqual([release.version]);
    expect(mounts).toEqual([]);
    expect(receiptAtDetach).toBe(false);
  });

  it('recovers a journaled interrupted download while preserving unrelated stages', async () => {
    const { staged } = await ownedStage();
    await fs.writeFile(path.join(staged, 'download.dmg'), 'partial');
    const unknown = path.join(root, '.dolphin-stage-XYZ123');
    await fs.mkdir(unknown);
    await fs.writeFile(path.join(unknown, 'precious'), 'keep');
    await installDolphin(release, root, run, download);
    await expect(fs.stat(staged)).rejects.toThrow();
    expect(await fs.readFile(path.join(unknown, 'precious'), 'utf8')).toBe(
      'keep',
    );
  });

  it('recovers an older release orphan mount before installing the newer release, preserving activated versions and unrelated mounts', async () => {
    const older = {
      version: '2608',
      revision: 'c'.repeat(40),
      artifactURL:
        'https://dl.dolphin-emu.org/releases/2608/dolphin-2608-universal.dmg',
    };
    const { staged } = await ownedStage('.dolphin-stage-OLD123', older);
    await fs.writeFile(path.join(staged, 'download.dmg'), 'older download');
    const orphanMount = path.join(staged, 'mount');
    await fs.mkdir(orphanMount);
    const unrelatedMount = '/Volumes/Other User Image';
    mounts.push(orphanMount, unrelatedMount);
    const previous = path.join(root, older.version);
    await fs.mkdir(path.join(previous, 'Dolphin.app'), { recursive: true });
    await fs.writeFile(path.join(previous, 'Dolphin.app', 'data'), 'old app');
    await fs.writeFile(
      path.join(previous, 'receipt.json'),
      'active old receipt',
    );
    const unmarked = path.join(root, '.dolphin-stage-NEW123');
    await fs.mkdir(unmarked);
    await fs.writeFile(path.join(unmarked, 'precious'), 'unrelated files');

    const receipt = await installDolphin(release, root, run, download);

    expect(receipt.version).toBe(release.version);
    await expect(fs.stat(staged)).rejects.toThrow();
    expect(mounts).toEqual([unrelatedMount]);
    expect(run).toHaveBeenCalledWith('/usr/bin/hdiutil', [
      'detach',
      orphanMount,
    ]);
    expect(run).not.toHaveBeenCalledWith('/usr/bin/hdiutil', [
      'detach',
      unrelatedMount,
    ]);
    expect(await fs.readFile(path.join(previous, 'receipt.json'), 'utf8')).toBe(
      'active old receipt',
    );
    expect(
      await fs.readFile(path.join(previous, 'Dolphin.app', 'data'), 'utf8'),
    ).toBe('old app');
    expect(await fs.readFile(path.join(unmarked, 'precious'), 'utf8')).toBe(
      'unrelated files',
    );
  });

  it.each([
    { version: '../2608' },
    { artifactURL: 'https://evil.test/dolphin-2608-universal.dmg' },
    {
      artifactURL:
        'https://dl.dolphin-emu.org/releases/2607/dolphin-2607-universal.dmg',
    },
    { revision: 'not-a-source-revision' },
  ])(
    'preserves tampered older release journals and their mounts: %j',
    async (changes) => {
      const older = {
        version: '2608',
        revision: 'c'.repeat(40),
        artifactURL:
          'https://dl.dolphin-emu.org/releases/2608/dolphin-2608-universal.dmg',
        ...changes,
      };
      const { staged } = await ownedStage('.dolphin-stage-OLD123', older);
      await fs.writeFile(
        path.join(staged, 'download.dmg'),
        'preserve download',
      );
      const mount = path.join(staged, 'mount');
      await fs.mkdir(mount);
      mounts.push(mount);

      await installDolphin(release, root, run, download);

      expect(await fs.readFile(path.join(staged, 'download.dmg'), 'utf8')).toBe(
        'preserve download',
      );
      expect(mounts).toEqual([mount]);
      expect(run).not.toHaveBeenCalledWith('/usr/bin/hdiutil', [
        'detach',
        mount,
      ]);
    },
  );

  it.each([
    { stagingDirectory: '../outside' },
    { schemaVersion: 2 },
    { extra: true },
    { release: { ...release, artifactURL: 'https://evil.test/app.dmg' } },
  ])(
    'preserves staging with an invalid recovery journal: %j',
    async (changes) => {
      const { staged, journal } = await ownedStage();
      await fs.writeFile(
        path.join(staged, marker),
        JSON.stringify({ ...journal, ...changes }),
      );
      await fs.writeFile(path.join(staged, 'download.dmg'), 'keep');
      await installDolphin(release, root, run, download);
      expect(await fs.readFile(path.join(staged, 'download.dmg'), 'utf8')).toBe(
        'keep',
      );
    },
  );

  it('does not follow a symlinked staging directory during recovery', async () => {
    const { staged } = await ownedStage();
    const external = path.join(root, 'unrelated');
    await fs.rename(staged, external);
    await fs.symlink(external, staged);
    await fs.writeFile(path.join(external, 'precious'), 'keep');
    await installDolphin(release, root, run, download);
    expect((await fs.lstat(staged)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(path.join(external, 'precious'), 'utf8')).toBe(
      'keep',
    );
  });

  it('recovers an owned interrupted final reservation without an activation receipt', async () => {
    const { staged, journal } = await ownedStage();
    await fs.rm(staged, { recursive: true });
    const destination = path.join(root, release.version);
    await fs.mkdir(destination, { mode: 0o700 });
    await fs.writeFile(path.join(destination, marker), JSON.stringify(journal));
    await fs.mkdir(path.join(destination, 'Dolphin.app'));
    await fs.writeFile(
      path.join(destination, 'Dolphin.app', 'data'),
      'interrupted',
    );
    await fs.writeFile(path.join(destination, '.receipt.json.tmp'), '{partial');
    await installDolphin(release, root, run, download);
    expect(
      await fs.readFile(path.join(destination, 'Dolphin.app', 'data'), 'utf8'),
    ).toBe('fixture');
    await expect(fs.stat(path.join(destination, marker))).rejects.toThrow();
  });

  it('preserves an unmarked directory from the mkdir/marker interruption window', async () => {
    const destination = path.join(root, release.version);
    await fs.mkdir(destination);
    await expect(installDolphin(release, root, run, download)).rejects.toThrow(
      'preserved',
    );
    expect(await fs.readdir(destination)).toEqual([]);
    expect(download).not.toHaveBeenCalled();
  });

  it.each(['open', 'write', 'sync'] as const)(
    'cleans its new reservation after final marker %s failure and permits retry',
    async (failurePoint) => {
      const previous = path.join(root, '2608');
      await fs.mkdir(path.join(previous, 'Dolphin.app'), { recursive: true });
      await fs.writeFile(
        path.join(previous, 'Dolphin.app', 'data'),
        'previous',
      );
      await fs.writeFile(path.join(previous, 'receipt.json'), 'prior receipt');
      const configuration = path.join(root, 'portable-library', 'Dolphin.ini');
      await fs.mkdir(path.dirname(configuration));
      await fs.writeFile(configuration, 'custom user settings');
      const card = path.join(path.dirname(configuration), 'memory-card.raw');
      await fs.writeFile(card, 'valuable progress');

      const finalMarker = path.join(root, release.version, marker);
      const failure = Object.assign(new Error('Final marker disk full'), {
        code: 'ENOSPC',
      });
      const originalOpen = fs.open.bind(fs);
      let failed = false;
      let handleSpy: jest.SpyInstance | undefined;
      const openSpy = jest
        .spyOn(fs, 'open')
        .mockImplementation(async (...args) => {
          if (args[0] !== finalMarker || failed) return originalOpen(...args);
          failed = true;
          if (failurePoint === 'open') throw failure;
          const handle = await originalOpen(...args);
          if (failurePoint === 'write') {
            const write = handle.writeFile.bind(handle);
            handleSpy = jest
              .spyOn(handle, 'writeFile')
              .mockImplementationOnce(async () => {
                await write('{partial marker');
                throw failure;
              });
          } else {
            handleSpy = jest
              .spyOn(handle, 'sync')
              .mockRejectedValueOnce(failure);
          }
          return handle;
        });
      try {
        await expect(
          installDolphin(release, root, run, download),
        ).rejects.toThrow('Final marker disk full');
      } finally {
        openSpy.mockRestore();
        handleSpy?.mockRestore();
      }

      expect(failed).toBe(true);
      expect(mounts).toEqual([]);
      expect(receiptAtDetach).toBe(false);
      expect((await fs.readdir(root)).sort()).toEqual([
        '2608',
        'portable-library',
      ]);
      const receipt = await installDolphin(release, root, run, download);
      expect(receipt.bundlePath).toBe(
        path.join(root, release.version, 'Dolphin.app'),
      );
      expect(
        await fs.readFile(path.join(previous, 'receipt.json'), 'utf8'),
      ).toBe('prior receipt');
      expect(
        await fs.readFile(path.join(previous, 'Dolphin.app', 'data'), 'utf8'),
      ).toBe('previous');
      expect(await fs.readFile(configuration, 'utf8')).toBe(
        'custom user settings',
      );
      expect(await fs.readFile(card, 'utf8')).toBe('valuable progress');
    },
  );

  it('preserves activated receipts even if a stale transaction marker remains', async () => {
    const { journal } = await ownedStage();
    const destination = path.join(root, release.version);
    await fs.mkdir(destination, { mode: 0o700 });
    await fs.writeFile(path.join(destination, marker), JSON.stringify(journal));
    await fs.writeFile(path.join(destination, 'receipt.json'), 'activated');
    await expect(installDolphin(release, root, run, download)).rejects.toThrow(
      'preserved',
    );
    expect(
      await fs.readFile(path.join(destination, 'receipt.json'), 'utf8'),
    ).toBe('activated');
  });

  it('preserves unexpected files inside an otherwise journaled reservation', async () => {
    const { journal } = await ownedStage();
    const destination = path.join(root, release.version);
    await fs.mkdir(destination, { mode: 0o700 });
    await fs.writeFile(path.join(destination, marker), JSON.stringify(journal));
    await fs.writeFile(path.join(destination, 'precious'), 'keep');
    await expect(installDolphin(release, root, run, download)).rejects.toThrow(
      'Unknown',
    );
    expect(await fs.readFile(path.join(destination, 'precious'), 'utf8')).toBe(
      'keep',
    );
  });

  it('detaches an owned orphan device left by an interrupted attach without a mount', async () => {
    const { staged } = await ownedStage();
    let orphan = true;
    const recoveringRun: ProcessRunner = async (binary, args, input) => {
      if (binary.endsWith('hdiutil')) {
        if (args[0] === 'info' && orphan) return '<orphan/>';
        if (args[0] === 'detach' && args[1] === '/dev/disk42') {
          orphan = false;
          return '';
        }
      }
      if (input === '<orphan/>')
        return JSON.stringify({
          images: [
            {
              'image-path': path.join(staged, 'download.dmg'),
              'system-entities': [{ 'dev-entry': '/dev/disk42' }],
            },
          ],
        });
      return run(binary, args, input);
    };
    await installDolphin(release, root, recoveringRun, download);
    expect(orphan).toBe(false);
    await expect(fs.stat(staged)).rejects.toThrow();
  });

  it('preserves an owned image mounted outside its exact staging mount point', async () => {
    const { staged } = await ownedStage();
    const unexpectedRun: ProcessRunner = async (binary, args, input) => {
      if (binary.endsWith('hdiutil') && args[0] === 'info') return '<outside/>';
      if (input === '<outside/>')
        return JSON.stringify({
          images: [
            {
              'image-path': path.join(staged, 'download.dmg'),
              'system-entities': [{ 'mount-point': '/Volumes/Unexpected' }],
            },
          ],
        });
      return run(binary, args, input);
    };
    await expect(
      installDolphin(release, root, unexpectedRun, download),
    ).rejects.toThrow('Unexpected mount');
    expect(await fs.readFile(path.join(staged, marker), 'utf8')).toContain(
      'dolphin-install',
    );
    expect(download).not.toHaveBeenCalled();
  });

  it('rejects an oversized mount inventory without deleting owned staging', async () => {
    const { staged } = await ownedStage();
    const oversizedRun: ProcessRunner = async (binary, args, input) => {
      if (binary.endsWith('hdiutil') && args[0] === 'info')
        return 'x'.repeat(1024 * 1024 + 1);
      return run(binary, args, input);
    };
    await expect(
      installDolphin(release, root, oversizedRun, download),
    ).rejects.toThrow('too large');
    expect(await fs.readFile(path.join(staged, marker), 'utf8')).toContain(
      'dolphin-install',
    );
  });

  it('preserves staging if mount inventory cannot prove it is unmounted', async () => {
    const { staged } = await ownedStage();
    inventoryFails = true;
    await expect(installDolphin(release, root, run, download)).rejects.toThrow(
      'Inventory unavailable',
    );
    expect(await fs.readFile(path.join(staged, marker), 'utf8')).toContain(
      'dolphin-install',
    );
    expect(download).not.toHaveBeenCalled();
  });

  it('refuses cleanup when the inventory shows an unexpected nested mount', async () => {
    unexpectedMount = true;
    await expect(installDolphin(release, root, run, download)).rejects.toThrow(
      'Unexpected mount',
    );
    expect(mounts).toHaveLength(1);
    expect(
      await fs.readFile(
        path.join(path.dirname(mounts[0]), 'Dolphin.app/data'),
        'utf8',
      ),
    ).toBe('fixture');
    await expect(fs.stat(path.join(root, release.version))).rejects.toThrow();
  });
});
