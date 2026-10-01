import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  prepareDolphinLibrary,
  resetDolphinConfiguration,
  validateGame,
} from '../dolphin-library';
import { dolphin } from '../../components/dolphin';

let root: string;
beforeEach(async () => {
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'dolphin-library-')),
  );
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it('preserves memory cards, states and unknown configuration through reset', async () => {
  await prepareDolphinLibrary(root);
  const p = dolphin.paths(root);
  await fs.writeFile(path.join(p.saves, 'card.raw'), 'valuable save');
  await fs.writeFile(path.join(p.states, 'state.sav'), 'valuable state');
  await fs.writeFile(path.join(p.configuration, 'custom.ini'), 'custom config');
  await resetDolphinConfiguration(root);
  expect(await fs.readFile(path.join(p.saves, 'card.raw'), 'utf8')).toBe(
    'valuable save',
  );
  expect(await fs.readFile(path.join(p.states, 'state.sav'), 'utf8')).toBe(
    'valuable state',
  );
  const backup = (await fs.readdir(p.user)).find((x) =>
    x.startsWith('Config.backup-'),
  )!;
  expect(
    await fs.readFile(path.join(p.user, backup, 'custom.ini'), 'utf8'),
  ).toBe('custom config');
});
it('refuses symlink ancestors before creating configuration', async () => {
  const outside = path.join(root, 'outside');
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(root, 'emulators'));
  await expect(prepareDolphinLibrary(root)).rejects.toThrow('real folder');
  expect(await fs.readdir(outside)).toEqual([]);
});
it('does not overwrite existing configuration', async () => {
  await prepareDolphinLibrary(root);
  const config = path.join(dolphin.paths(root).configuration, 'Dolphin.ini');
  await fs.writeFile(config, 'my settings');
  await prepareDolphinLibrary(root);
  expect(await fs.readFile(config, 'utf8')).toBe('my settings');
});
it('validates a real supported game and rejects a symlink to external content', async () => {
  await prepareDolphinLibrary(root);
  const p = dolphin.paths(root);
  const file = path.join(p.roms, 'Homebrew & ألعاب.dol');
  await fs.writeFile(file, 'fixture');
  expect(await validateGame(root, file)).toBe(file);
  const outside = path.join(root, 'outside.dol');
  await fs.writeFile(outside, 'private');
  const link = path.join(p.roms, 'link.dol');
  await fs.symlink(outside, link);
  await expect(validateGame(root, link)).rejects.toThrow('supported');
});

it('serializes concurrent resets and preparation without losing original settings', async () => {
  await prepareDolphinLibrary(root);
  const p = dolphin.paths(root);
  await fs.writeFile(path.join(p.configuration, 'custom.ini'), 'original');
  const [first, second] = await Promise.all([
    resetDolphinConfiguration(root),
    resetDolphinConfiguration(root),
    prepareDolphinLibrary(root),
  ]);
  expect(first.backupPath).not.toBe(second.backupPath);
  expect(
    await fs.readFile(path.join(first.backupPath, 'custom.ini'), 'utf8'),
  ).toBe('original');
  expect(
    await fs.readFile(path.join(p.configuration, 'Dolphin.ini'), 'utf8'),
  ).toContain('GFXBackend = Metal');
});

