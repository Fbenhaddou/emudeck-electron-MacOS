/* eslint import/prefer-default-export: "off" -- Single focused capability. */
import { execFile } from 'child_process';
import { LaunchRefusal } from '../shared/refusal';

/**
 * A user's own PPSSPP can store a custom memory-stick folder in its global
 * macOS preferences; that setting overrides HOME and would bypass library
 * isolation. Read-only check; launching is refused while it is set.
 */
export function ppssppPreflight(
  read: (
    // eslint-disable-next-line no-unused-vars -- Documents the injected contract.
    args: readonly string[],
  ) => Promise<boolean> = (args) =>
    new Promise((resolve) => {
      execFile('/usr/bin/defaults', [...args], { timeout: 5000 }, (error) =>
        resolve(!error),
      );
    }),
): () => Promise<void> {
  return async () => {
    const set = await read([
      'read',
      'org.ppsspp.ppsspp',
      'UserPreferredMemoryStickDirectoryPath',
    ]);
    if (set)
      throw new LaunchRefusal(
        'Your own PPSSPP uses a custom memory stick folder, which would bypass this library. Clear that setting in PPSSPP, then try again.',
      );
  };
}
