import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useLayoutEffect,
} from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
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
const sections: { title: string; pages: Page[] }[] = [
  { title: 'Workspace', pages: ['Library', 'Emulators'] },
  { title: 'System', pages: ['This Mac', 'Development'] },
];
const pages = sections.flatMap((section) => section.pages);
const icons: Record<Page, string> = {
  Library: 'M3 7V5h6l2 2h10v13H3V7Z',
  Emulators: 'M6 7h12l3 10-3 2-4-4h-4l-4 4-3-2L6 7Zm1 4h4m-2-2v4m7-3h.1m2 2h.1',
  'This Mac': 'M3 4h18v13H3V4ZM8 21h8m-4-4v4',
  Development: 'M8 5 2 12l6 7m8-14 6 7-6 7M14 3l-4 18',
};

const symbolKeys: Record<Page, string> = {
  Library: 'library',
  Emulators: 'emulators',
  'This Mac': 'this-mac',
  Development: 'development',
};

/** Main masks this with the native SF Symbol when the Mac can render it. */
function Symbol({ page, fill }: { page: Page; fill: boolean }) {
  return (
    <span
      className="symbol"
      data-symbol={`${symbolKeys[page]}${fill ? '-fill' : ''}`}
      aria-hidden="true"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={icons[page]} />
      </svg>
    </span>
  );
}

/** System Settings–style pane header: tinted symbol tile, title and summary. */
function Hero({
  page,
  tint,
  title,
  children,
}: {
  page: Page;
  tint: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="group hero" aria-label={title}>
      <span className={`tile ${tint}`}>
        <Symbol page={page} fill />
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
    </section>
  );
}

function Caution() {
  return (
    <svg className="caution" viewBox="0 0 20 18" aria-hidden="true">
      <path d="M8.3 1.2a2 2 0 0 1 3.4 0l7.9 13.5A2 2 0 0 1 17.9 18H2.1a2 2 0 0 1-1.7-3.3L8.3 1.2Z" />
      <path className="mark" d="M10 5.5v6M10 14.2v.1" />
    </svg>
  );
}

/**
 * Finder-style middle truncation: keeps the volume/root and the meaningful end
 * of a path. The full path stays available as a tooltip and to VoiceOver.
 */
function MiddlePath({ value }: { value: string }) {
  const element = useRef<HTMLParagraphElement | null>(null);
  const [shown, setShown] = useState(value);
  useLayoutEffect(() => {
    const target = element.current;
    const context =
      typeof ResizeObserver === 'undefined' || !target
        ? null
        : document.createElement('canvas').getContext('2d');
    if (!target || !context) {
      setShown(value);
      return undefined;
    }
    const fit = () => {
      const style = getComputedStyle(target);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const width = target.clientWidth;
      if (!width || context.measureText(value).width <= width) {
        setShown(value);
        return;
      }
      const characters = Array.from(value);
      let low = 1;
      let high = characters.length - 1;
      let best = '…';
      while (low <= high) {
        const keep = Math.floor((low + high) / 2);
        const head = Math.ceil(keep * 0.4);
        const candidate = `${characters.slice(0, head).join('')}…${characters
          .slice(characters.length - (keep - head))
          .join('')}`;
        if (context.measureText(candidate).width <= width) {
          best = candidate;
          low = keep + 1;
        } else high = keep - 1;
      }
      setShown(best);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(target);
    return () => observer.disconnect();
  }, [value]);
  return (
    <p ref={element} className="path" title={value} aria-label={value}>
      {shown}
    </p>
  );
}

/** Indeterminate progress, drawn like NSProgressIndicator's spinning style. */
function Spinner() {
  return (
    <svg className="spinner" viewBox="0 0 16 16" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <rect
          // eslint-disable-next-line react/no-array-index-key -- Fixed decorative spokes.
          key={index}
          x="7.25"
          y="1"
          width="1.5"
          height="4"
          rx="0.75"
          transform={`rotate(${index * 45} 8 8)`}
          opacity={0.25 + (index / 8) * 0.75}
        />
      ))}
    </svg>
  );
}

