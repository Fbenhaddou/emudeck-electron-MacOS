import fs from 'fs/promises';
import path from 'path';
import { createHash, randomBytes } from 'crypto';

/**
 * Managed Dolphin input for Console Mode: a GameCube pad mapping and a
 * controller exit hotkey for one controller family. Files are written only when
 * absent or still exactly as this app last wrote them; any edit by the user (or
 * by Dolphin's own controller dialog) makes the file theirs and it is kept.
 */

export type InputFamily = 'ps5';

// Dolphin names SDL devices <source>/<index among same-named devices>/<name>.
const devices: Record<InputFamily, string> = {
  ps5: 'SDL/0/DualSense Wireless Controller',
};

// Measured with a physical DualSense on Dolphin 2609: SDL reports up as Y+, and
// PlayStation players expect ○ to cancel, so GameCube B is ○ and X is □.
function pad(device: string): string {
  return `[GCPad1]
Device = ${device}
Buttons/A = \`Button S\`
Buttons/B = \`Button E\`
Buttons/X = \`Button W\`
Buttons/Y = \`Button N\`
Buttons/Z = \`Shoulder R\`
Buttons/Start = \`Start\`
Main Stick/Up = \`Left Y+\`
Main Stick/Down = \`Left Y-\`
Main Stick/Left = \`Left X-\`
Main Stick/Right = \`Left X+\`
C-Stick/Up = \`Right Y+\`
C-Stick/Down = \`Right Y-\`
C-Stick/Left = \`Right X-\`
C-Stick/Right = \`Right X+\`
Triggers/L = \`Trigger L\`
Triggers/R = \`Trigger R\`
Triggers/L-Analog = \`Trigger L\`
Triggers/R-Analog = \`Trigger R\`
D-Pad/Up = \`Pad N\`
D-Pad/Down = \`Pad S\`
D-Pad/Left = \`Pad W\`
D-Pad/Right = \`Pad E\`
Rumble/Motor = \`Motor\`
`;
}

// Hold Create (Back) + Options (Start) for 1.5 s: hard to press by accident.
function hotkeys(device: string): string {
  return `[Hotkeys]
Device = ${device}
General/Exit = hold(\`Back\` & \`Start\`, 1.5)
`;
}

export function managedInput(family: InputFamily): Record<string, string> {
  const device = devices[family];
  return { 'GCPadNew.ini': pad(device), 'Hotkeys.ini': hotkeys(device) };
}

export function isInputFamily(family: string): family is InputFamily {
  return Object.prototype.hasOwnProperty.call(devices, family);
}

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
      throw new Error('Input configuration is not a regular file');
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

export async function applyManagedInput(
  configDirectory: string,
  ownershipFile: string,
  family: InputFamily,
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
  const desired = managedInput(family);
  // eslint-disable-next-line no-restricted-syntax -- Two files, sequentially.
  for (const [name, content] of Object.entries(desired)) {
    const file = path.join(configDirectory, name);
    // eslint-disable-next-line no-await-in-loop
    const current = await readIfRegular(file);
    // Ours if every value we last wrote is unchanged (Dolphin may have added
    // keys or reformatted); an older hash-only record must match exactly.
    const ours =
      current !== null &&
      (written[name] !== undefined
        ? stillManaged(current, written[name])
        : hashes[name] === sha256(current));
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
