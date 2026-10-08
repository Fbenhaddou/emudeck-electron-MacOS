/** @jest-environment node */
import { createHash } from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  listSnapshots,
  recoverInterrupted,
  restoreSnapshot,
  snapshotRoot,
  takeSnapshot,
  verifySnapshot,
} from '../snapshots';
import type { SnapshotSource } from '../snapshots';

// Synthetic save bytes only.
let root: string;
let library: string;
let source: SnapshotSource;
const saves = () => source.folders.saves;
const states = () => source.folders.states;

async function tree(folder: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const visit = async (directory: string, prefix: string) => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    // eslint-disable-next-line no-restricted-syntax
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = `${prefix}${entry.name}`;
      // eslint-disable-next-line no-await-in-loop
      if (entry.isDirectory()) await visit(absolute, `${relative}/`);
      else
        result[relative] = createHash('sha256')
          // eslint-disable-next-line no-await-in-loop
          .update(Uint8Array.from(await fs.readFile(absolute)))
          .digest('hex');
    }
  };
  await visit(folder, '');
  return result;
}

beforeEach(async () => {
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'snapshots-')),
  );
  library = path.join(root, 'Library — مكتبة');
  const user = path.join(library, 'emulators', 'dolphin', 'User');
  source = {
    emulator: 'dolphin',
    folders: {
      saves: path.join(user, 'GC'),
      states: path.join(user, 'StateSaves'),
    },
  };
  await fs.mkdir(path.join(saves(), 'USA', 'Card A'), { recursive: true });
  await fs.mkdir(states(), { recursive: true });
  await fs.writeFile(
    path.join(saves(), 'USA', 'Card A', '01-GXXE-Save.gci'),
    new Uint8Array(8192).fill(7),
  );
  await fs.writeFile(path.join(saves(), 'MemoryCardA.USA.raw'), 'card');
  await fs.writeFile(
    path.join(states(), 'GXXE01.s01'),
    new Uint8Array(4096).fill(3),
  );
});

afterEach(() => fs.rm(root, { recursive: true, force: true }));

