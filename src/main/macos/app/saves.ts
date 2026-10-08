import { dialog, shell } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import type { ActionResult, SavesOverview } from '../../../shared/macos';
import type { ComponentAdapter } from '../../components/types';
import { diagnosticEvent } from '../diagnostics';
import { readProcessExecutables } from '../processes';
import {
  SNAPSHOT_ID,
  SnapshotError,
  listSnapshots,
  recoverInterrupted,
  restoreSnapshot,
  takeSnapshot,
} from '../snapshots';
import type { SnapshotReason, SnapshotSource } from '../snapshots';
import { acceptsOneOf } from '../security';
import { BUSY } from './context';
import type { AppContext } from './context';
import type { Emulators } from './emulators';

/** 'emulator/snapshot-id' as the Saves page sends it; checked again against the live list. */
function isRestoreTarget(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const [emulator, id, ...rest] = value.split('/');
  return (
    !rest.length &&
    /^[a-z][a-z0-9-]*$/.test(emulator) &&
    SNAPSHOT_ID.test(id ?? '')
  );
}

function within(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

/**
 * An adapter's save and state folders (a nested or shared folder is kept
 * once). Firmware the user imported into a save folder (Dolphin's IPL.bin in
 * User/GC) is excluded: it is not a save and a restore must not swap it.
 */
export function snapshotSource(
  adapter: ComponentAdapter,
  library: string,
): SnapshotSource {
  const { saves, states } = adapter.paths(library);
  const separate = !within(saves, states) && !within(states, saves);
  const folders: Record<string, string> = separate
    ? { saves, states }
    : { saves };
  const exclude = (adapter.firmware || [])
    .flatMap((requirement) =>
      requirement.knownDumps.flatMap((dump) => dump.destinations),
    )
    .map((destination) => path.join(library, destination))
    .flatMap((file) =>
      Object.entries(folders)
        .filter(([, folder]) => file.startsWith(`${folder}/`))
        .map(([name, folder]) =>
          [name, ...path.relative(folder, file).split(path.sep)].join('/'),
        ),
    );
  return {
    emulator: adapter.manifest.id,
    folders,
    exclude: [...new Set(exclude)],
  };
}

/** Plain-language reason a protected change was refused because of its backup. */
export function backupRefusal(error: unknown, emulator: string): string | null {
  if (!(error instanceof SnapshotError)) return null;
  if (error.message.includes('not a real folder'))
    return `${emulator}’s saves folder is a link to another place, so it can’t be backed up safely. Replace the link with a real folder, then try again.`;
  if (error.message.includes('journal'))
    return `A previous restore of ${emulator}’s saves could not be finished or undone automatically, so nothing was changed. Your saves are safe in the library’s backups folder; diagnostics can help find them.`;
  if (error.message.includes('not yet published'))
    return `${emulator}’s saves were restored. The copy of your previous saves will finish saving the next time you open Saves or restart the app.`;
  if (error.message.includes('is running'))
    return `Quit ${emulator} first. Its saves can’t be backed up safely while it is open.`;
  return `${emulator}’s saves could not be backed up, so nothing was changed. Check that your library drive is connected and has free space.`;
}

export function createSaves(context: AppContext, emulators: Emulators) {
  const adapters = () => emulators.systems.map((entry) => entry.adapter);
  const adapterFor = (id: string) =>
    adapters().find((adapter) => adapter.manifest.id === id);
  const bySystem = (system: string) =>
    adapters().find((adapter) => adapter.system.id === system);

  /**
   * Any copy of this emulator running, including one opened outside this app
   * (which this app's busy state cannot see). Unknown counts as running.
   */
  async function running(adapter: ComponentAdapter): Promise<boolean> {
    const suffix = `/${adapter.manifest.bundleName}/${adapter.manifest.executable}`;
    try {
      return (await readProcessExecutables())
        .split('\n')
        .some((line) => line.trim().endsWith(suffix));
    } catch {
      return true;
    }
  }

  /** Finishes or rolls back any interrupted restore (startup, before work). */
  async function recover(library: string): Promise<void> {
    // eslint-disable-next-line no-restricted-syntax -- One emulator at a time.
    for (const adapter of adapters()) {
      // eslint-disable-next-line no-await-in-loop
      if (await running(adapter)) continue; // eslint-disable-line no-continue
      // eslint-disable-next-line no-await-in-loop
      await recoverInterrupted(library, snapshotSource(adapter, library)).catch(
        () =>
          diagnosticEvent({
            event: 'save-recovery',
            emulator: adapter.manifest.id,
            result: 'failed',
          }),
      );
    }
  }

  /** Required snapshot before a change; throws so the change is refused. */
  async function before(
    library: string,
    emulator: string,
    reason: SnapshotReason,
  ): Promise<void> {
    const adapter = adapterFor(emulator);
    if (!adapter) throw new SnapshotError('Unknown emulator');
    if (await running(adapter))
      throw new SnapshotError(`${adapter.manifest.name} is running`);
    const snapshot = await takeSnapshot(
      library,
      snapshotSource(adapter, library),
      reason,
    );
    diagnosticEvent({
      event: 'save-snapshot',
      emulator,
      reason,
      files: snapshot?.files ?? 0,
    });
  }

  /** Best effort before a launch: at most once a day, only when saves changed. */
  async function daily(library: string, system: string): Promise<void> {
    const adapter = bySystem(system);
    if (!adapter || (await running(adapter))) return;
    try {
      const snapshot = await takeSnapshot(
        library,
        snapshotSource(adapter, library),
        'daily',
      );
      if (snapshot)
        diagnosticEvent({
          event: 'save-snapshot',
          emulator: adapter.manifest.id,
          reason: 'daily',
          files: snapshot.files,
        });
    } catch {
      diagnosticEvent({
        event: 'save-snapshot',
        emulator: adapter.manifest.id,
        reason: 'daily',
        error: 'failed',
      });
    }
  }

  async function overview(): Promise<SavesOverview> {
    let library: string;
    try {
      library = await context.availableLibrary();
    } catch {
      return { available: false, systems: [] };
    }
    // Never alongside a restore or a game: only when nothing else is running.
    if (!context.busy())
      await context.exclusive(() => recover(library)).catch(() => undefined);
    const systems = await Promise.all(
      emulators.systems.map(async (entry) => ({
        emulator: entry.adapter.manifest.id,
        name: entry.adapter.manifest.name,
        system: entry.adapter.system.shortName,
        installed: await entry.installed().catch(() => false),
        snapshots: (
          await listSnapshots(library, entry.adapter.manifest.id).catch(
            () => [],
          )
        ).map(({ id, reason, created, files, bytes }) => ({
          id,
          reason,
          created,
          files,
          bytes,
        })),
      })),
    );
    return { available: true, systems };
  }

  return { before, daily, overview, recover, running, adapterFor };
}

export type Saves = ReturnType<typeof createSaves>;

export function registerSavesHandlers(
  context: AppContext,
  emulators: Emulators,
  saves: Saves,
): void {
  const emulatorIDs = emulators.systems.map(
    (entry) => entry.adapter.manifest.id,
  );
  const adapterFor = (id: string) =>
    emulators.systems.find((entry) => entry.adapter.manifest.id === id)!
      .adapter;

  context.handle('mac:saves', saves.overview);

  context.handle(
    'mac:back-up-saves',
    async (args): Promise<ActionResult> => {
      if (context.busy()) return { ok: false, error: BUSY };
      return context.exclusive(async () => {
        try {
          const library = await context.availableLibrary();
          await saves.before(library, args[0] as string, 'manual');
          return { ok: true };
        } catch (error) {
          return {
            ok: false,
            error:
              backupRefusal(
                error,
                adapterFor(args[0] as string).manifest.name,
              ) ||
              'The backup could not be made. Check that your library drive is connected and has free space. Your saves are unchanged.',
          };
        }
      });
    },
    (values) => acceptsOneOf(values, emulatorIDs),
  );

  context.handle(
    'mac:restore-saves',
    async (args): Promise<ActionResult> => {
      if (context.busy()) return { ok: false, error: BUSY };
      const [emulator, id] = (args[0] as string).split('/');
      return context.exclusive(async () => {
        try {
          const library = await context.availableLibrary();
          const snapshots = await listSnapshots(library, emulator);
          const snapshot = snapshots.find((item) => item.id === id);
          if (!snapshot) throw new SnapshotError('Unknown snapshot');
          const adapter = adapterFor(emulator);
          if (await saves.running(adapter))
            throw new SnapshotError(`${adapter.manifest.name} is running`);
          const when = new Date(snapshot.created).toLocaleString();
          const choice = await dialog.showMessageBox(context.window()!, {
            type: 'warning',
            message: `Restore ${adapter.system.shortName} saves from ${when}?`,
            detail: `Your current ${adapter.manifest.name} saves and save states are kept as a new backup first, so you can switch back. Quit ${adapter.manifest.name} before restoring.`,
            buttons: ['Cancel', 'Restore'],
            defaultId: 0,
            cancelId: 0,
          });
          if (choice.response !== 1) return { ok: true };
          // Nothing can start meanwhile from this app (every launch path checks
          // the same busy flag), but the emulator could be opened from Finder.
          if ((await context.availableLibrary()) !== library)
            throw new Error('Library changed');
          if (await saves.running(adapter))
            throw new SnapshotError(`${adapter.manifest.name} is running`);
          await restoreSnapshot(library, snapshotSource(adapter, library), id);
          diagnosticEvent({ event: 'save-restore', emulator, result: 'ok' });
          return { ok: true };
        } catch (error) {
          diagnosticEvent({
            event: 'save-restore',
            emulator,
            result: 'failed',
          });
          return {
            ok: false,
            error:
              error instanceof SnapshotError &&
              error.message.includes('damaged')
                ? 'This backup is damaged and was not restored. Your current saves are unchanged.'
                : backupRefusal(error, adapterFor(emulator).manifest.name) ||
                  'The backup could not be restored. Your current saves are unchanged.',
          };
        }
      });
    },
    (values) =>
      values.length === 1 &&
      isRestoreTarget(values[0]) &&
      emulatorIDs.includes(values[0].split('/')[0]),
  );

  context.handle(
    'mac:reveal-saves',
    async (args): Promise<ActionResult> => {
      try {
        const library = await context.availableLibrary();
        const folder = adapterFor(args[0] as string).paths(library).saves;
        const stat = await fs.lstat(folder).catch(() => null);
        if (!stat) return { ok: false, error: 'There are no saves yet.' };
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw new Error('Not a real folder');
        const failure = await shell.openPath(folder);
        return failure
          ? { ok: false, error: 'Finder could not open the folder.' }
          : { ok: true };
      } catch {
        return {
          ok: false,
          error:
            'The folder could not be opened. Reconnect your library drive and try again.',
        };
      }
    },
    (values) => acceptsOneOf(values, emulatorIDs),
  );
}
