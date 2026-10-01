import { useEffect, useState } from 'react';
import type { MacAPI, MacStatus } from '../../shared/macos';

declare global {
  interface Window {
    mac: MacAPI;
  }
}
type Page = 'Library' | 'Emulators' | 'This Mac' | 'Development';
const icons: Record<Page, string> = {
  Library: 'M3 7V5h6l2 2h10v13H3V7Z',
  Emulators: 'M6 7h12l3 10-3 2-4-4h-4l-4 4-3-2L6 7Zm1 4h4m-2-2v4m7-3h.1m2 2h.1',
  'This Mac': 'M3 4h18v13H3V4ZM8 21h8m-4-4v4',
  Development: 'M8 5 2 12l6 7m8-14 6 7-6 7M14 3l-4 18',
};

export default function MacApp() {
  const [status, setStatus] = useState<MacStatus | null>(null);
  const [page, setPage] = useState<Page>('Library');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => {
    try {
      setStatus(await window.mac.getStatus());
    } catch {
      setError(
        'Could not read application status. Quit and reopen Emulation Workspace to try again.',
      );
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const choose = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await window.mac.chooseLibrary();
      if (!result.ok && !result.cancelled) setError(result.error);
      await refresh();
    } catch {
      setError(
        'The folder could not be selected. Your existing files have been preserved.',
      );
    } finally {
      setBusy(false);
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
    operation: () => Promise<{ ok: boolean; error?: string }>,
  ) => {
    setBusy(true);
    setError('');
    const timer = window.setInterval(() => {
      void refresh();
    }, 1000);
    try {
      const result = await operation();
      if (!result.ok)
        setError(result.error || 'The operation could not finish.');
    } catch {
      setError(
        'The operation could not finish. Your games and saves have been preserved.',
      );
    } finally {
      window.clearInterval(timer);
      setBusy(false);
      await refresh();
    }
  };
  const emulatorBusy =
    busy || Boolean(status && status.dolphin.operation !== 'idle');
  const chooseLabel = busy ? 'Choosing…' : 'Choose Folder…';
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
        <main id="main-content">
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {!status ? (
            <p role="status">Reading your Mac…</p>
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
                  >
                    <div className="setting-row">
                      <div>
                        <h2>Library location</h2>
                        <p className="path">
                          {status.library?.path || 'No folder selected'}
                        </p>
                      </div>
                      <button
                        type="button"
                        className={status.library ? '' : 'primary'}
                        disabled={busy}
                        onClick={() => {
                          void choose();
                        }}
                      >
                        {status.library && !busy ? 'Change…' : chooseLabel}
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
                    <p role="alert" className="error">
                      {status.libraryError}
                    </p>
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
                          void operate(() => window.mac.installDolphin());
                        }}
                      >
                        {status.dolphin.version
                          ? 'Check for Update'
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
                            void operate(() => window.mac.playGame());
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
                  {emulatorBusy && (
                    <p role="status" className="footnote">
                      {status.dolphin.operation === 'running'
                        ? 'Dolphin is running. Quit the game to return here.'
                        : 'Working… Downloads and macOS verification may take a few minutes.'}
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
                          void operate(() => window.mac.resetDolphin());
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
