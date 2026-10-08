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
  'before-restore': 'Your saves before a restore',
  manual: 'Backed up by you',
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

function summary(system: SavesSystem): string {
  const [latest] = system.snapshots;
  if (!latest) return 'No backups yet';
  const count = system.snapshots.length;
  return `Last backup ${when(latest.created).replace(/^[A-Z]/, (first) =>
    first.toLowerCase(),
  )} · ${count === 1 ? '1 backup' : `${count} backups`}`;
}

export default function SavesPage({
  action,
  emulatorBusy,
  consoleBusy,
  operate,
  saves,
  revealSaves,
}: PageProps & {
  saves: SavesOverview | null;
  revealSaves: (emulator: string) => Promise<void>;
}) {
  const disabled = emulatorBusy || consoleBusy;
  return (
    <>
      <Hero page="Saves" tint="teal" title="Saves">
        Your saves and save states are backed up automatically before updates,
        resets and control changes, and once a day while you play. Backups stay
        in your library.
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
              <p>Choose an available library in Library first.</p>
            </div>
          </div>
        </section>
      )}
      {saves?.available &&
        saves.systems.map((system) => (
          <section
            key={system.emulator}
            className="group"
            aria-label={`${system.system} saves`}
            aria-busy={action === 'backing-up' || action === 'restoring'}
          >
            <div className="row">
              <div className="row-text">
                <h3>
                  <span className="title">{system.system}</span>
                  <span className="tag">{system.name}</span>
                </h3>
                <p>{summary(system)}</p>
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  aria-label={`Show ${system.system} saves in Finder`}
                  onClick={() => {
                    void revealSaves(system.emulator);
                  }}
                >
                  Show in Finder
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Back up ${system.system} saves now`}
                  onClick={() => {
                    void operate('backing-up', () =>
                      window.mac.backUpSaves(system.emulator),
                    );
                  }}
                >
                  Back Up Now
                </button>
              </div>
            </div>
            {system.snapshots.slice(0, SHOWN).map((snapshot) => (
              <div className="row" key={snapshot.id}>
                <div className="row-text">
                  <h3>
                    <span className="title">{when(snapshot.created)}</span>
                  </h3>
                  <p>
                    {reasons[snapshot.reason]} ·{' '}
                    {snapshot.files === 1
                      ? '1 file'
                      : `${snapshot.files} files`}{' '}
                    · {size(snapshot.bytes)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Restore ${system.system} saves from ${when(snapshot.created)}`}
                  onClick={() => {
                    void operate('restoring', () =>
                      window.mac.restoreSaves(
                        `${system.emulator}/${snapshot.id}`,
                      ),
                    );
                  }}
                >
                  Restore…
                </button>
              </div>
            ))}
          </section>
        ))}
      <p className="footnote">
        Restoring keeps your current saves as a new backup first, so you can
        always switch back. The newest 30 backups of each emulator are kept in
        your library’s backups/saves folder.
      </p>
    </>
  );
}
