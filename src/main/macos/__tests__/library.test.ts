/** @jest-environment node */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { readLibrary, selectLibrary } from '../library';

describe('library persistence preserves user data', () => {
  let root: string;
  let statePath: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'emulation-library-test-'));
    root = await fs.realpath(root);
    statePath = path.join(root, 'state', 'library.json');
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('round trips Unicode and spaces without changing games or saves', async () => {
    const library = path.join(root, 'ألعاب Library');
    await fs.mkdir(library);
    await fs.writeFile(path.join(library, 'save.dat'), 'valuable progress');
    expect(await selectLibrary(statePath, library)).toEqual({
      path: library,
      available: true,
    });
    expect(await readLibrary(statePath)).toEqual({
      path: library,
      available: true,
    });
    expect(await fs.readdir(library)).toEqual(['save.dat']);
    expect(await fs.readFile(path.join(library, 'save.dat'), 'utf8')).toBe(
      'valuable progress',
    );
  });

  it('retains an unavailable drive instead of resetting its library', async () => {
    const library = path.join(root, 'external');
    await fs.mkdir(library);
    await selectLibrary(statePath, library);
    await fs.rename(library, `${library}-disconnected`);
    expect(await readLibrary(statePath)).toEqual({
      path: library,
      available: false,
    });
  });

  it('refuses to overwrite an unknown state file', async () => {
    await fs.mkdir(path.dirname(statePath));
    await fs.writeFile(statePath, '{"important":"unknown state"}');
    await expect(selectLibrary(statePath, root)).rejects.toThrow(
      'unsupported format',
    );
    expect(await fs.readFile(statePath, 'utf8')).toBe(
      '{"important":"unknown state"}',
    );
  });

  it('refuses a symlink at the settings destination', async () => {
    await fs.mkdir(path.dirname(statePath));
    const precious = path.join(root, 'precious');
    await fs.writeFile(precious, 'save');
    await fs.symlink(precious, statePath);
    await expect(selectLibrary(statePath, root)).rejects.toThrow(
      'regular file',
    );
    expect(await fs.readFile(precious, 'utf8')).toBe('save');
  });

  it('rejects relative paths and files', async () => {
    await expect(selectLibrary(statePath, '../library')).rejects.toThrow(
      'absolute',
    );
    const file = path.join(root, 'game.rom');
    await fs.writeFile(file, 'test');
    await expect(selectLibrary(statePath, file)).rejects.toThrow('folder');
    expect(await readLibrary(statePath)).toBeNull();
  });
});
