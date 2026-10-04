/* eslint import/prefer-default-export: "off" -- Single focused capability. */
import { execFile } from 'child_process';
import path from 'path';

export type FocusOutcome = 'frontmost' | 'declined' | 'refused' | 'failed';

/* eslint-disable no-unused-vars -- Names describe the injected contract. */
export type HelperRunner = (
  helper: string,
  args: readonly string[],
) => Promise<number>;
/* eslint-enable no-unused-vars */

const runHelper: HelperRunner = (helper, args) =>
  new Promise((resolve) => {
    execFile(helper, [...args], { timeout: 5000 }, (error) => {
      if (!error) resolve(0);
      else resolve(typeof error.code === 'number' ? error.code : -1);
    });
  });

/**
 * Returns the Console Mode frontend to the front after a game exits. Electron
 * cannot activate another process and ES-DE has no focus code of its own; without
 * this an unfocused frontend ignores controller input. Never throws: the caller
 * records the outcome and must not claim controller-only return on failure.
 */
export async function restoreFocus(
  helper: string,
  pid: number,
  bundlePath: string,
  run: HelperRunner = runHelper,
): Promise<FocusOutcome> {
  if (
    !Number.isSafeInteger(pid) ||
    pid <= 1 ||
    pid > 9999999 ||
    !path.isAbsolute(helper) ||
    !path.isAbsolute(bundlePath) ||
    path.resolve(bundlePath) !== bundlePath ||
    !bundlePath.endsWith('.app')
  )
    return 'refused';
  try {
    const code = await run(helper, [
      '--pid',
      String(pid),
      '--bundle',
      bundlePath,
    ]);
    if (code === 0) return 'frontmost';
    if (code === 2) return 'declined';
    if (code === 1) return 'refused';
    return 'failed';
  } catch {
    return 'failed';
  }
}
