/* eslint-disable react/jsx-props-no-spreading -- Every page receives the same shared window state (PageProps). */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type {
  ControllersStatus,
  LibraryOverview,
  MacAPI,
  MacStatus,
} from '../../shared/macos';
import { Caution, pages, sections, Spinner, Symbol } from './controls';
import type { Page } from './controls';
import ConsolePage from './pages/ConsolePage';
import ControllersPage from './pages/ControllersPage';
import DevelopmentPage from './pages/DevelopmentPage';
import EmulatorsPage from './pages/EmulatorsPage';
import FirmwarePage from './pages/FirmwarePage';
import LibraryPage from './pages/LibraryPage';
import ThisMacPage from './pages/ThisMacPage';
import type { Action, PageProps } from './pages/types';

declare global {
  interface Window {
    mac: MacAPI;
  }
}
export default function MacApp() {
  const [status, setStatus] = useState<MacStatus | null>(null);
  const [page, setPage] = useState<Page>('Library');
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [windowActive, setWindowActive] = useState(true);
  const [controllers, setControllers] = useState<ControllersStatus | null>(
    null,
  );
  const [overview, setOverview] = useState<LibraryOverview | null>(null);
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
  const refreshControllers = useCallback(async () => {
    try {
      const next = await window.mac.getControllers();
      if (mounted.current) setControllers(next);
    } catch {
      /* The page keeps its last known state. */
    }
  }, []);
  const refreshOverview = useCallback(async () => {
    try {
      const next = await window.mac.getLibraryOverview();
      if (mounted.current) setOverview(next);
    } catch {
      /* The page keeps its last known state. */
    }
  }, []);
  const libraryPath = status?.library?.path;
  const libraryAvailable = status?.library?.available;
  const installedEmulators = `${status?.dolphin.version}|${status?.emulators
    ?.map((item) => item.version)
    .join()}`;
  useEffect(() => {
    // Counts change when games are added in Finder; re-read on every visit.
    if (page !== 'Library' && page !== 'Firmware') return;
    void refreshOverview();
  }, [
    page,
    libraryPath,
    libraryAvailable,
    installedEmulators,
    refreshOverview,
  ]);
  useEffect(() => {
    // Only while visible: plugging in a controller or battery changes appear live.
    if (page !== 'Controllers') return undefined;
    void refreshControllers();
    const timer = window.setInterval(() => {
      void refreshControllers();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [page, refreshControllers]);
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
  const pinnedBusy = Boolean(
    status?.emulators?.some((item) => item.operation !== 'idle'),
  );
  useEffect(() => {
    if (
      !busy &&
      dolphinOperation === 'idle' &&
      (status?.console.state || 'idle') === 'idle' &&
      !pinnedBusy
    )
      return undefined;
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
  }, [busy, dolphinOperation, pinnedBusy, status?.console.state, refresh]);
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
  const addFirmware = async (id: string) => {
    await operate('adding-firmware', () => window.mac.addFirmware(id));
    await refreshOverview();
  };
  const revealSystem = async (id: string) => {
    try {
      const result = await window.mac.revealSystem(id);
      if (!result.ok) setError(result.error);
    } catch {
      setError(
        'Finder could not open the folder. Reconnect your library drive and try again.',
      );
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
    busy ||
    Boolean(status && status.dolphin.operation !== 'idle') ||
    Boolean(status?.emulators.some((item) => item.operation !== 'idle'));
  const consoleBusy = (status?.console.state || 'idle') !== 'idle';
  const props: PageProps | null = status && {
    status,
    action,
    busy,
    emulatorBusy,
    consoleBusy,
    operate,
  };
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
            {!props ? (
              !statusError && (
                <p role="status" className="loading">
                  <Spinner />
                  Reading your Mac…
                </p>
              )
            ) : (
              <>
                {page === 'Library' && (
                  <LibraryPage
                    {...props}
                    overview={overview}
                    choose={choose}
                    reveal={reveal}
                    revealSystem={revealSystem}
                    libraryErrorMessage={libraryErrorMessage}
                  />
                )}
                {page === 'Firmware' && (
                  <FirmwarePage
                    {...props}
                    overview={overview}
                    addFirmware={addFirmware}
                  />
                )}
                {page === 'Emulators' && <EmulatorsPage {...props} />}
                {page === 'Console Mode' && <ConsolePage {...props} />}
                {page === 'Controllers' && (
                  <ControllersPage
                    {...props}
                    setError={setError}
                    controllers={controllers}
                    setControllers={setControllers}
                    refreshControllers={refreshControllers}
                  />
                )}
                {page === 'This Mac' && <ThisMacPage {...props} />}
                {page === 'Development' && <DevelopmentPage />}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