export default function MacApp() {
  const [status, setStatus] = useState<MacStatus | null>(null);
  const [page, setPage] = useState<Page>('Library');
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [windowActive, setWindowActive] = useState(true);
  const [narrow, setNarrow] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const mounted = useRef(true);
  const mainContent = useRef<HTMLElement | null>(null);
  const errorMessage = useRef<HTMLDivElement | null>(null);
  const libraryErrorMessage = useRef<HTMLDivElement | null>(null);
  const navigation = useRef<HTMLElement | null>(null);
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
    const unsubscribe = window.mac.onRefreshStatus(() => {
      void refresh();
    });
    void refresh();
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [refresh]);
  useEffect(() => {
    // Inactive Mac windows dim their selection; mirror the key-window state.
    const activate = () => setWindowActive(true);
    const deactivate = () => setWindowActive(false);
    window.addEventListener('focus', activate);
    window.addEventListener('blur', deactivate);
    return () => {
      window.removeEventListener('focus', activate);
      window.removeEventListener('blur', deactivate);
    };
  }, []);
  useEffect(() => {
    // outerWidth is in window points, innerWidth in zoomed CSS pixels (frameless window).
    const measure = () => {
      const zoom =
        window.innerWidth > 0 ? window.outerWidth / window.innerWidth : 1;
      document.documentElement.style.setProperty(
        '--zoom',
        String(Number.isFinite(zoom) && zoom >= 1 ? zoom : 1),
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  useEffect(() => {
    // Like NSSplitView, a narrow window collapses the sidebar instead of shrinking it.
    const query = window.matchMedia?.('(max-width: 640px)');
    if (!query) return undefined;
    const update = () => {
      setNarrow(query.matches);
      if (!query.matches) setSidebarOpen(false);
    };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const visibleError = error || statusError;
  const visibleLibraryError =
    page === 'Library' ? status?.libraryError || '' : '';
  useEffect(() => {
    const alert = visibleError
      ? errorMessage.current
      : libraryErrorMessage.current;
    const main = mainContent.current;
    if (!(visibleError || visibleLibraryError) || !alert || !main) return;
    const bounds = alert.getBoundingClientRect();
    const viewport = main.getBoundingClientRect();
    if (bounds.top < viewport.top || bounds.bottom > viewport.bottom)
      main.scrollTop = Math.max(0, main.scrollTop + bounds.top - viewport.top);
  }, [visibleError, visibleLibraryError]);
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
  const select = (item: Page) => {
    if (page !== item && mainContent.current) mainContent.current.scrollTop = 0;
    setPage(item);
    setError('');
    if (narrow) setSidebarOpen(false);
    // Keep keyboard focus on the selection when the list already had focus.
    if (navigation.current?.contains(document.activeElement))
      requestAnimationFrame(() =>
        navigation.current
          ?.querySelector<HTMLButtonElement>(`[data-page="${item}"]`)
          ?.focus(),
      );
  };
  // A source list is one tab stop; arrow keys move the selection (NSOutlineView).
  const navigateWithKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    const offsets: Record<string, number> = { ArrowUp: -1, ArrowDown: 1 };
    let next: number | undefined;
    if (event.key in offsets)
      next = Math.min(
        pages.length - 1,
        Math.max(0, pages.indexOf(page) + offsets[event.key]),
      );
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = pages.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    select(pages[next]);
    navigation.current
      ?.querySelector<HTMLButtonElement>(`[data-page="${pages[next]}"]`)
      ?.focus();
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
  const showSpinner =
    Boolean(operationMessage) &&
    dolphinOperation !== 'running' &&
    action !== 'choosing-game';
  return (
    <div
      className="workspace"
      data-ready={status ? 'true' : 'false'}
      data-window-active={windowActive ? 'true' : 'false'}
      data-sidebar={narrow && !sidebarOpen ? 'collapsed' : 'shown'}
    >
      <aside
        id="sidebar"
        className="sidebar"
        aria-label="Workspace navigation"
        hidden={narrow && !sidebarOpen}
      >
        <nav ref={navigation}>
          {sections.map((section) => (
            <div className="sidebar-section" key={section.title}>
              <div className="sidebar-title" aria-hidden="true">
                {section.title}
              </div>
              {section.pages.map((item) => (
                <button
                  type="button"
                  key={item}
                  data-page={item}
                  tabIndex={page === item ? 0 : -1}
                  aria-current={page === item ? 'page' : undefined}
                  onClick={() => select(item)}
                  onKeyDown={navigateWithKeys}
                >
                  <span className="nav-symbol" aria-hidden="true">
                    <Symbol page={item} fill={false} />
                  </span>
                  {item}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="detail">
        <header className="toolbar">
          {narrow && (
            <button
              type="button"
              className="icon-button"
              aria-label={sidebarOpen ? 'Hide Sidebar' : 'Show Sidebar'}
              title={sidebarOpen ? 'Hide Sidebar' : 'Show Sidebar'}
              aria-expanded={sidebarOpen}
              aria-controls="sidebar"
              onClick={() => setSidebarOpen((open) => !open)}
            >
              <span className="symbol" data-symbol="sidebar">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                >
                  <rect x="3" y="5" width="18" height="14" rx="3" />
                  <path d="M9 5v14" />
                </svg>
              </span>
            </button>
          )}
          <h1>{page}</h1>
          <button
            type="button"
            onClick={() => {
              void refresh();
            }}
            aria-label="Refresh status"
            title="Refresh status"
            className="icon-button"
          >
            <span className="symbol" data-symbol="refresh">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              >
                <path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6" />
              </svg>
            </span>
          </button>
        </header>
        <main
          id="main-content"
          ref={mainContent}
          aria-busy={!status && !statusError}
        >
          <div className="pane">
            {visibleError && (
              <div ref={errorMessage} className="group" role="alert">
                <div className="row alert">
                  <Caution />
                  <p>{visibleError}</p>
                </div>
              </div>
            )}
            {!status ? (
              !statusError && (
                <p role="status" className="loading">
                  <Spinner />
                  Reading your Mac…
                </p>
              )
            ) : (
              <>
                {page === 'Library' && (
                  <>
                    <Hero
                      page="Library"
                      tint="blue"
                      title={
                        status.library ? 'Your Library' : 'Set Up Your Library'
                      }
                    >
                      Choose a folder on your Mac or an external drive for your
                      emulation library.
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
                              {status.library?.path
                                .split('/')
                                .filter(Boolean)
                                .pop() || 'Library location'}
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
                          className={
                            status.library || status.libraryError
                              ? ''
                              : 'primary'
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
                          <p className="recovery-message">
                            {status.libraryError}
                          </p>
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
                      Choosing a folder saves its location. Your games and saves
                      stay where they are.
                    </p>
                    {status.library?.available && !status.dolphin.version && (
                      <p className="footnote">
                        Next, open Emulators to install Dolphin for GameCube.
                      </p>
                    )}
                  </>
                )}
                {page === 'Emulators' && (
                  <>
                    <Hero page="Emulators" tint="indigo" title="Emulators">
                      Dolphin brings GameCube games and homebrew to your Mac.
                      Add your own legally obtained games.
                    </Hero>
                    <section
                      className="group"
                      aria-label="Dolphin management"
                      aria-busy={
                        busy ||
                        (dolphinOperation !== 'idle' &&
                          dolphinOperation !== 'running')
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
                            <p>
                              Add GameCube games to your library’s roms/gc
                              folder.
                            </p>
                          </div>
                          <button
                            type="button"
                            className="primary"
                            disabled={
                              emulatorBusy || !status.library?.available
                            }
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
                    <p className="footnote">
                      Downloads come from Dolphin’s official release server.
                      macOS verifies the application before it is installed.
                    </p>
                    {status.dolphin.version && (
                      <details className="advanced">
                        <summary>Advanced</summary>
                        <section className="group" aria-label="Advanced">
                          <div className="row">
                            <div className="row-text">
                              <h3>Reset Dolphin settings</h3>
                              <p>
                                Keeps games, memory cards, and save states.
                                Existing settings are kept in a backup folder.
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={
                                emulatorBusy || !status.library?.available
                              }
                              onClick={() => {
                                void operate('resetting', () =>
                                  window.mac.resetDolphin(),
                                );
                              }}
                            >
                              Reset Dolphin Settings…
                            </button>
                          </div>
                        </section>
                      </details>
                    )}
                    <p className="footnote">
                      Console Mode and controller configuration are still in
                      development.
                    </p>
                  </>
                )}
                {page === 'This Mac' && (
                  <>
                    <Hero page="This Mac" tint="gray" title="This Mac">
                      Capabilities reported by this Mac. Emulator settings are
                      chosen from these, not from the model name.
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
                    <Hero
                      page="Development"
                      tint="orange"
                      title="Development Status"
                    >
                      This preview establishes the macOS foundation. It is not
                      ready to manage a game collection.
                    </Hero>
                    <dl className="group facts">
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
                      Independent development project. Not an official EmuDeck
                      or RetroDECK product.
                    </p>
                  </>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
