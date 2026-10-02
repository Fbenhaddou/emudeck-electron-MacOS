import { useCallback, useEffect, useRef, useState } from 'react';
import type { MacAPI, MacStatus } from '../../shared/macos';

declare global {
  interface Window {
    mac: MacAPI;
  }
}
type Page = 'Library' | 'Emulators' | 'This Mac' | 'Development';
type Action =
  | 'choosing-library'
  | 'recovering-library'
  | 'installing'
  | 'choosing-game'
  | 'resetting';
const icons: Record<Page, string> = {
  Library: 'M3 7V5h6l2 2h10v13H3V7Z',
  Emulators: 'M6 7h12l3 10-3 2-4-4h-4l-4 4-3-2L6 7Zm1 4h4m-2-2v4m7-3h.1m2 2h.1',
  'This Mac': 'M3 4h18v13H3V4ZM8 21h8m-4-4v4',
  Development: 'M8 5 2 12l6 7m8-14 6 7-6 7M14 3l-4 18',
};

export default function MacApp() {
  const [status, setStatus] = useState<MacStatus | null>(null);
  const [page, setPage] = useState<Page>('Library');
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const mounted = useRef(true);
  const mainContent = useRef<HTMLElement | null>(null);
  const statusRequest = useRef<Promise<void> | null>(null);
  const refresh = useCallback(() => {
    if (statusRequest.current) return statusRequest.current;
    const request = Promise.resolve()
      .then(() => window.mac.getStatus())
      .then((nextStatus) => {
        if (mounted.current) {
          setStatus(nextStatus);
          setStatusError('');
        }
        return undefined;
      })
      .catch(() => {
        if (mounted.current)
          setStatusError(
            'Could not read application status. Refresh to try again.',
          );
      })
      .finally(() => {
        statusRequest.current = null;
      });
    statusRequest.current = request;
    return request;
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);
  const busy = action !== null;
  const dolphinOperation = status?.dolphin.operation || 'idle';
  useEffect(() => {
    if (!busy && dolphinOperation === 'idle') return undefined;
    let cancelled = false;
    let timer: number;
    const poll = async () => {
      await refresh();
      if (!cancelled) timer = window.setTimeout(poll, 1000);
    };
    timer = window.setTimeout(poll, 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [busy, dolphinOperation, refresh]);
  const refreshAfterAction = async () => {
    // A poll started before a mutation may contain the previous library/version.
    if (statusRequest.current) await statusRequest.current;
    await refresh();
  };
  const choose = async () => {
    setAction('choosing-library');
    setError('');
    try {
      const result = await window.mac.chooseLibrary();
      if (!result.ok && !result.cancelled) setError(result.error);
      await refreshAfterAction();
    } catch {
      setError(
        'The folder could not be selected. Your existing files have been preserved.',
      );
    } finally {
      setAction(null);
    }
  };
  const reveal = async () => {
    try {
      const result = await window.mac.revealLibrary();
      if (!result.ok) setError(result.error);
    } catch {
      setError(
        'Finder could not open the library. Reconnect its drive and try again.',
      );
    }
  };
  const operate = async (
    nextAction: Action,
    operation: () => Promise<{ ok: boolean; error?: string }>,
  ) => {
    setAction(nextAction);
    setError('');
    try {
      const result = await operation();
      if (!result.ok)
        setError(result.error || 'The operation could not finish.');
    } catch {
      setError(
        'The operation could not finish. Your games and saves have been preserved.',
      );
    } finally {
      await refreshAfterAction();
      setAction(null);
    }
  };
  const emulatorBusy =
    busy || Boolean(status && status.dolphin.operation !== 'idle');
  const choosingLibrary = action === 'choosing-library';
  const chooseLabel = choosingLibrary ? 'Choosing…' : 'Choose Folder…';
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
  let operationMessage = '';
  if (dolphinOperation !== 'idle')
    operationMessage = operationMessages[dolphinOperation];
  else if (action === 'installing' || action === 'resetting')
    operationMessage = operationMessages[action];
  else if (action === 'choosing-game')
    operationMessage = 'Choose a game in the file dialog.';
  return (
    <div className="workspace" data-ready={status ? 'true' : 'false'}>
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="sidebar-title">Emulation Workspace</div>
        <nav>
          {(['Library', 'Emulators', 'This Mac', 'Development'] as Page[]).map(
            (item) => (
              <button
                type="button"
                key={item}
                aria-current={page === item ? 'page' : undefined}
                onClick={() => {
                  if (page !== item && mainContent.current)
                    mainContent.current.scrollTop = 0;
                  setPage(item);
                  setError('');
                }}
              >
                <span className="nav-symbol" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={icons[item]} />
                  </svg>
                </span>
                {item}
              </button>
            ),
          )}
        </nav>
        <div className="sidebar-footer">
          Development Preview
          <br />
          <span>Built on EmuDeck</span>
        </div>
      </aside>
      <div className="detail">
        <header className="toolbar">
          <strong>{page}</strong>
          <button
            type="button"
            onClick={() => {
              void refresh();
            }}
            aria-label="Refresh status"
            title="Refresh status"
            className="icon-button"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6" />
            </svg>
          </button>
        </header>
        <main
          id="main-content"
          ref={mainContent}
          aria-busy={!status && !statusError}
        >
          {(error || statusError) && (
            <div className="error" role="alert">
              {error || statusError}
            </div>
          )}
          {!status ? (
            !statusError && <p role="status">Reading your Mac…</p>
          ) : (
            <>
              {page === 'Library' && (
                <>
                  <h1>
                    {status.library ? 'Your Library' : 'Set Up Your Library'}
                  </h1>
                  <p className="intro">
                    Choose a folder on your Mac or an external drive for your
                    emulation library.
                  </p>
                  <section
                    className="settings-group"
                    aria-label="Library location"
                    aria-busy={choosingLibrary}
                  >
                    <div className="setting-row">
                      <div>
                        <h2>Library location</h2>
                        <p className="path" title={status.library?.path}>
                          {status.library?.path || 'No folder selected'}
                        </p>
                      </div>
                      <button
                        type="button"
                        className={
                          status.library || status.libraryError ? '' : 'primary'
                        }
                        disabled={
                          busy ||
                          dolphinOperation !== 'idle' ||
                          Boolean(status.libraryError)
                        }
                        onClick={() => {
                          void choose();
                        }}
                      >
                        {status.library && !choosingLibrary
                          ? 'Change…'
                          : chooseLabel}
                      </button>
                    </div>
                    {status.library && (
                      <div className="setting-row">
                        <div>
                          <h2>
                            {status.library.available
                              ? 'Folder available'
                              : 'Folder unavailable'}
                          </h2>
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
                  </section>
                  {status.libraryError && (
                    <div
                      role="alert"
                      className="error"
                      aria-busy={action === 'recovering-library'}
                    >
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
                  <p className="footnote">
                    Choosing a folder saves its location. Your games and saves
                    stay where they are.
                  </p>
                  <p className="preview-note">
                    Select Emulators to install Dolphin for GameCube.
                  </p>
                </>
              )}
              {page === 'Emulators' && (
                <>
                  <h1>Emulators</h1>
                  <p className="intro">
                    Dolphin brings GameCube games and homebrew to your Mac. Add
                    your own legally obtained games.
                  </p>
                  <section
                    className="settings-group"
                    aria-label="Dolphin management"
                    aria-busy={
                      busy ||
                      (dolphinOperation !== 'idle' &&
                        dolphinOperation !== 'running')
                    }
                  >
                    <div className="setting-row">
                      <div>
                        <h2>Dolphin · GameCube</h2>
                        <p>
                          {status.dolphin.version
                            ? `Version ${status.dolphin.version} installed`
                            : 'Official Universal build · Native Apple Silicon'}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="primary"
                        disabled={emulatorBusy || !status.library?.available}
                        onClick={() => {
                          void operate('installing', () =>
                            window.mac.installDolphin(),
                          );
                        }}
                      >
                        {status.dolphin.version
                          ? 'Update Dolphin'
                          : 'Install Dolphin'}
                      </button>
                    </div>
                    {status.dolphin.version && (
                      <div className="setting-row">
                        <div>
                          <h2>Play a game</h2>
                          <p>
                            Add GameCube games to your library’s roms/gc folder.
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={emulatorBusy || !status.library?.available}
                          onClick={() => {
                            void operate('choosing-game', () =>
                              window.mac.playGame(),
                            );
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
                  {operationMessage && (
                    <p role="status" className="footnote">
                      {operationMessage}
                    </p>
                  )}
                  <p className="footnote">
                    Downloads come from Dolphin’s official release server. macOS
                    verifies the application before it is installed.
                  </p>
                  {status.dolphin.version && (
                    <details className="advanced">
                      <summary>Advanced</summary>
                      <p>
                        Reset emulator settings while keeping games, memory
                        cards, and save states. Existing settings are kept in a
                        backup folder.
                      </p>
                      <button
                        type="button"
                        disabled={emulatorBusy || !status.library?.available}
                        onClick={() => {
                          void operate('resetting', () =>
                            window.mac.resetDolphin(),
                          );
                        }}
                      >
                        Reset Dolphin Settings…
                      </button>
                    </details>
                  )}
                  <p className="preview-note">
                    Console Mode and controller configuration are still in
                    development.
                  </p>
                </>
              )}
              {page === 'This Mac' && (
                <>
                  <h1>This Mac</h1>
                  <p className="intro">Capabilities reported by this Mac.</p>
                  <dl className="facts">
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
                          {display.width} × {display.height} points ·{' '}
                          {display.scaleFactor}×
                          {display.refreshRate
                            ? ` · ${display.refreshRate} Hz`
                            : ''}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="footnote">
                    HDR and advanced controller capabilities have not been
                    verified.
                  </p>
                </>
              )}
              {page === 'Development' && (
                <>
                  <h1>Development Status</h1>
                  <p className="intro">
                    This preview establishes the macOS foundation. It is not
                    ready to manage a game collection.
                  </p>
                  <dl className="facts">
                    <div>
                      <dt>Library selection</dt>
                      <dd>Available</dd>
                    </div>
                    <div>
                      <dt>Dolphin installation</dt>
                      <dd>Preview</dd>
                    </div>
                    <div>
                      <dt>Console Mode · ES-DE</dt>
                      <dd>Planned</dd>
                    </div>
                    <div>
                      <dt>Controller support</dt>
                      <dd>Not tested</dd>
                    </div>
                    <div>
                      <dt>Signed distribution</dt>
                      <dd>Not configured</dd>
                    </div>
                  </dl>
                  <p className="footnote">
                    Independent development project. Not an official EmuDeck or
                    RetroDECK product.
                  </p>
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
