/** @jest-environment node */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';
import { CRC32 } from '../../components/shared/crc32';
import { dolphin } from '../../components/dolphin';
import { ppsspp } from '../../components/ppsspp';
import type {
  ComponentAdapter,
  FirmwareRequirement,
} from '../../components/types';
import {
  firmwareStatus,
  importFirmware,
  validateRequirement,
} from '../firmware';

// Synthetic stand-in: no proprietary firmware is ever used or stored in tests.
const good = Uint8Array.from(randomBytes(4096));
const goodCRC = new CRC32().update(good).digest();
const requirement: FirmwareRequirement = {
  id: 'test-bios',
  system: 'gc',
  title: 'Test BIOS',
  purpose: 'Testing.',
  required: true,
  maxBytes: 8192,
  source: 'synthetic',
  knownDumps: [
    {
      label: 'Synthetic v1',
      crc32: goodCRC,
      destinations: ['emulators/x/USA/bios.bin', 'emulators/x/JAP/bios.bin'],
    },
  ],
};
const adapter = {
  ...dolphin,
  firmware: [requirement],
} as ComponentAdapter;

describe('firmware manager', () => {
  let root: string;
  let library: string;
  let source: string;
  beforeEach(async () => {
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'firmware-')),
    );
    library = path.join(root, 'Library — مكتبة');
    await fs.mkdir(library);
    source = path.join(root, 'my dump $(id).bin');
    await fs.writeFile(source, good);
  });
  afterEach(() => fs.rm(root, { recursive: true, force: true }));

  it('declares Dolphin’s IPL as optional with Redump values and none for PPSSPP', () => {
    expect(dolphin.firmware?.[0]).toMatchObject({
      id: 'gc-ipl',
      required: false,
    });
    expect(
      dolphin.firmware?.[0].knownDumps.map((dump) => dump.crc32),
    ).toContain('d235e3f9');
    dolphin.firmware?.forEach(validateRequirement);
    expect(ppsspp.firmware).toBeUndefined();
  });

  it('reports missing, then copies a recognized dump to every destination', async () => {
    await expect(firmwareStatus(library, [adapter])).resolves.toMatchObject([
      { id: 'test-bios', state: 'missing', required: true },
    ]);
    await expect(
      importFirmware(library, requirement, source),
    ).resolves.toMatchObject({
      label: 'Synthetic v1',
      written: ['emulators/x/USA/bios.bin', 'emulators/x/JAP/bios.bin'],
      backups: [],
    });
    const hex = Buffer.from(good).toString('hex');
    expect(
      (
        await fs.readFile(path.join(library, 'emulators/x/JAP/bios.bin'))
      ).toString('hex'),
    ).toBe(hex);
    // The user's original is untouched.
    expect((await fs.readFile(source)).toString('hex')).toBe(hex);
    await expect(firmwareStatus(library, [adapter])).resolves.toMatchObject([
      { state: 'recognized', detail: 'Synthetic v1' },
    ]);
  });

  it('refuses an unknown dump and copies nothing', async () => {
    await fs.writeFile(source, Uint8Array.from(randomBytes(4096)));
    await expect(importFirmware(library, requirement, source)).rejects.toThrow(
      'not a known good',
    );
    await expect(
      fs.lstat(path.join(library, 'emulators')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses oversized files, folders and aliases', async () => {
    await fs.writeFile(source, Uint8Array.from(randomBytes(9000)));
    await expect(importFirmware(library, requirement, source)).rejects.toThrow(
      'right size',
    );
    const link = path.join(path.dirname(source), 'link.bin');
    await fs.symlink(source, link);
    await expect(importFirmware(library, requirement, link)).rejects.toThrow(
      'regular file',
    );
  });

  it('keeps a different existing file as a dated backup', async () => {
    const target = path.join(library, 'emulators/x/USA/bios.bin');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'someone else’s file');
    const result = await importFirmware(
      library,
      requirement,
      source,
      new Date('2026-10-07T12:00:00Z'),
    );
    expect(result.backups).toEqual([
      'emulators/x/USA/bios.bin.before-2026-10-07T12-00-00-000Z',
    ]);
    expect(
      await fs.readFile(path.join(library, result.backups[0]), 'utf8'),
    ).toBe('someone else’s file');
  });

  it('reports an unrecognized file without changing it', async () => {
    const target = path.join(library, 'emulators/x/USA/bios.bin');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'not a bios');
    await expect(firmwareStatus(library, [adapter])).resolves.toMatchObject([
      { state: 'unrecognized', detail: null },
    ]);
    expect(await fs.readFile(target, 'utf8')).toBe('not a bios');
  });

  it('refuses a destination symlinked out of the library', async () => {
    const outside = await fs.mkdtemp(path.join(root, 'outside-'));
    await fs.mkdir(path.join(library, 'emulators'));
    await fs.symlink(outside, path.join(library, 'emulators', 'x'));
    await expect(importFirmware(library, requirement, source)).rejects.toThrow(
      'real folder',
    );
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it.each([
    { ...requirement, id: '../x' },
    {
      ...requirement,
      knownDumps: [{ ...requirement.knownDumps[0], crc32: 'XYZ' }],
    },
    {
      ...requirement,
      knownDumps: [
        { ...requirement.knownDumps[0], destinations: ['../../etc/x'] },
      ],
    },
    {
      ...requirement,
      knownDumps: [{ ...requirement.knownDumps[0], destinations: ['/etc/x'] }],
    },
    { ...requirement, knownDumps: [] },
  ])('rejects malformed declarations %#', (bad) => {
    expect(() => validateRequirement(bad as FirmwareRequirement)).toThrow(
      'Invalid firmware',
    );
  });
});
