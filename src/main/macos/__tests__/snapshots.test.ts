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

  it('keeps the newest 30 and removes only its own older snapshots', async () => {
    const userFile = path.join(snapshotRoot(library, 'dolphin'), 'notes.txt');
    // eslint-disable-next-line no-restricted-syntax
    for (let day = 0; day < 32; day += 1) {
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

  it('puts saves back after a restore interrupted between the two moves', async () => {
    const root2 = snapshotRoot(library, 'dolphin');
    const partial = path.join(
      root2,
      '2026-10-01T10-00-00-000Z-before-restore.partial',
    );
    await fs.mkdir(partial, { recursive: true });
    const original = await tree(saves());
    await fs.rename(saves(), path.join(partial, 'saves'));
    await recoverInterrupted(library, source);
    expect(await tree(saves())).toEqual(original);
  });
});
