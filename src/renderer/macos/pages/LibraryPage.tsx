import type { MutableRefObject } from 'react';
import type { LibraryOverview } from '../../../shared/macos';
import { Caution, Hero, MiddlePath } from '../controls';
import type { PageProps } from './types';

export default function LibraryPage({
  status,
  action,
  busy,
  emulatorBusy,
  operate,
  overview,
  choose,
  reveal,
  revealSystem,
  libraryErrorMessage,
}: PageProps & {
  overview: LibraryOverview | null;
  choose: () => Promise<void>;
  reveal: () => Promise<void>;
  revealSystem: (id: string) => Promise<void>;
  libraryErrorMessage: MutableRefObject<HTMLDivElement | null>;
}) {
  const dolphinOperation = status.dolphin.operation;
  const choosingLibrary = action === 'choosing-library';
  const chooseLabel = choosingLibrary ? 'Choosing…' : 'Choose Folder…';
  return (
    <>
      <Hero
        page="Library"
        tint="blue"
        title={status.library ? 'Your Library' : 'Set Up Your Library'}
      >
        Choose a folder on your Mac or an external drive for your emulation
        library.
      </Hero>
      <section
        className="group"
        aria-label="Library location"
        aria-busy={choosingLibrary}
      >
        <div className="row">
          <div className="row-text">
            <h3>
              <span className="title">
                {status.library?.path.split('/').filter(Boolean).pop() ||
                  'Library location'}
              </span>
            </h3>
            {status.library ? (
              <MiddlePath value={status.library.path} />
            ) : (
              <p className="path">No folder selected</p>
            )}
          </div>
          <button
            type="button"
            className={status.library || status.libraryError ? '' : 'primary'}
            disabled={
              busy ||
              dolphinOperation !== 'idle' ||
              Boolean(status.libraryError)
            }
            onClick={() => {
              void choose();
            }}
          >
            {status.library && !choosingLibrary ? 'Change…' : chooseLabel}
          </button>
        </div>
        {status.library && (
          <div className="row">
            <div className="row-text">
              <h3>
                <span
                  className={`indicator ${status.library.available ? 'on' : 'off'}`}
                  aria-hidden="true"
                />
                <span className="title">
                  {status.library.available
                    ? 'Folder available'
                    : 'Folder unavailable'}
                </span>
              </h3>
              <p>
                {status.library.available
                  ? 'Your library location is saved on this Mac.'
                  : 'Reconnect your drive, then refresh to check again.'}
              </p>
            </div>
            <button
              type="button"
              disabled={!status.library.available}
              onClick={() => {
                void reveal();
              }}
            >
              Show in Finder
            </button>
          </div>
        )}
        {status.libraryError && (
          <div
            ref={libraryErrorMessage}
            role="alert"
            className="row alert"
            aria-busy={action === 'recovering-library'}
          >
            <Caution />
            <p className="recovery-message">{status.libraryError}</p>
            <button
              type="button"
              className="primary"
              disabled={emulatorBusy}
              onClick={() => {
                void operate('recovering-library', () =>
                  window.mac.recoverLibrarySettings(),
                );
              }}
            >
              {action === 'recovering-library'
                ? 'Recovering…'
                : 'Recover Library Settings…'}
            </button>
          </div>
        )}
      </section>
      <p className="footnote">
        Choosing a folder saves its location. Your games and saves stay where
        they are.
      </p>
      {status.library?.available && !status.dolphin.version && (
        <p className="footnote">
          Next, open Emulators to install Dolphin for GameCube.
        </p>
      )}
      {overview?.available && overview.systems.length > 0 && (
        <>
          <h2 className="group-heading">Systems</h2>
          <section className="group" aria-label="Systems">
            {overview.systems.map((system) => (
              <div className="row" key={system.id}>
                <div className="row-text">
                  <h3>
                    <span className="title">{system.name}</span>
                  </h3>
                  <p>
                    {system.games === 1 ? '1 game' : `${system.games} games`}
                    {' · '}
                    {system.installed
                      ? `Plays with ${system.emulator}`
                      : `Install ${system.emulator} in Emulators to play`}
                  </p>
                  <p className="path">{system.folder}</p>
                </div>
                <button
                  type="button"
                  aria-label={`Show ${system.name} games folder in Finder`}
                  onClick={() => {
                    void revealSystem(system.id);
                  }}
                >
                  Show in Finder
                </button>
              </div>
            ))}
          </section>
          <p className="footnote">
            Put games directly in each system’s folder. Counts update when you
            return to this page.
          </p>
        </>
      )}
    </>
  );
}
