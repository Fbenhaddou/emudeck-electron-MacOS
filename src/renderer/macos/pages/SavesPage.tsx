import { useState } from 'react';
import type {
  SavesOverview,
  SavesSystem,
  SnapshotSummary,
} from '../../../shared/macos';
import { Hero, Spinner } from '../controls';
import type { PageProps } from './types';

const SHOWN = 5;

const reasons: Record<SnapshotSummary['reason'], string> = {
  daily: 'Daily backup',
  'before-update': 'Before updating the emulator',
  'before-reset': 'Before resetting settings',
  'before-controls': 'Before changing controls',
  'before-restore': 'Before restoring',
  manual: 'Manual backup',
};

function when(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const time = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (date.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (date.toDateString() === yesterday.toDateString())
    return `Yesterday, ${time}`;
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Finder-style sizes (decimal units). */
function size(bytes: number): string {
  if (bytes < 1000) return `${bytes} bytes`;
  if (bytes < 1000 ** 2) return `${Math.round(bytes / 1000)} KB`;
  if (bytes < 1000 ** 3) return `${(bytes / 1000 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1000 ** 3).toFixed(1)} GB`;
}

function SystemBackups({
  system,
  disabled,
  working,
  onBackUp,
  onRestore,
  onReveal,
}: {
  system: SavesSystem;
  disabled: boolean;
  working: boolean;
  onBackUp: () => void;
  onRestore: (snapshot: SnapshotSummary) => void;
  onReveal: () => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? system.snapshots : system.snapshots.slice(0, SHOWN);
  const hidden = system.snapshots.length - shown.length;
  const count = system.snapshots.length;
  return (
    <>
      <h2 className="group-heading">
        {system.system} <span className="secondary">· {system.name}</span>
      </h2>
      <section
        className="group"
        aria-label={`${system.system} saves`}
        aria-busy={working}
      >
        <div className="row">
          <div className="row-text">
            <h3>
              <span className="title">
                {count
                  ? `${count === 1 ? '1 backup' : `${count} backups`}`
                  : 'No backups yet'}
              </span>
            </h3>
            <p>
              {count
                ? 'Made automatically, or whenever you choose Back Up Now.'
                : 'One is made automatically the first time you play.'}
            </p>
          </div>
          {working && <Spinner />}
          <button
            type="button"
            disabled={disabled}
            aria-label={`Back up ${system.system} saves now`}
            onClick={onBackUp}
          >
            Back Up Now
          </button>
        </div>
        {shown.map((snapshot) => (
          <div className="row" key={snapshot.id}>
            <div className="row-text">
              <h3>
                <span className="title">{when(snapshot.created)}</span>
              </h3>
              <p>
                {reasons[snapshot.reason]} ·{' '}
                {snapshot.files === 1 ? '1 file' : `${snapshot.files} files`} ·{' '}
                {size(snapshot.bytes)}
              </p>
            </div>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Restore ${system.system} saves from ${when(snapshot.created)}`}
              onClick={() => onRestore(snapshot)}
            >
              Restore…
            </button>
          </div>
        ))}
        {hidden > 0 && (
          <div className="row">
            <button
              type="button"
              className="link"
              aria-expanded={false}
              onClick={() => setAll(true)}
            >
              Show All Backups ({count})
            </button>
          </div>
        )}
        <div className="row">
          <button
            type="button"
            className="link"
            aria-label={`Show ${system.system} saves in Finder`}
            onClick={onReveal}
          >
            Show Saves in Finder
          </button>
        </div>
      </section>
    </>
  );
}

export default function SavesPage({
  action,
  emulatorBusy,
  consoleBusy,
  operate,
  saves,
  revealSaves,
  goToLibrary,
}: PageProps & {
  saves: SavesOverview | null;
  revealSaves: (emulator: string) => Promise<void>;
  goToLibrary: () => void;
}) {
  const [working, setWorking] = useState<string | null>(null);
  const disabled = emulatorBusy || consoleBusy;
  const run = async (
    emulator: string,
    next: 'backing-up' | 'restoring',
    operation: () => Promise<{ ok: boolean; error?: string }>,
  ) => {
    setWorking(emulator);
    try {
      await operate(next, operation);
    } finally {
      setWorking(null);
    }
  };
  return (
    <>
      <Hero page="Saves" tint="teal" title="Saves">
        Saves are backed up automatically every day you play, and before
        updates, resets and control changes.
      </Hero>
      {!saves && (
        <section className="group" aria-label="Saves">
          <div className="row progress" role="status">
            <Spinner />
            <p>Checking your backups…</p>
          </div>
        </section>
      )}
      {saves && !saves.available && (
        <section className="group" aria-label="Saves">
          <div className="row">
            <div className="row-text">
              <h3>No library available</h3>
              <p>Choose an available library to see its backups.</p>
            </div>
            <button type="button" onClick={goToLibrary}>
              Go to Library
            </button>
          </div>
        </section>
      )}
      {saves?.available && (
        <>
          {saves.systems.map((system) => (
            <SystemBackups
              key={system.emulator}
              system={system}
              disabled={disabled}
              working={
                working === system.emulator &&
                (action === 'backing-up' || action === 'restoring')
              }
              onBackUp={() => {
                void run(system.emulator, 'backing-up', () =>
                  window.mac.backUpSaves(system.emulator),
                );
              }}
              onRestore={(snapshot) => {
                void run(system.emulator, 'restoring', () =>
                  window.mac.restoreSaves(`${system.emulator}/${snapshot.id}`),
                );
              }}
              onReveal={() => {
                void revealSaves(system.emulator);
              }}
            />
          ))}
          <p className="footnote">
            Restoring first backs up your current saves, so you can always
            switch back. Up to 30 backups are kept for each system, on the same
            drive as your library.
          </p>
        </>
      )}
    </>
  );
}
