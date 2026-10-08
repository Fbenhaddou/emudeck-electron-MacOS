import type { EmulatorSummary, MacStatus } from '../../../shared/macos';
import { Hero, Spinner } from '../controls';
import type { PageProps } from './types';

const operationMessages: Record<
  Exclude<MacStatus['dolphin']['operation'], 'idle'>,
  string
> = {
  installing:
    'Installing Dolphin… Downloading and verifying the application may take a few minutes.',
  launching: 'Starting your game… macOS is verifying Dolphin.',
  running: 'Dolphin is running. Quit the game to return here.',
  resetting: 'Resetting Dolphin settings… Games and saves stay in place.',
};

const buildNotes: Record<EmulatorSummary['architecture'], string> = {
  universal: 'Official Universal build · Native Apple Silicon',
  arm64: 'Official build · Native Apple Silicon',
  x64: 'Official Intel build · Needs Rosetta',
};

/** 'A', 'A and B', 'A, B and C'. */
function list(items: readonly string[]): string {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export default function EmulatorsPage({
  status,
  action,
  busy,
  emulatorBusy,
  operate,
}: PageProps) {
  const dolphinOperation = status.dolphin.operation;
  let operationMessage = '';
  if (dolphinOperation !== 'idle')
    operationMessage = operationMessages[dolphinOperation];
  else if (action === 'installing' || action === 'resetting')
    operationMessage = operationMessages[action];
  else if (action === 'choosing-game')
    operationMessage = 'Choose a game in the file dialog.';
  const showSpinner =
    Boolean(operationMessage) &&
    dolphinOperation !== 'running' &&
    action !== 'choosing-game';
  const emulatorNames = list([
    'Dolphin',
    ...status.emulators.map((emulator) => emulator.name),
  ]);
  const systemNames = list([
    'GameCube',
    ...status.emulators.map((emulator) => emulator.systemName),
  ]);
  return (
    <>
      <Hero page="Emulators" tint="indigo" title="Emulators">
        {emulatorNames} bring {systemNames} games and homebrew to your Mac. Add
        your own legally obtained games.
      </Hero>
      <section
        className="group"
        aria-label="Dolphin management"
        aria-busy={
          busy ||
          (dolphinOperation !== 'idle' && dolphinOperation !== 'running')
        }
      >
        <div className="row">
          <div className="row-text">
            <h3>Dolphin</h3>
            <p>
              {status.dolphin.version
                ? `GameCube · Version ${status.dolphin.version}`
                : 'GameCube · Official Universal build · Native Apple Silicon'}
            </p>
          </div>
          <button
            type="button"
            className={status.dolphin.version ? '' : 'primary'}
            disabled={emulatorBusy || !status.library?.available}
            onClick={() => {
              void operate('installing', () => window.mac.installDolphin());
            }}
          >
            {status.dolphin.version ? 'Update Dolphin' : 'Install Dolphin'}
          </button>
        </div>
        {operationMessage && (
          <div className="row progress" role="status">
            {showSpinner && <Spinner />}
            <p>{operationMessage}</p>
          </div>
        )}
        {status.dolphin.version && (
          <div className="row">
            <div className="row-text">
              <h3>Play a game</h3>
              <p>Add GameCube games to your library’s roms/gc folder.</p>
            </div>
            <button
              type="button"
              className="primary"
              disabled={emulatorBusy || !status.library?.available}
              onClick={() => {
                void operate('choosing-game', () => window.mac.playGame());
              }}
            >
              Choose Game…
            </button>
          </div>
        )}
      </section>
      {!status.library?.available && (
        <p className="footnote">
          Choose an available library in Library to continue.
        </p>
      )}
      <p className="footnote">
        Downloads come from Dolphin’s official release server. macOS verifies
        the application before it is installed.
      </p>
      {status.emulators.map((emulator) => {
        const busyHere = emulator.operation !== 'idle';
        const system = emulator.systems[0];
        const messages: Record<string, string> = {
          installing: `Installing ${emulator.name}… Downloading and verifying the application.`,
          launching: `Starting your game… macOS is verifying ${emulator.name}.`,
          running: `${emulator.name} is running. Quit the game to return here.`,
        };
        return (
          <section
            key={emulator.id}
            className="group"
            aria-label={`${emulator.name} management`}
            aria-busy={
              emulator.operation === 'installing' ||
              emulator.operation === 'launching'
            }
          >
            <div className="row">
              <div className="row-text">
                <h3>{emulator.name}</h3>
                <p>
                  {emulator.health === 'installed' &&
                    `${emulator.systemName} · Version ${emulator.version}`}
                  {emulator.health === 'damaged' &&
                    'Needs repair · Some application files are missing or changed'}
                  {emulator.health === 'missing' &&
                    `${emulator.systemName} · ${buildNotes[emulator.architecture]}`}
                </p>
              </div>
              {emulator.health !== 'installed' && (
                <button
                  type="button"
                  className="primary"
                  disabled={
                    emulatorBusy || busyHere || !status.library?.available
                  }
                  onClick={() => {
                    void operate('installing', () =>
                      window.mac.installEmulator(emulator.id),
                    );
                  }}
                >
                  {emulator.health === 'damaged'
                    ? `Repair ${emulator.name}`
                    : `Install ${emulator.name}`}
                </button>
              )}
            </div>
            {busyHere && (
              <div className="row progress" role="status">
                {emulator.operation !== 'running' && <Spinner />}
                <p>{messages[emulator.operation]}</p>
              </div>
            )}
            {emulator.health === 'installed' && (
              <div className="row">
                <div className="row-text">
                  <h3>Play a game</h3>
                  <p>
                    Add {emulator.systemName} games to your library’s roms/
                    {system} folder.
                  </p>
                </div>
                <button
                  type="button"
                  className="primary"
                  disabled={
                    emulatorBusy || busyHere || !status.library?.available
                  }
                  onClick={() => {
                    void operate('choosing-game', () =>
                      window.mac.playEmulator(emulator.id),
                    );
                  }}
                >
                  Choose Game…
                </button>
              </div>
            )}
          </section>
        );
      })}
      {status.dolphin.version && (
        <details className="advanced">
          <summary>Advanced</summary>
          <section className="group" aria-label="Advanced">
            <div className="row">
              <div className="row-text">
                <h3>Reset Dolphin settings</h3>
                <p>
                  Keeps games, memory cards, and save states. Existing settings
                  are kept in a backup folder.
                </p>
              </div>
              <button
                type="button"
                disabled={emulatorBusy || !status.library?.available}
                onClick={() => {
                  void operate('resetting', () => window.mac.resetDolphin());
                }}
              >
                Reset Dolphin Settings…
              </button>
            </div>
          </section>
        </details>
      )}
      <p className="footnote">
        Console Mode plays every system whose emulator is installed:{' '}
        {systemNames}.
      </p>
    </>
  );
}
