import { Caution, Hero, Spinner } from '../controls';
import type { PageProps } from './types';

export default function ConsolePage({
  status,
  action,
  emulatorBusy,
  consoleBusy,
  operate,
}: PageProps) {
  const consoleState = status.console.state;
  const consoleMessages: Partial<Record<typeof consoleState, string>> = {
    installing: 'Installing ES-DE… Downloading and verifying the application.',
    starting: 'Opening Console Mode…',
    running: 'Console Mode is open. Choose Quit ES-DE in its menu to return.',
    stopping: 'Closing Console Mode…',
  };
  let consoleMessage = consoleMessages[consoleState] || '';
  if (!consoleMessage && action === 'installing-console')
    consoleMessage = consoleMessages.installing || '';
  const consoleSpinner = Boolean(consoleMessage) && consoleState !== 'running';
  let consoleRequirement =
    'Fullscreen and controller-first. Emulation Workspace hides until you quit.';
  if (!status.library?.available)
    consoleRequirement = 'Choose an available library in Library first.';
  else if (!status.dolphin.version)
    consoleRequirement = 'Install Dolphin in Emulators first.';
  else if (status.console.frontendState === 'damaged')
    consoleRequirement = 'Repair ES-DE above first.';
  else if (status.console.frontendState !== 'installed')
    consoleRequirement = 'Install ES-DE above first.';
  const consoleReady = Boolean(
    status.library?.available &&
    status.dolphin.version &&
    status.console.frontendState === 'installed',
  );
  return (
    <>
      <Hero page="Console Mode" tint="green" title="Console Mode">
        Browse and play your games from the couch. To come back here, open the
        menu and choose Quit ES-DE.
      </Hero>
      <section
        className="group"
        aria-label="Console Mode"
        aria-busy={
          status.console.state === 'installing' ||
          status.console.state === 'starting' ||
          status.console.state === 'stopping'
        }
      >
        <div className="row">
          <div className="row-text">
            <h3>ES-DE</h3>
            <p>
              {status.console.frontendState === 'damaged' &&
                'Needs repair · Some application files are missing or changed'}
              {status.console.frontendState === 'installed' &&
                `Frontend · Version ${status.console.frontend}`}
              {status.console.frontendState === 'missing' &&
                'Frontend · Official release for Apple Silicon'}
            </p>
          </div>
          {status.console.frontendState !== 'installed' && (
            <button
              type="button"
              className="primary"
              disabled={emulatorBusy || consoleBusy}
              onClick={() => {
                void operate('installing-console', () =>
                  window.mac.installConsole(),
                );
              }}
            >
              {status.console.frontendState === 'damaged'
                ? 'Repair ES-DE…'
                : 'Install ES-DE…'}
            </button>
          )}
        </div>
        {consoleMessage && (
          <div className="row progress" role="status">
            {consoleSpinner && <Spinner />}
            <p>{consoleMessage}</p>
          </div>
        )}
        {status.console.lastError && status.console.state === 'idle' && (
          <div className="row alert" role="alert">
            <Caution />
            <p>{status.console.lastError}</p>
          </div>
        )}
        <div className="row">
          <div className="row-text">
            <h3>Open Console Mode</h3>
            <p>{consoleRequirement}</p>
          </div>
          <button
            type="button"
            className={consoleReady ? 'primary' : ''}
            disabled={!consoleReady || emulatorBusy || consoleBusy}
            onClick={() => {
              void operate('opening-console', () => window.mac.enterConsole());
            }}
          >
            Open Console Mode
          </button>
        </div>
      </section>
      <p className="footnote">
        ES-DE is installed from its reviewed official release after you agree to
        its license. Games and saves stay in your library.
      </p>
      <p className="footnote">
        Tested with a DualSense connected by USB. Bluetooth and other
        controllers have not been tested yet.
      </p>
    </>
  );
}
