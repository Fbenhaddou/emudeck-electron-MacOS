import fs from 'fs/promises';
import path from 'path';
import { createHash, randomBytes } from 'crypto';

/**
 * Managed emulator INI files: written only when absent or still exactly as this
 * app last wrote them (by value, so an emulator rewriting the file with extra
 * keys keeps it managed). Any change to a managed value hands the file to the
 * user permanently; adopting the recommended file again backs theirs up first.
 */
const sha256 = (text: string) =>
  createHash('sha256').update(text).digest('hex');

/** Section/key → value; Dolphin rewrites these files with extra keys and spacing. */
function iniValues(text: string): Map<string, string> {
  const values = new Map<string, string>();
  let section = '';
  text.split(/\r?\n/).forEach((line) => {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) [, section] = header;
    const pair = /^\s*([^=]+?)\s*=\s*(.*?)\s*$/.exec(line);
    if (pair && !header) values.set(`${section}/${pair[1]}`, pair[2]);
  });
  return values;
}

/** Every value this app manages still has exactly the value it wrote. */
function stillManaged(current: string, desired: string): boolean {
  const actual = iniValues(current);
  return [...iniValues(desired)].every(
    ([key, value]) => actual.get(key) === value,
  );
}

async function readIfRegular(file: string): Promise<string | null> {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024)
      throw new Error('Configuration is not a regular file');
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export interface InputResult {
  /** Per file: written by us now, already ours and current, or kept as the user's. */
  files: Record<string, 'written' | 'current' | 'user'>;
}

export async function applyManagedFiles(
  configDirectory: string,
  ownershipFile: string,
  desired: Record<string, string>,
  /** The emulator's own untouched defaults: unchanged copies are not user edits. */
  upstreamDefaults: Record<string, string> = {},
): Promise<InputResult> {
  // name → the exact content this app last wrote (version 2), or only its
  // hash (version 1 records, from before content was kept).
  const written: Record<string, string> = {};
  const hashes: Record<string, string> = {};
  const recorded = await readIfRegular(ownershipFile);
  try {
    const parsed = recorded ? JSON.parse(recorded) : {};
    Object.entries(parsed?.written || {}).forEach(([name, text]) => {
      if (typeof text === 'string' && text.length <= 64 * 1024)
        written[name] = text;
    });
    Object.entries(parsed?.files || {}).forEach(([name, hash]) => {
      if (typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))
        hashes[name] = hash;
    });
  } catch {
    /* An unreadable record owns nothing; existing files stay the user's. */
  }
  const result: InputResult = { files: {} };
  // eslint-disable-next-line no-restricted-syntax -- Two files, sequentially.
  for (const [name, content] of Object.entries(desired)) {
    const file = path.join(configDirectory, name);
    // eslint-disable-next-line no-await-in-loop
    const current = await readIfRegular(file);
    // Ours if every value we last wrote is unchanged (Dolphin may have added
    // keys or reformatted); an older hash-only record must match exactly.
    const ours =
      (current !== null &&
        (written[name] !== undefined
          ? stillManaged(current, written[name])
          : hashes[name] === sha256(current))) ||
      (current !== null &&
        upstreamDefaults[name] !== undefined &&
        stillManaged(current, upstreamDefaults[name]));
    if (current !== null && !ours) {
      result.files[name] = 'user';
      delete written[name];
      delete hashes[name];
    } else if (current !== null && stillManaged(current, content)) {
      result.files[name] = 'current';
      written[name] = content;
    } else {
      const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
      // eslint-disable-next-line no-await-in-loop
      await fs.rename(temporary, file);
      written[name] = content;
      result.files[name] = 'written';
    }
    delete hashes[name];
  }
  const record = `${JSON.stringify({ format: 'emulation-workspace-input', version: 2, written })}\n`;
  const temporary = `${ownershipFile}.${randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temporary, record, { flag: 'wx', mode: 0o600 });
  await fs.rename(temporary, ownershipFile);
  return result;
}

async function readRecord(ownershipFile: string) {
  const written: Record<string, string> = {};
  const hashes: Record<string, string> = {};
  try {
    const recorded = await readIfRegular(ownershipFile);
    const parsed = recorded ? JSON.parse(recorded) : {};
    Object.entries(parsed?.written || {}).forEach(([name, text]) => {
      if (typeof text === 'string' && text.length <= 64 * 1024)
        written[name] = text;
    });
    Object.entries(parsed?.files || {}).forEach(([name, hash]) => {
      if (typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))
        hashes[name] = hash;
    });
  } catch {
    /* Unreadable: owns nothing. */
  }
  return { written, hashes };
}

export type InputState = 'recommended' | 'user' | 'not-set';

/** Read-only: whether the library's Dolphin controls are this app's, the user's, or absent. */
export async function managedState(
  configDirectory: string,
  ownershipFile: string,
  names: readonly string[],
): Promise<InputState> {
  const { written, hashes } = await readRecord(ownershipFile);
  let state: InputState = 'not-set';
  // eslint-disable-next-line no-restricted-syntax -- Two files, sequentially.
  for (const name of names) {
    // eslint-disable-next-line no-await-in-loop
    const current = await readIfRegular(path.join(configDirectory, name)).catch(
      () => '',
    );
    if (current !== null) {
      const ours =
        written[name] !== undefined
          ? stillManaged(current, written[name])
          : hashes[name] === sha256(current);
      if (!ours) return 'user';
      state = 'recommended';
    }
  }
  return state;
}

/**
 * Explicit user request: replace the library's own Dolphin controls with the
 * recommended ones. Existing files are renamed to a dated backup, never deleted.
 */
export async function adoptManagedFiles(
  configDirectory: string,
  ownershipFile: string,
  desired: Record<string, string>,
  now: Date = new Date(),
): Promise<{ backups: string[] }> {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const backups: string[] = [];
  const { written } = await readRecord(ownershipFile);
  // eslint-disable-next-line no-restricted-syntax -- Two files, sequentially.
  for (const name of Object.keys(desired)) {
    const file = path.join(configDirectory, name);
    // eslint-disable-next-line no-await-in-loop
    const current = await readIfRegular(file);
    const ours =
      current !== null &&
      written[name] !== undefined &&
      stillManaged(current, written[name]);
    if (current !== null && !ours) {
      const backup = `${file}.before-recommended-${stamp}`;
      // eslint-disable-next-line no-await-in-loop
      await fs.rename(file, backup);
      backups.push(path.basename(backup));
    }
  }
  await applyManagedFiles(configDirectory, ownershipFile, desired);
  return { backups };
}
