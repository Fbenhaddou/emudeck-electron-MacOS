import { execFile } from 'child_process';
import path from 'path';

/** Inspect only executable names. Never collect command arguments or game paths. */
export function readProcessExecutables(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      '/bin/ps',
      ['-axo', 'comm='],
      { timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error)
          reject(new Error('Running applications could not be checked'));
        else resolve(stdout);
      },
    );
  });
}

export function containsManagedDolphin(
  output: string,
  installRoot: string,
): boolean {
  const prefix = `${path.resolve(installRoot)}${path.sep}`;
  return output.split('\n').some((line) => {
    const executable = line.trim();
    if (!executable.startsWith(prefix)) return false;
    return /^\d{4}[a-z]?\/Dolphin\.app\/Contents\/MacOS\/Dolphin$/.test(
      executable.slice(prefix.length),
    );
  });
}

export async function hasManagedDolphin(installRoot: string): Promise<boolean> {
  return containsManagedDolphin(await readProcessExecutables(), installRoot);
}
