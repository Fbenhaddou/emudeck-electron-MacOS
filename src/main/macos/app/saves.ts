import { dialog, shell } from 'electron';
import fs from 'fs/promises';
import type { ActionResult, SavesOverview } from '../../../shared/macos';
import type { ComponentAdapter } from '../../components/types';
import { diagnosticEvent } from '../diagnostics';
import {
  SnapshotError,
  listSnapshots,
  restoreSnapshot,
  takeSnapshot,
} from '../snapshots';
import type { SnapshotReason, SnapshotSource } from '../snapshots';
import { acceptsOneOf } from '../security';
import { BUSY } from './context';
import type { AppContext } from './context';
import type { Emulators } from './emulators';

/** 'emulator/snapshot-id' as the Saves page sends it; checked again against the live list. */
const RESTORE_TARGET =
  /^[a-z][a-z0-9-]*\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-z-]+$/;

function within(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

/** An adapter's save and state folders; a nested or shared folder is kept once. */
export function snapshotSource(
  adapter: ComponentAdapter,
  library: string,
): SnapshotSource {
  const { saves, states } = adapter.paths(library);
  const separate = !within(saves, states) && !within(states, saves);
  return {
    emulator: adapter.manifest.id,
    folders: separate ? { saves, states } : { saves },
  };
}

export function createSaves(context: AppContext, emulators: Emulators) {
  const adapters = () => emulators.systems.map((entry) => entry.adapter);
  const adapterFor = (id: string) =>
    adapters().find((adapter) => adapter.manifest.id === id);
  const bySystem = (system: string) =>
    adapters().find((adapter) => adapter.system.id === system);

  /** Required snapshot before a change; throws so the change is refused. */
  async function before(
    library: string,
    emulator: string,
    reason: SnapshotReason,
  ): Promise<void> {
    const adapter = adapterFor(emulator);
    if (!adapter) throw new SnapshotError('Unknown emulator');
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
    if (!adapter) return;
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

  return { before, daily, overview };
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
        } catch {
          return {
            ok: false,
            error:
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
          // Nothing can start meanwhile: every launch path checks the same busy flag.
          if ((await context.availableLibrary()) !== library)
            throw new Error('Library changed');
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
                : 'The backup could not be restored. Your current saves are unchanged or kept in a new backup.',
          };
        }
      });
    },
    (values) =>
      values.length === 1 &&
      typeof values[0] === 'string' &&
      RESTORE_TARGET.test(values[0]) &&
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
