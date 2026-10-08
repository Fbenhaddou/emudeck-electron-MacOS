import { app, dialog, shell } from 'electron';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type {
  ActionResult,
  ControllersStatus,
  LibraryOverview,
  MacStatus,
} from '../../../shared/macos';
import {
  buildDiagnostics,
  recentEvents,
  writeDiagnostics,
} from '../diagnostics';
import type { AppContext } from './context';

export default function registerDiagnosticsHandlers(
  context: AppContext,
  sources: {
    status: () => Promise<MacStatus>;
    overview: () => Promise<LibraryOverview>;
    controllers: () => Promise<ControllersStatus>;
  },
): void {
  context.handle('mac:export-diagnostics', async (): Promise<ActionResult> => {
    try {
      const [status, overview, controllers] = await Promise.all([
        sources.status(),
        sources.overview(),
        sources.controllers().catch(() => null),
      ]);
      const now = new Date();
      const secrets = [
        { value: os.homedir(), placeholder: '<home>' },
        { value: os.userInfo().username, placeholder: '<user>' },
        { value: os.hostname().replace(/\.local$/, ''), placeholder: '<host>' },
        { value: context.userData, placeholder: '<app-data>' },
      ];
      if (status.library?.path) {
        secrets.push({ value: status.library.path, placeholder: '<library>' });
        const real = await fs.realpath(status.library.path).catch(() => null);
        if (real) secrets.push({ value: real, placeholder: '<library>' });
      }
      const report = buildDiagnostics({
        status,
        overview,
        controllers,
        events: recentEvents(),
        context: { secrets },
        now,
      });
      const choice = await dialog.showSaveDialog(context.window()!, {
        title: 'Export Diagnostics',
        message:
          'The report lists versions, settings states and recent events. It contains no game names, file paths or account names.',
        defaultPath: path.join(
          app.getPath('desktop'),
          `Emulation Workspace Diagnostics ${now.toISOString().slice(0, 10)}.json`,
        ),
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (choice.canceled || !choice.filePath) return { ok: true };
      await writeDiagnostics(choice.filePath, report);
      shell.showItemInFolder(choice.filePath);
      return { ok: true };
    } catch {
      return {
        ok: false,
        error:
          'The diagnostics report could not be saved. Choose another location and try again.',
      };
    }
  });
}
