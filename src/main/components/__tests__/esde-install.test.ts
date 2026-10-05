/** @jest-environment node */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  ESDE_RELEASE,
  installFrontend,
  installedFrontend,
  readLicense,
} from '../es-de/install';
import type { ProcessRunner } from '../dolphin/install';

const license =
  'Copyright (c) 2024-2026 Northwestern Software AB\rPermission is hereby granted';
const resources = '<plist resources/>';

describe('managed ES-DE installation', () => {
  let root: string;
  let mounts: string[];
  let calls: string[][];
  let attachInput: string | undefined;
  let run: ProcessRunner;
  const download = jest.fn(async (_artifact, destination: string) => {
    await fs.writeFile(destination, 'image');
    return { sha256: ESDE_RELEASE.artifact.sha256, bytes: 79383926 };
  });

  beforeEach(async () => {
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'esde-install-')),
    );
    await fs.chmod(root, 0o700);
    mounts = [];
    calls = [];
    attachInput = undefined;
    download.mockClear();
    run = jest.fn(async (binary, args, input) => {
      calls.push([path.basename(binary), ...args]);
      if (binary.endsWith('hdiutil')) {
        if (args[0] === 'udifderez') return resources;
        if (args[0] === 'info') return '<inventory/>';
        if (args[0] === 'detach') {
          mounts = mounts.filter((mount) => mount !== args[1]);
          return '';
        }
        attachInput = input;
        const mountPoint = args[args.indexOf('-mountpoint') + 1];
        mounts.push(mountPoint);
        await fs.mkdir(
          path.join(mountPoint, 'ES-DE.app', 'Contents', 'MacOS'),
          {
            recursive: true,
          },
        );
        // hdiutil prints the license before the property list.
        return `${license}\n<?xml version="1.0"?><plist/>`;
      }
      if (binary.endsWith('plutil')) {
        if (input === resources) {
          // Like real plutil: the resource list has <data>, so JSON is refused.
          if (args[0] !== '-extract')
            throw new Error('Invalid object in plist for JSON format');
          if (args[1] === 'TEXT.0.Name') return 'English\n';
          if (args[1] === 'TEXT.0.Data')
            return `${Buffer.from(license, 'latin1').toString('base64')}\n`;
          throw new Error('No value at that key path');
        }
        if (input === '<inventory/>')
          return JSON.stringify({
            images: mounts.map((mount) => ({
              'image-path': `${mount.split('/mount')[0]}/download.dmg`,
              'system-entities': [{ 'mount-point': mount }],
            })),
          });
        if (input?.startsWith('<?xml'))
          return JSON.stringify({
            'system-entities': [{ 'mount-point': mounts[mounts.length - 1] }],
          });
        return JSON.stringify({
          CFBundleIdentifier: '3.5.0',
          CFBundleExecutable: 'ES-DE',
          CFBundleShortVersionString: '3.5.0',
        });
      }
      if (binary.endsWith('lipo')) return 'arm64';
      if (binary.endsWith('ditto'))
        await fs.cp(args[0], args[1], {
          recursive: true,
          errorOnExist: true,
          force: false,
        });
      return '';
    });
  });
  afterEach(() => fs.rm(root, { recursive: true, force: true }));

  it('reads the image license with normalized line endings', async () => {
    await expect(readLicense('/x.dmg', run)).resolves.toBe(
      'Copyright (c) 2024-2026 Northwestern Software AB\nPermission is hereby granted',
    );
  });

  it('installs only after the user agrees to the exact license text', async () => {
    const acceptLicense = jest.fn(async () => true);
    const frontend = await installFrontend(root, {
      acceptLicense,
      run,
      download,
    });
    expect(acceptLicense).toHaveBeenCalledWith(
      expect.stringContaining('Permission is hereby granted'),
    );
    expect(attachInput).toBe('Y\n');
    expect(frontend.bundle).toBe(path.join(root, '3.5.0', 'ES-DE.app'));
    expect(frontend.executable).toBe(
      path.join(frontend.bundle, 'Contents', 'MacOS', 'ES-DE'),
    );
    expect(mounts).toEqual([]);
    expect(
      (await fs.readdir(root)).filter((name) => name.startsWith('.esde-stage')),
    ).toEqual([]);
    // Publisher requirement pins identifier and team.
    expect(calls).toContainEqual(
      expect.arrayContaining([
        `=anchor apple generic and identifier "3.5.0" and certificate leaf[subject.OU] = "K56UAA4SXL"`,
      ]),
    );
    await expect(installedFrontend(root, run)).resolves.toEqual(frontend);
  });

  it('never mounts or answers the prompt when the license is declined', async () => {
    await expect(
      installFrontend(root, {
        acceptLicense: async () => false,
        run,
        download,
      }),
    ).rejects.toThrow('license was declined');
    expect(calls.some((call) => call[1] === 'attach')).toBe(false);
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('refuses a bundle with the wrong identity and leaves no installation', async () => {
    const original = run;
    run = jest.fn(async (binary, args, input) => {
      if (binary.endsWith('lipo')) return 'x86_64';
      return original(binary, args, input);
    });
    await expect(
      installFrontend(root, { acceptLicense: async () => true, run, download }),
    ).rejects.toThrow('native Apple Silicon');
    expect(mounts).toEqual([]);
    await expect(installedFrontend(root, run)).resolves.toBeNull();
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('preserves an unknown partial installation directory', async () => {
    await fs.mkdir(path.join(root, '3.5.0'));
    await fs.writeFile(path.join(root, '3.5.0', 'user-file'), 'keep');
    await expect(
      installFrontend(root, { acceptLicense: async () => true, run, download }),
    ).rejects.toThrow('preserved');
    expect(
      await fs.readFile(path.join(root, '3.5.0', 'user-file'), 'utf8'),
    ).toBe('keep');
    expect(download).not.toHaveBeenCalled();
  });

  it('cleans only its own marked stages from an interrupted install', async () => {
    const ours = path.join(root, '.esde-stage-AAAAAA');
    await fs.mkdir(ours);
    await fs.writeFile(path.join(ours, '.emulation-workspace-esde-stage'), '');
    const unknown = path.join(root, '.esde-stage-BBBBBB');
    await fs.mkdir(unknown);
    await installFrontend(root, {
      acceptLicense: async () => true,
      run,
      download,
    });
    await expect(fs.lstat(ours)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(unknown)).resolves.toBeTruthy();
  });

  it('reuses a verified installation without downloading again', async () => {
    await installFrontend(root, {
      acceptLicense: async () => true,
      run,
      download,
    });
    const acceptLicense = jest.fn(async () => true);
    await installFrontend(root, { acceptLicense, run, download });
    expect(download).toHaveBeenCalledTimes(1);
    expect(acceptLicense).not.toHaveBeenCalled();
  });
});
