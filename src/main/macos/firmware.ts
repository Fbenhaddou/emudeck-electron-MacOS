/* eslint max-classes-per-file: ["error", 2] -- A user-facing error marker lives with its only user. */
import fs from 'fs/promises';
import { constants } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import type {
  ComponentAdapter,
  FirmwareDump,
  FirmwareRequirement,
} from '../components/types';
import { CRC32 } from '../components/shared/crc32';

export type FirmwareState = 'missing' | 'recognized' | 'unrecognized';

export interface FirmwareItem {
  component: string;
  id: string;
  system: string;
  title: string;
  purpose: string;
  required: boolean;
  state: FirmwareState;
  /** Recognized dump label, when recognized. */
  detail: string | null;
}

/** Messages written for people; anything else is never shown raw. */
export class FirmwareError extends Error {}

/** Rejects malformed component declarations before any file is touched. */
export function validateRequirement(requirement: FirmwareRequirement): void {
  const relative = (destination: string) =>
    typeof destination === 'string' &&
    !path.isAbsolute(destination) &&
    !destination.includes('\\') &&
    !destination.includes('\0') &&
    destination
      .split('/')
      .every((part) => part && part !== '.' && part !== '..');
  if (
    !/^[a-z0-9][a-z0-9-]{0,47}$/.test(requirement.id) ||
    !/^[a-z0-9]{1,16}$/.test(requirement.system) ||
    !Number.isSafeInteger(requirement.maxBytes) ||
    requirement.maxBytes < 1 ||
    requirement.maxBytes > 64 * 1024 * 1024 ||
    requirement.knownDumps.length < 1 ||
    requirement.knownDumps.some(
      (dump) =>
        !/^[0-9a-f]{8}$/.test(dump.crc32) ||
        dump.destinations.length < 1 ||
        !dump.destinations.every(relative),
    )
  )
    throw new Error(`Invalid firmware declaration: ${requirement.id}`);
}

async function regularFile(file: string, maxBytes: number) {
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new FirmwareError('Choose a regular file, not a folder or alias.');
  if (stat.size < 1 || stat.size > maxBytes)
    throw new FirmwareError(
      'This file is not the right size for this firmware.',
    );
  return stat;
}

/** Streams the file through CRC32 without loading it whole. */
async function crc32Of(file: string): Promise<string> {
  const handle = await fs.open(file, 'r');
  try {
    const crc = new CRC32();
    const buffer = new Uint8Array(64 * 1024);
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- Sequential streaming read.
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      crc.update(buffer.subarray(0, bytesRead));
    }
    return crc.digest();
  } finally {
    await handle.close();
  }
}

function match(
  requirement: FirmwareRequirement,
  crc: string,
): FirmwareDump | undefined {
  return requirement.knownDumps.find((dump) => dump.crc32 === crc);
}

function destinations(requirement: FirmwareRequirement): string[] {
  return [
    ...new Set(requirement.knownDumps.flatMap((dump) => dump.destinations)),
  ];
}

/** Read-only status of every firmware the registered components can use. */
export async function firmwareStatus(
  library: string,
  adapters: readonly ComponentAdapter[],
): Promise<FirmwareItem[]> {
  const items: FirmwareItem[] = [];
  // eslint-disable-next-line no-restricted-syntax -- Few, bounded, sequential checks.
  for (const adapter of adapters) {
    // eslint-disable-next-line no-restricted-syntax
    for (const requirement of adapter.firmware || []) {
      validateRequirement(requirement);
      let state: FirmwareState = 'missing';
      let detail: string | null = null;
      // eslint-disable-next-line no-restricted-syntax
      for (const destination of destinations(requirement)) {
        const file = path.join(library, destination);
        // eslint-disable-next-line no-await-in-loop
        const stat = await regularFile(file, requirement.maxBytes).catch(
          () => 'invalid' as const,
        );
        if (stat === 'invalid')
          state = state === 'missing' ? 'unrecognized' : state;
        if (stat && stat !== 'invalid') {
          // eslint-disable-next-line no-await-in-loop
          const dump = match(requirement, await crc32Of(file));
          if (dump) {
            state = 'recognized';
            detail = dump.label;
            break;
          }
          state = 'unrecognized';
        }
      }
      items.push({
        component: adapter.manifest.id,
        id: requirement.id,
        system: requirement.system,
        title: requirement.title,
        purpose: requirement.purpose,
        required: requirement.required,
        state,
        detail,
      });
    }
  }
  return items;
}

async function safeParents(library: string, file: string): Promise<void> {
  const relative = path.relative(library, path.dirname(file));
  let current = library;
  // eslint-disable-next-line no-restricted-syntax -- Parents in order.
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    // eslint-disable-next-line no-await-in-loop
    await fs.mkdir(current, { mode: 0o755 }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    });
    // eslint-disable-next-line no-await-in-loop
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new FirmwareError('A library folder is not a real folder.');
  }
}

/**
 * Copies a user-provided, recognized dump to its destinations. The original is
 * never modified; a different existing file is kept as a dated backup.
 */
export async function importFirmware(
  library: string,
  requirement: FirmwareRequirement,
  source: string,
  now: Date = new Date(),
): Promise<{ label: string; written: string[]; backups: string[] }> {
  validateRequirement(requirement);
  if (!(await regularFile(source, requirement.maxBytes)))
    throw new FirmwareError('The file could not be found.');
  const dump = match(requirement, await crc32Of(source));
  if (!dump)
    throw new FirmwareError(
      `This file is not a known good ${requirement.title} dump. Nothing was copied.`,
    );
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const written: string[] = [];
  const backups: string[] = [];
  // eslint-disable-next-line no-restricted-syntax -- Sequential, bounded copies.
  for (const destination of dump.destinations) {
    const target = path.join(library, destination);
    // eslint-disable-next-line no-await-in-loop
    await safeParents(library, target);
    // eslint-disable-next-line no-await-in-loop
    const existing = await fs.lstat(target).catch(() => null);
    if (existing) {
      const regular = existing.isFile() && !existing.isSymbolicLink();
      // eslint-disable-next-line no-await-in-loop -- Sequential, bounded copies.
      const same = regular && (await crc32Of(target)) === dump.crc32;
      if (same) continue; // eslint-disable-line no-continue
      const backup = `${target}.before-${stamp}`;
      // eslint-disable-next-line no-await-in-loop
      await fs.rename(target, backup);
      backups.push(path.relative(library, backup));
    }
    const temporary = `${target}.${randomBytes(6).toString('hex')}.tmp`;
    // eslint-disable-next-line no-await-in-loop
    await fs.copyFile(source, temporary, constants.COPYFILE_EXCL);
    // eslint-disable-next-line no-await-in-loop
    if ((await crc32Of(temporary)) !== dump.crc32) {
      // eslint-disable-next-line no-await-in-loop
      await fs.rm(temporary, { force: true });
      throw new FirmwareError(
        'The copy could not be verified. Nothing was replaced.',
      );
    }
    // eslint-disable-next-line no-await-in-loop
    await fs.rename(temporary, target);
    written.push(destination);
  }
  return { label: dump.label, written, backups };
}
