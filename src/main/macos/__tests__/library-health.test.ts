/** @jest-environment node */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { dolphin } from '../../components/dolphin';
import { ppsspp } from '../../components/ppsspp';
import { checkLibrary, moveToSystem } from '../library-health';

// Synthetic bytes only; no real games.
let root: string;
let library: string;
const gc = () => path.join(library, 'roms', 'gc');
const psp = () => path.join(library, 'roms', 'psp');

async function write(file: string, contents: string | Uint8Array = 'game') {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
}

beforeEach(async () => {
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'library-health-')),
  );
  library = path.join(root, 'Library — مكتبة');
  await write(path.join(gc(), 'Good Game.rvz'), 'cube');
  await write(path.join(psp(), 'Good PSP.cso'), 'pocket');
});

afterEach(() => fs.rm(root, { recursive: true, force: true }));

describe('library health check', () => {
  it('reports nothing for a tidy library', async () => {
    await write(path.join(gc(), 'Good Game.txt'), 'notes');
    await expect(checkLibrary(library, [dolphin, ppsspp])).resolves.toEqual({
      checked: 3,
      issues: [],
      truncated: false,
    });
  });

  it('finds every kind of problem without changing anything', async () => {
    await write(path.join(gc(), 'Pocket Game.cso'), 'psp in gc');
    await write(path.join(gc(), 'Mystery.xyz'), 'what is this');
    await write(path.join(gc(), 'Empty.rvz'), '');
    await write(path.join(gc(), 'Copy of Good Game.rvz'), 'cube');
    await write(path.join(gc(), '._Good Game.rvz'), 'apple double');
    await fs.symlink(
      path.join(gc(), 'Good Game.rvz'),
      path.join(gc(), 'Linked.rvz'),
    );
    await write(path.join(psp(), 'Saga (Disc 1).iso'), 'one');
    await write(path.join(psp(), 'Saga (Disc 2).iso'), 'two');
    await write(path.join(library, 'roms', 'Loose.pbp'), 'loose');
    const before = await fs.readdir(gc());
    const report = await checkLibrary(library, [dolphin, ppsspp]);
    const kinds = report.issues.map((issue) => [issue.kind, issue.path]);
    expect(kinds).toEqual(
      expect.arrayContaining([
        ['wrong-system', 'roms/gc/Pocket Game.cso'],
        ['unsupported', 'roms/gc/Mystery.xyz'],
        ['empty', 'roms/gc/Empty.rvz'],
        ['apple-double', 'roms/gc/._Good Game.rvz'],
        ['link', 'roms/gc/Linked.rvz'],
        ['multi-disc', 'roms/psp/Saga (Disc 1).iso'],
        ['outside-system', 'roms/Loose.pbp'],
        ['duplicate', 'roms/gc/Good Game.rvz'],
      ]),
    );
    expect(report.issues).toHaveLength(8);
    expect(
      report.issues.find((issue) => issue.kind === 'wrong-system')?.target,
    ).toBe('psp');
    expect(
      report.issues.find((issue) => issue.kind === 'duplicate')?.other,
    ).toBe('roms/gc/Copy of Good Game.rvz');
    expect(await fs.readdir(gc())).toEqual(before);
  });

  it('accepts a multi-disc set that has a playlist', async () => {
    await write(path.join(psp(), 'Saga (Disc 1).iso'), 'one');
    await write(path.join(psp(), 'Saga (Disc 2).iso'), 'two');
    await write(path.join(psp(), 'Saga.m3u'), 'Saga (Disc 1).iso\n');
    const report = await checkLibrary(library, [dolphin, ppsspp]);
    expect(report.issues).toEqual([]);
  });

  it('does not call a format both systems play misplaced', async () => {
    // .iso and .elf are GameCube and PSP formats alike: ambiguous, not wrong.
    await write(path.join(gc(), 'Either.iso'), 'iso');
    const report = await checkLibrary(library, [dolphin, ppsspp]);
    expect(report.issues).toEqual([]);
  });

  it('flags incomplete game folders, but not update folders, for folder-game systems', async () => {
    const folderSystem = {
      ...ppsspp,
      manifest: {
        ...ppsspp.manifest,
        folderGame: {
          markers: ['eboot.bin'],
          launchTarget: 'eboot.bin',
          companionSuffixes: ['-UPDATE'],
        },
      },
    };
    await write(path.join(psp(), 'CUSA00001', 'eboot.bin'), 'elf');
    await write(path.join(psp(), 'CUSA00001-UPDATE', 'eboot.bin'), 'elf');
    await fs.mkdir(path.join(psp(), 'Half Copied'));
    const report = await checkLibrary(library, [dolphin, folderSystem]);
    expect(report.issues.map((issue) => [issue.kind, issue.path])).toEqual([
      ['incomplete-folder', 'roms/psp/Half Copied'],
    ]);
  });
});

describe('moving a misplaced game', () => {
  it('moves it into the right system folder', async () => {
    await write(path.join(gc(), 'Pocket Game.cso'), 'psp in gc');
    await expect(
      moveToSystem(library, 'roms/gc/Pocket Game.cso', ppsspp),
    ).resolves.toBe('roms/psp/Pocket Game.cso');
    await expect(
      fs.readFile(path.join(psp(), 'Pocket Game.cso'), 'utf8'),
    ).resolves.toBe('psp in gc');
    await expect(
      fs.lstat(path.join(gc(), 'Pocket Game.cso')),
    ).rejects.toThrow();
  });

  it('never overwrites a game that is already there', async () => {
    await write(path.join(gc(), 'Good PSP.cso'), 'the misplaced copy');
    await expect(
      moveToSystem(library, 'roms/gc/Good PSP.cso', ppsspp),
    ).rejects.toThrow('already there');
    await expect(
      fs.readFile(path.join(psp(), 'Good PSP.cso'), 'utf8'),
    ).resolves.toBe('pocket');
    await expect(
      fs.readFile(path.join(gc(), 'Good PSP.cso'), 'utf8'),
    ).resolves.toBe('the misplaced copy');
  });

  it.each([
    '../outside.cso',
    'roms/../../outside.cso',
    'emulators/dolphin/User/GC/card.raw',
    'roms/gc/missing.cso',
    'roms/gc',
  ])('refuses %p', async (where) => {
    await write(path.join(root, 'outside.cso'), 'outside');
    await expect(moveToSystem(library, where, ppsspp)).rejects.toThrow();
    await expect(
      fs.readFile(path.join(root, 'outside.cso'), 'utf8'),
    ).resolves.toBe('outside');
  });

  it('refuses a link', async () => {
    await write(path.join(root, 'outside.cso'), 'outside');
    await fs.symlink(
      path.join(root, 'outside.cso'),
      path.join(gc(), 'Linked.cso'),
    );
    await expect(
      moveToSystem(library, 'roms/gc/Linked.cso', ppsspp),
    ).rejects.toThrow();
    await expect(fs.lstat(path.join(psp(), 'Linked.cso'))).rejects.toThrow();
  });
});
