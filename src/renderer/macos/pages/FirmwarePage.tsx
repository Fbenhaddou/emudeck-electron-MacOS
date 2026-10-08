import type { FirmwareSummary, LibraryOverview } from '../../../shared/macos';
import { Hero, Spinner } from '../controls';
import type { PageProps } from './types';

const firmwareText: Record<FirmwareSummary['state'], string> = {
  missing: 'Not added.',
  recognized: 'Added and recognized',
  unrecognized:
    'A file is in place but is not a known good dump. Add your own dump to replace it; the current file is kept as a backup.',
};

function describeFirmware(item: FirmwareSummary): string {
  if (item.state === 'recognized')
    return `${firmwareText.recognized}: ${item.detail}.`;
  return firmwareText[item.state];
}

export default function FirmwarePage({
  action,
  emulatorBusy,
  consoleBusy,
  overview,
  addFirmware,
}: PageProps & {
  overview: LibraryOverview | null;
  addFirmware: (id: string) => Promise<void>;
}) {
  return (
    <>
      <Hero page="Firmware" tint="orange" title="Firmware">
        Some emulators can use system files dumped from your own console. Each
        file is checked against known good dumps and copied into your library.
        Nothing is downloaded.
      </Hero>
      {!overview && (
        <section className="group" aria-label="System files">
          <div className="row progress" role="status">
            <Spinner />
            <p>Checking your library…</p>
          </div>
        </section>
      )}
      {overview && !overview.available && (
        <section className="group" aria-label="System files">
          <div className="row">
            <div className="row-text">
              <h3>No library available</h3>
              <p>Choose an available library in Library first.</p>
            </div>
          </div>
        </section>
      )}
      {overview?.available && (
        <section
          className="group"
          aria-label="System files"
          aria-busy={action === 'adding-firmware'}
        >
          {overview.firmware.map((item) => (
            <div className="row" key={item.id}>
              <div className="row-text">
                <h3>
                  <span
                    className={`indicator ${item.state === 'recognized' ? 'on' : 'off'}`}
                    aria-hidden="true"
                  />
                  <span className="title">{item.title}</span>
                  <span className="tag">
                    {item.required ? 'Required' : 'Optional'}
                  </span>
                </h3>
                <p>{item.purpose}</p>
                <p>{describeFirmware(item)}</p>
              </div>
              <button
                type="button"
                disabled={emulatorBusy || consoleBusy}
                aria-label={`${item.state === 'missing' ? 'Add' : 'Replace'} ${item.title}`}
                onClick={() => {
                  void addFirmware(item.id);
                }}
              >
                {item.state === 'missing' ? 'Add…' : 'Replace…'}
              </button>
            </div>
          ))}
          {overview.systems
            .filter(
              (system) =>
                !overview.firmware.some((item) => item.system === system.id),
            )
            .map((system) => (
              <div className="row" key={system.id}>
                <div className="row-text">
                  <h3>
                    <span className="title">{system.name}</span>
                  </h3>
                  <p>{system.emulator} needs no system files.</p>
                </div>
              </div>
            ))}
        </section>
      )}
      <p className="footnote">
        Use only files you dumped from hardware you own. Your original file is
        never changed, and a file it replaces is kept as a dated backup.
      </p>
    </>
  );
}