describe('save snapshots', () => {
  it('copies every save byte for byte with a verified manifest', async () => {
    const snapshot = await takeSnapshot(library, source, 'manual');
    expect(snapshot).toMatchObject({
      emulator: 'dolphin',
      reason: 'manual',
      files: 3,
      bytes: 8192 + 4 + 4096,
    });
    const directory = path.join(snapshotRoot(library, 'dolphin'), snapshot!.id);
    expect(await tree(path.join(directory, 'saves'))).toEqual(
      await tree(saves()),
    );
    expect(await tree(path.join(directory, 'states'))).toEqual(
      await tree(states()),
    );
    await expect(
      verifySnapshot(library, 'dolphin', snapshot!.id),
    ).resolves.toMatchObject({ files: expect.any(Array) });
    expect(snapshotRoot(library, 'dolphin')).toBe(
      path.join(library, 'backups', 'saves', 'dolphin'),
    );
  });

  it('never follows links out of a save folder', async () => {
    const secret = path.join(root, 'secret.txt');
    await fs.writeFile(secret, 'private');
    await fs.symlink(secret, path.join(saves(), 'link.gci'));
    await fs.symlink(root, path.join(saves(), 'link-folder'));
    const snapshot = await takeSnapshot(library, source, 'manual');
    expect(snapshot!.files).toBe(3);
  });

  it('refuses a save folder that is itself a link', async () => {
    await fs.rename(states(), path.join(root, 'elsewhere'));
    await fs.symlink(path.join(root, 'elsewhere'), states());
    await expect(takeSnapshot(library, source, 'manual')).rejects.toThrow(
      'not a real folder',
    );
  });

  it('takes nothing when there are no saves', async () => {
    await fs.rm(path.join(library, 'emulators'), { recursive: true });
    await expect(takeSnapshot(library, source, 'daily')).resolves.toBeNull();
    await expect(listSnapshots(library, 'dolphin')).resolves.toEqual([]);
  });

  it('takes a daily snapshot only after a day and a change', async () => {
    const start = new Date('2026-10-01T10:00:00.000Z');
    expect(await takeSnapshot(library, source, 'daily', start)).not.toBeNull();
    const later = new Date('2026-10-01T20:00:00.000Z');
    expect(await takeSnapshot(library, source, 'daily', later)).toBeNull();
    const nextDay = new Date('2026-10-02T11:00:00.000Z');
    expect(await takeSnapshot(library, source, 'daily', nextDay)).toBeNull();
    await fs.writeFile(path.join(states(), 'GXXE01.s02'), 'new state');
    expect(await takeSnapshot(library, source, 'daily', nextDay)).toMatchObject(
      { files: 4 },
    );
  });

  it('keeps 30 snapshots of changed saves and removes only its own', async () => {
    const userFile = path.join(snapshotRoot(library, 'dolphin'), 'notes.txt');
    // eslint-disable-next-line no-restricted-syntax
    for (let day = 0; day < 32; day += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(path.join(states(), 'GXXE01.s01'), `day ${day}`);
      // eslint-disable-next-line no-await-in-loop
      await takeSnapshot(
        library,
        source,
        'manual',
        new Date(Date.UTC(2026, 8, 1 + day)),
      );
      // eslint-disable-next-line no-await-in-loop
      if (day === 0) await fs.writeFile(userFile, 'mine');
    }
    const list = await listSnapshots(library, 'dolphin');
    expect(list).toHaveLength(30);
    expect(list[0].created).toBe('2026-10-02T00:00:00.000Z');
    await expect(fs.readFile(userFile, 'utf8')).resolves.toBe('mine');
  });

  it('never copies unchanged saves again, so repeated clicks cannot evict older saves', async () => {
    const first = await takeSnapshot(library, source, 'daily');
    // eslint-disable-next-line no-restricted-syntax
    for (let click = 0; click < 40; click += 1)
      // eslint-disable-next-line no-await-in-loop
      expect(await takeSnapshot(library, source, 'manual')).toEqual(first);
    await expect(listSnapshots(library, 'dolphin')).resolves.toHaveLength(1);
  });

  it('orders by sequence, so a clock set back never prunes the newest backup', async () => {
    // eslint-disable-next-line no-restricted-syntax
    for (let day = 0; day < 30; day += 1) {
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(path.join(states(), 'GXXE01.s01'), `day ${day}`);
      // eslint-disable-next-line no-await-in-loop
      await takeSnapshot(
        library,
        source,
        'manual',
        new Date(Date.UTC(2030, 0, 1 + day)),
      );
    }
    const [target] = (await listSnapshots(library, 'dolphin')).slice(-1);
    await fs.writeFile(path.join(states(), 'GXXE01.s01'), 'current progress');
    const current = await tree(states());
    // The clock now reads 2020: the before-restore snapshot must survive.
    const { before } = await restoreSnapshot(
      library,
      source,
      target.id,
      new Date('2020-01-01T00:00:00.000Z'),
    );
    const list = await listSnapshots(library, 'dolphin');
    expect(list[0].id).toBe(before!.id);
    const kept = path.join(snapshotRoot(library, 'dolphin'), before!.id);
    expect(await tree(path.join(kept, 'states'))).toEqual(current);
    // A changed save with a clock behind the newest backup still gets a daily backup.
    await fs.writeFile(path.join(saves(), 'new.gci'), 'x');
    expect(
      await takeSnapshot(
        library,
        source,
        'daily',
        new Date('2019-01-01T00:00:00.000Z'),
      ),
    ).not.toBeNull();
  });

  it('restores a corrupted save byte for byte and keeps the corrupted copy', async () => {
    const original = {
      saves: await tree(saves()),
      states: await tree(states()),
    };
    const snapshot = await takeSnapshot(
      library,
      source,
      'before-reset',
      new Date('2026-10-01T10:00:00.000Z'),
    );
    // Corrupt one save, delete a state, add a file the snapshot never had.
    await fs.writeFile(
      path.join(saves(), 'USA', 'Card A', '01-GXXE-Save.gci'),
      'garbage',
    );
    await fs.rm(path.join(states(), 'GXXE01.s01'));
    await fs.writeFile(path.join(states(), 'newer.s02'), 'played since');
    const corrupted = await tree(states());

    const { before } = await restoreSnapshot(
      library,
      source,
      snapshot!.id,
      new Date('2026-10-01T11:00:00.000Z'),
    );
    expect(await tree(saves())).toEqual(original.saves);
    expect(await tree(states())).toEqual(original.states);
    // Nothing was deleted: the replaced files are a sealed snapshot.
    expect(before).toMatchObject({ reason: 'before-restore', files: 3 });
    const kept = path.join(snapshotRoot(library, 'dolphin'), before!.id);
    expect(await tree(path.join(kept, 'states'))).toEqual(corrupted);
    await expect(
      verifySnapshot(library, 'dolphin', before!.id),
    ).resolves.toBeDefined();
    // No staging folders are left beside the live saves.
    const siblings = await fs.readdir(path.dirname(saves()));
    expect(siblings.filter((name) => name.includes('restoring'))).toEqual([]);
  });

  it('refuses a damaged snapshot and leaves the live saves untouched', async () => {
    const snapshot = await takeSnapshot(library, source, 'manual');
    await fs.writeFile(
      path.join(
        snapshotRoot(library, 'dolphin'),
        snapshot!.id,
        'states',
        'GXXE01.s01',
      ),
      'tampered',
    );
    await fs.writeFile(path.join(states(), 'GXXE01.s01'), 'current');
    const before = await tree(path.dirname(saves()));
    await expect(
      restoreSnapshot(library, source, snapshot!.id),
    ).rejects.toThrow('damaged');
    expect(await tree(path.dirname(saves()))).toEqual(before);
  });

  it.each(['../dolphin', '2026-10-01T10-00-00-000Z-manual/../../x', ''])(
    'refuses a snapshot id that is not its own: %p',
    async (id) => {
      await expect(restoreSnapshot(library, source, id)).rejects.toThrow(
        'Unknown snapshot',
      );
    },
  );

  it('rolls back every folder when sealing the restore fails (full or unplugged drive)', async () => {
    const snapshot = await takeSnapshot(library, source, 'manual');
    await fs.writeFile(path.join(states(), 'GXXE01.s01'), 'newer progress');
    const before = await tree(path.dirname(saves()));
    const open = fs.open.bind(fs);
    const spy = jest
      .spyOn(fs, 'open')
      .mockImplementation(async (file, ...rest) => {
        if (String(file).includes('before-restore.partial/manifest.json'))
          throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
        return open(file as string, ...(rest as [string]));
      });
    await expect(
      restoreSnapshot(library, source, snapshot!.id),
    ).rejects.toThrow('ENOSPC');
    spy.mockRestore();
    expect(await tree(path.dirname(saves()))).toEqual(before);
    const leftovers = await fs.readdir(snapshotRoot(library, 'dolphin'));
    expect(leftovers).toEqual([snapshot!.id]);
  });

  it('rolls back the first folder when the second swap fails', async () => {
    const snapshot = await takeSnapshot(library, source, 'manual');
    await fs.writeFile(path.join(saves(), 'MemoryCardA.USA.raw'), 'changed');
    const before = await tree(path.dirname(saves()));
    const rename = fs.rename.bind(fs);
    const spy = jest
      .spyOn(fs, 'rename')
      .mockImplementation(async (from, to) => {
        if (String(from).includes('StateSaves.restoring-'))
          throw Object.assign(new Error('EIO'), { code: 'EIO' });
        return rename(from, to);
      });
    await expect(
      restoreSnapshot(library, source, snapshot!.id),
    ).rejects.toThrow('EIO');
    spy.mockRestore();
    expect(await tree(path.dirname(saves()))).toEqual(before);
  });

  it('after a crash mid-restore, puts the original saves back and keeps what was live', async () => {
    const snapshot = await takeSnapshot(library, source, 'manual');
    await fs.writeFile(
      path.join(saves(), 'MemoryCardA.USA.raw'),
      'original now',
    );
    const original = await tree(path.dirname(saves()));
    // Simulate a crash right after the swaps: journal written, originals moved.
    const root2 = snapshotRoot(library, 'dolphin');
    const partial = path.join(
      root2,
      '000009-2026-10-01T10-00-00-000Z-before-restore.partial',
    );
    await fs.mkdir(partial);
    await fs.writeFile(
      path.join(root2, 'restore-journal.json'),
      JSON.stringify({
        version: 1,
        partial,
        folders: [
          {
            name: 'saves',
            live: saves(),
            staging: `${saves()}.restoring-000009`,
            hadLive: true,
          },
          {
            name: 'states',
            live: states(),
            staging: `${states()}.restoring-000009`,
            hadLive: true,
          },
        ],
        exclude: [],
      }),
    );
    await fs.rename(saves(), path.join(partial, 'saves'));
    await fs.cp(path.join(root2, snapshot!.id, 'saves'), saves(), {
      recursive: true,
    });
    // An emulator opened from Finder wrote to the restored folder before recovery.
    await fs.writeFile(
      path.join(saves(), 'written-after-crash.gci'),
      'keep me',
    );
    await recoverInterrupted(library, source);
    expect(await tree(path.dirname(saves()))).toEqual(original);
    const list = await listSnapshots(library, 'dolphin');
    const interrupted = list.find((item) => item.reason === 'interrupted');
    expect(interrupted).toBeDefined();
    await expect(
      fs.readFile(
        path.join(root2, interrupted!.id, 'saves', 'written-after-crash.gci'),
        'utf8',
      ),
    ).resolves.toBe('keep me');
    await expect(
      fs.lstat(path.join(root2, 'restore-journal.json')),
    ).rejects.toThrow();
    expect(
      (await fs.readdir(root2)).some((name) => name.endsWith('.partial')),
    ).toBe(false);
  });

  it('removes staging copies left by a crash before the journal existed', async () => {
    await fs.mkdir(`${saves()}.restoring-000003`);
    await fs.writeFile(
      path.join(`${saves()}.restoring-000003`, 'copy.gci'),
      'x',
    );
    await fs.mkdir(`${saves()}.restoring-mine`);
    await recoverInterrupted(library, source);
    await expect(fs.lstat(`${saves()}.restoring-000003`)).rejects.toThrow();
    // Not this module's naming pattern: left alone.
    await expect(fs.lstat(`${saves()}.restoring-mine`)).resolves.toBeDefined();
  });

  it('never copies or swaps firmware kept beside the saves', async () => {
    const firmware = { ...source, exclude: ['saves/USA/IPL.bin'] };
    await fs.writeFile(path.join(saves(), 'USA', 'IPL.bin'), 'old ipl');
    const snapshot = await takeSnapshot(library, firmware, 'manual');
    expect(snapshot!.files).toBe(3);
    // The person imports a newer IPL, then restores an older backup.
    await fs.writeFile(path.join(saves(), 'USA', 'IPL.bin'), 'new ipl');
    await fs.writeFile(path.join(saves(), 'MemoryCardA.USA.raw'), 'changed');
    const { before } = await restoreSnapshot(library, firmware, snapshot!.id);
    await expect(
      fs.readFile(path.join(saves(), 'USA', 'IPL.bin'), 'utf8'),
    ).resolves.toBe('new ipl');
    await expect(
      fs.readFile(path.join(saves(), 'MemoryCardA.USA.raw'), 'utf8'),
    ).resolves.toBe('card');
    const kept = await tree(
      path.join(snapshotRoot(library, 'dolphin'), before!.id, 'saves'),
    );
    expect(Object.keys(kept)).not.toContain('USA/IPL.bin');
  });

  it('a rolled-back restore leaves no saves where there were none', async () => {
    const snapshot = await takeSnapshot(library, source, 'manual');
    await fs.rm(states(), { recursive: true });
    const before = await tree(path.dirname(saves()));
    const open = fs.open.bind(fs);
    const spy = jest
      .spyOn(fs, 'open')
      .mockImplementation(async (file, ...rest) => {
        if (String(file).includes('before-restore.partial/manifest.json'))
          throw new Error('EIO');
        return open(file as string, ...(rest as [string]));
      });
    await expect(
      restoreSnapshot(library, source, snapshot!.id),
    ).rejects.toThrow();
    spy.mockRestore();
    expect(await tree(path.dirname(saves()))).toEqual(before);
    await expect(fs.lstat(states())).rejects.toThrow();
  });
});
