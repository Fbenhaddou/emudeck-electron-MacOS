import fs from 'fs/promises';
import { randomBytes } from 'crypto';
import type { StickResponse } from '../components/dolphin/input';

/** Machine-local controller preference; any unreadable value falls back to standard. */
export async function readStickResponse(file: string): Promise<StickResponse> {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096)
      return 'standard';
    const value = JSON.parse(await fs.readFile(file, 'utf8'))?.stickResponse;
    return value === 'precise' ? 'precise' : 'standard';
  } catch {
    return 'standard';
  }
}

export async function writeStickResponse(
  file: string,
  value: StickResponse,
): Promise<void> {
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(
    temporary,
    `${JSON.stringify({ format: 'emulation-workspace-controllers', version: 1, stickResponse: value })}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  await fs.rename(temporary, file);
}
