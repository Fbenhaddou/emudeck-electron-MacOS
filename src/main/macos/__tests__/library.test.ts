/** @jest-environment node */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { readLibrary, selectLibrary, recoverLibrarySettings } from '../library';

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

  it('does not adopt a different folder recreated at an old volume path', async () => {
    const library = path.join(root, 'external');
    await fs.mkdir(library);
    await selectLibrary(statePath, library);
    await fs.rename(library, `${library}-original`);
    await fs.mkdir(library);
    expect(await readLibrary(statePath)).toEqual({
      path: library,
      available: false,
    });
    expect(await fs.readdir(library)).toEqual([]);
    await selectLibrary(statePath, library);
    expect((await readLibrary(statePath))?.available).toBe(true);
  });

  it('rejects a saved folder replaced by a symlink even when the target is the original folder', async () => {
    const library = path.join(root, 'external');
    await fs.mkdir(library);
    await selectLibrary(statePath, library);
    await fs.rename(library, `${library}-original`);
    await fs.symlink(`${library}-original`, library);
    expect((await readLibrary(statePath))?.available).toBe(false);
  });

  it('keeps older path-only state but requires explicit selection to establish drive identity', async () => {
    await fs.mkdir(path.dirname(statePath));
    await fs.writeFile(
      statePath,
      JSON.stringify({
        format: 'emulation-workspace-library',
        version: 1,
        path: root,
      }),
    );
    expect((await readLibrary(statePath))?.available).toBe(false);
    await selectLibrary(statePath, root);
    expect((await readLibrary(statePath))?.available).toBe(true);
  });

  it.each([
    null,
    { device: 1, inode: '1' },
    { device: '1' },
    { device: '../', inode: '1' },
  ])('preserves malformed identity settings: %s', async (identity) => {
    await fs.mkdir(path.dirname(statePath));
    const data = JSON.stringify({
      format: 'emulation-workspace-library',
      version: 1,
      path: root,
      identity,
    });
    await fs.writeFile(statePath, data);
    await expect(selectLibrary(statePath, root)).rejects.toThrow('unsupported');
    expect(await fs.readFile(statePath, 'utf8')).toBe(data);
  });

  it('explicitly recovers corrupt preferences while retaining all original bytes and library files', async () => {
    await fs.mkdir(path.dirname(statePath));
    const corrupt = '{bad-json with recoverable original path}';
    await fs.writeFile(statePath, corrupt);
    await fs.writeFile(path.join(root, 'save.dat'), 'valuable');
    const backup = await recoverLibrarySettings(statePath);
    expect(backup).toMatch(/library\.json\.backup-/);
    expect(await fs.readFile(backup, 'utf8')).toBe(corrupt);
    expect(await readLibrary(statePath)).toBeNull();
    await selectLibrary(statePath, root);
    expect((await readLibrary(statePath))?.available).toBe(true);
    expect(await fs.readFile(path.join(root, 'save.dat'), 'utf8')).toBe(
      'valuable',
    );
  });

  it('refuses recovery of valid preferences and symlinked settings', async () => {
    await selectLibrary(statePath, root);
    const original = await fs.readFile(statePath, 'utf8');
    await expect(recoverLibrarySettings(statePath)).rejects.toThrow('valid');
    expect(await fs.readFile(statePath, 'utf8')).toBe(original);
    await fs.rename(statePath, `${statePath}.original`);
    await fs.symlink(`${statePath}.original`, statePath);
    await expect(recoverLibrarySettings(statePath)).rejects.toThrow('regular');
    expect(await fs.readFile(`${statePath}.original`, 'utf8')).toBe(original);
  });
});
