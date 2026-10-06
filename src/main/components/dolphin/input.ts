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

function pad(device: string): string {
  return `[GCPad1]
Device = ${device}
Buttons/A = \`Button S\`
Buttons/B = \`Button W\`
Buttons/X = \`Button E\`
Buttons/Y = \`Button N\`
Buttons/Z = \`Shoulder R\`
Buttons/Start = \`Start\`
Main Stick/Up = \`Left Y-\`
Main Stick/Down = \`Left Y+\`
Main Stick/Left = \`Left X-\`
Main Stick/Right = \`Left X+\`
C-Stick/Up = \`Right Y-\`
C-Stick/Down = \`Right Y+\`
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
  const owned: Record<string, string> = {};
  const recorded = await readIfRegular(ownershipFile);
  try {
    const parsed = recorded ? JSON.parse(recorded) : {};
    Object.entries(parsed?.files || {}).forEach(([name, hash]) => {
      if (typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))
        owned[name] = hash;
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
    const ours = owned[name] !== undefined;
    if (current !== null && ours && stillManaged(current, content)) {
      // Dolphin may rewrite the file on exit; the mapping is still exactly ours.
      result.files[name] = 'current';
    } else if (current !== null && (!ours || owned[name] !== sha256(current))) {
      result.files[name] = 'user';
      delete owned[name];
    } else if (current === content) {
      result.files[name] = 'current';
    } else {
      const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
      // eslint-disable-next-line no-await-in-loop
      await fs.rename(temporary, file);
      owned[name] = sha256(content);
      result.files[name] = 'written';
    }
  }
  const record = `${JSON.stringify({ format: 'emulation-workspace-input', version: 1, files: owned })}\n`;
  const temporary = `${ownershipFile}.${randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temporary, record, { flag: 'wx', mode: 0o600 });
  await fs.rename(temporary, ownershipFile);
  return result;
}
