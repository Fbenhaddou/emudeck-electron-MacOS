import { Hero } from '../controls';
import type { PageProps } from './types';

export default function ThisMacPage({
  status,
  action,
  busy,
  operate,
}: PageProps) {
  return (
    <>
      <Hero page="This Mac" tint="gray" title="This Mac">
        Capabilities reported by this Mac. Emulator settings are chosen from
        these, not from the model name.
      </Hero>
      <dl className="group facts">
        <div>
          <dt>Architecture</dt>
          <dd>
            {status.architecture === 'arm64'
              ? 'Apple Silicon · ARM64'
              : status.architecture}
          </dd>
        </div>
        <div>
          <dt>macOS</dt>
          <dd>{status.osVersion}</dd>
        </div>
        <div>
          <dt>Memory</dt>
          <dd>{Math.round(status.memoryBytes / 1024 ** 3)} GB</dd>
        </div>
        {status.displays.map((display, index) => (
          <div
            key={`${display.width}-${display.height}-${display.scaleFactor}`}
          >
            <dt>Display {index + 1}</dt>
            <dd>
              {display.width} × {display.height} points · {display.scaleFactor}×
              {display.refreshRate ? ` · ${display.refreshRate} Hz` : ''}
            </dd>
          </div>
        ))}
      </dl>
      <p className="footnote">
        HDR and advanced controller capabilities have not been verified.
      </p>
      <section
        className="group"
        aria-label="Diagnostics"
        aria-busy={action === 'exporting-diagnostics'}
      >
        <div className="row">
          <div className="row-text">
            <h3>Diagnostics Report</h3>
            <p>
              Versions, settings states and recent events, to help troubleshoot
              a problem.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void operate('exporting-diagnostics', () =>
                window.mac.exportDiagnostics(),
              );
            }}
          >
            {action === 'exporting-diagnostics' ? 'Exporting…' : 'Export…'}
          </button>
        </div>
      </section>
      <p className="footnote">
        The report never includes game names, file paths, controller names or
        your account name. It stays on your Mac until you choose to share it.
      </p>
    </>
  );
}
