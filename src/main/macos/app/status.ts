import { app, screen } from 'electron';
import fs from 'fs/promises';
import os from 'os';
import type { MacStatus } from '../../../shared/macos';
import { ESDE_RELEASE, frontendHealth } from '../../components/es-de/install';
import { readLibrary } from '../library';
import type { AppContext } from './context';
import type { ConsoleMode } from './console';
import type { Emulators } from './emulators';

export default function statusReader(
  context: AppContext,
  { manager, pinned, pinnedIDs }: Emulators,
  consoleMode: ConsoleMode,
) {
  return async (): Promise<MacStatus> => {
    let library = null;
    let libraryError = null;
    try {
      library = await readLibrary(context.statePath);
    } catch {
      libraryError =
        'Library settings could not be read. Existing files have been preserved.';
    }
    let frontendState: 'missing' | 'installed' | 'damaged' = 'missing';
    try {
      // Status is read-only: never create folders; absent means not installed.
      frontendState = await frontendHealth(
        await fs.realpath(consoleMode.frontendRoot),
      );
    } catch {
      frontendState = 'missing';
    }
    const { session } = consoleMode;
    const { report } = session;
    return {
      dolphin: await manager.status(),
      emulators: (await Promise.all(
        pinnedIDs.map((id) => pinned[id].status()),
      )) as MacStatus['emulators'],
      console: {
        frontend: frontendState === 'missing' ? null : ESDE_RELEASE.version,
        frontendState,
        state: consoleMode.installing() ? 'installing' : session.state,
        lastError: report?.error || null,
        games: report ? report.games : null,
      },
      appVersion: app.getVersion(),
      platform: 'darwin',
      architecture: process.arch,
      osVersion: process.getSystemVersion(),
      memoryBytes: os.totalmem(),
      displays: screen.getAllDisplays().map((display) => ({
        width: display.size.width,
        height: display.size.height,
        scaleFactor: display.scaleFactor,
        refreshRate:
          display.displayFrequency > 0 ? display.displayFrequency : null,
        hdr: 'unknown',
      })),
      library,
      libraryError,
      capabilities: {
        controllers: 'untested',
        installation: 'planned',
        consoleMode: 'preview',
      },
    };
  };
}