it('preserves partial replacement and original backup when writing defaults fails', async () => {
  await prepareDolphinLibrary(root);
  const p = dolphin.paths(root);
  await fs.writeFile(path.join(p.saves, 'card.raw'), 'progress');
  await fs.writeFile(path.join(p.configuration, 'custom.ini'), 'original');
  const original = fs.writeFile.bind(fs);
  let defaultsWrites = 0;
  const spy = jest
    .spyOn(fs, 'writeFile')
    .mockImplementation(async (...args) => {
      if (args[0] === path.join(p.configuration, 'Dolphin.ini')) {
        defaultsWrites += 1;
        if (defaultsWrites === 2) {
          await original(
            path.join(p.configuration, 'partial.ini'),
            'do not delete',
          );
          throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
        }
      }
      return original(...args);
    });
  let failure: any;
  try {
    await resetDolphinConfiguration(root);
  } catch (error) {
    failure = error;
  } finally {
    spy.mockRestore();
  }
  expect(failure.restored).toBe(false);
  expect(
    await fs.readFile(path.join(failure.backupPath, 'custom.ini'), 'utf8'),
  ).toBe('original');
  expect(
    await fs.readFile(path.join(p.configuration, 'partial.ini'), 'utf8'),
  ).toBe('do not delete');
  expect(await fs.readFile(path.join(p.saves, 'card.raw'), 'utf8')).toBe(
    'progress',
  );
  await expect(prepareDolphinLibrary(root)).resolves.toBeUndefined();
});

it('restores the original when creating the new Config directory fails', async () => {
  await prepareDolphinLibrary(root);
  const p = dolphin.paths(root);
  await fs.writeFile(path.join(p.configuration, 'custom.ini'), 'original');
  const original = fs.mkdir.bind(fs);
  let configCalls = 0;
  const spy = jest.spyOn(fs, 'mkdir').mockImplementation((...args: any[]) => {
    if (args[0] === p.configuration) configCalls += 1;
    if (args[0] === p.configuration && configCalls === 2)
      return Promise.reject(
        Object.assign(new Error('unwritable'), { code: 'EACCES' }),
      );
    return (original as any)(...args);
  });
  try {
    await expect(resetDolphinConfiguration(root)).rejects.toMatchObject({
      restored: true,
      backupPath: p.configuration,
    });
  } finally {
    spy.mockRestore();
  }
  expect(
    await fs.readFile(path.join(p.configuration, 'custom.ini'), 'utf8'),
  ).toBe('original');
});

it('leaves original and saves intact if backup rename fails', async () => {
  await prepareDolphinLibrary(root);
  const p = dolphin.paths(root);
  await fs.writeFile(path.join(p.configuration, 'custom.ini'), 'original');
  await fs.writeFile(path.join(p.states, 'state.sav'), 'state');
  const spy = jest
    .spyOn(fs, 'rename')
    .mockRejectedValueOnce(new Error('rename denied'));
  try {
    await expect(resetDolphinConfiguration(root)).rejects.toThrow(
      'rename denied',
    );
  } finally {
    spy.mockRestore();
  }
  expect(
    await fs.readFile(path.join(p.configuration, 'custom.ini'), 'utf8'),
  ).toBe('original');
  expect(await fs.readFile(path.join(p.states, 'state.sav'), 'utf8')).toBe(
    'state',
  );
});

it('reports a preserved backup when restoration also fails', async () => {
  await prepareDolphinLibrary(root);
  const p = dolphin.paths(root);
  await fs.writeFile(path.join(p.configuration, 'custom.ini'), 'original');
  const mkdir = fs.mkdir.bind(fs);
  const rename = fs.rename.bind(fs);
  let configCalls = 0;
  const mkdirSpy = jest
    .spyOn(fs, 'mkdir')
    .mockImplementation((...args: any[]) => {
      if (args[0] === p.configuration) configCalls += 1;
      if (args[0] === p.configuration && configCalls === 2)
        return Promise.reject(new Error('creation failed'));
      return (mkdir as any)(...args);
    });
  const renameSpy = jest
    .spyOn(fs, 'rename')
    .mockImplementation(async (from, to) => {
      if (to === p.configuration) throw new Error('restoration failed');
      return rename(from, to);
    });
  let failure: any;
  try {
    await resetDolphinConfiguration(root);
  } catch (error) {
    failure = error;
  } finally {
    mkdirSpy.mockRestore();
    renameSpy.mockRestore();
  }
  expect(failure.restored).toBe(false);
  expect(
    await fs.readFile(path.join(failure.backupPath, 'custom.ini'), 'utf8'),
  ).toBe('original');
});
