import path from 'path';
import type { ChildProcess, SpawnOptions } from 'child_process';
import type { Catalog, CatalogEntry } from '../components/es-de/catalog';
import type { PublishedProfile } from '../components/es-de/profile';
import type { FocusOutcome } from './focus';

/* eslint-disable no-unused-vars -- Names document the injected contracts. */
export interface ConsoleGame {
  /** Canonical absolute ROM path inside the library. */
  path: string;
  /** Path relative to the library root, '/' separated. */
  relativePath: string;
  name: string;
}

export interface ConsoleFrontend {
  bundle: string;
  executable: string;
}

export interface GameRunner {
  readonly isBusy: boolean;
  launchAndWait(
    library: string,
    game: string,
    presentation: 'console',
  ): Promise<{ code: number | null; signal: string | null }>;
}

export interface ConsoleDependencies {
  /** Verified managed ES-DE installation, or null when not installed. */
  frontend(): Promise<ConsoleFrontend | null>;
  listGames(library: string): Promise<ConsoleGame[]>;
  gameID(library: string, game: ConsoleGame): Promise<string>;
  /** Private ASCII runtime root containing a verified copy of the wait client. */
  makeRuntime(): Promise<string>;
  removeRuntime(root: string): Promise<void>;
  createCatalog(root: string, entries: CatalogEntry[]): Promise<Catalog>;
  publishProfile(
    home: string,
    catalog: Catalog,
    entries: CatalogEntry[],
  ): Promise<PublishedProfile>;
  startBroker(
    root: string,
    ids: ReadonlySet<string>,
    launch: (
      id: string,
    ) => Promise<{ code: number | null; signal: string | null }>,
  ): Promise<{ close(): Promise<void> }>;
  restoreFocus(pid: number, bundle: string): Promise<FocusOutcome>;
  /** PIDs running the managed frontend executable that this session did not start. */
  strayFrontends(executable: string): Promise<number[]>;
  terminate(pid: number): void;
  spawn(
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ): ChildProcess;
  hideManager(): void;
  showManager(): void;
  delay(milliseconds: number): Promise<void>;
}
/* eslint-enable no-unused-vars */

export type ConsoleState = 'idle' | 'starting' | 'running' | 'stopping';

export interface ConsoleReport {
  /** How the last session ended, shown in Management Mode afterwards. */
  frontendExit: { code: number | null; signal: string | null } | null;
  focus: FocusOutcome[];
  /** Focus outcome when the frontend first opened. */
  startFocus: FocusOutcome | null;
  games: number;
  error: string | null;
}

const failure = (message: string) => Object.assign(new Error(message));

/**
 * Console Mode lifecycle: idle → starting → running → stopping → idle.
 * ES-DE runs from a persistent isolated profile; game launches arrive through the
 * authenticated broker and run under the component manager's exclusive lock. After
 * each game exits, the frontend is brought back to the front before ES-DE is told
 * the game finished, because an unfocused ES-DE ignores controller input.
 */
export class ConsoleSession {
  private current: ConsoleState = 'idle';

  private frontendChild: ChildProcess | null = null;

  private activeGame: Promise<unknown> | null = null;

  private lastReport: ConsoleReport | null = null;

  // eslint-disable-next-line no-useless-constructor -- Parameter properties.
  constructor(
    private readonly profileHome: string,
    private readonly runner: GameRunner,
    private readonly dependencies: ConsoleDependencies,
    private readonly onChange: () => void = () => undefined,
  ) {
    /* Parameter properties own initialization. */
  }

  get state(): ConsoleState {
    return this.current;
  }

  get report(): ConsoleReport | null {
    return this.lastReport;
  }

  get isActive(): boolean {
    return this.current !== 'idle';
  }

  async enter(library: string): Promise<void> {
    if (this.current !== 'idle') throw failure('Console Mode is already open');
    if (this.runner.isBusy)
      throw failure(
        'Finish the current emulator task before opening Console Mode',
      );
    this.current = 'starting';
    this.onChange();
    const deps = this.dependencies;
    let runtime: string | null = null;
    let broker: { close(): Promise<void> } | null = null;
    const report: ConsoleReport = {
      frontendExit: null,
      focus: [],
      startFocus: null,
      games: 0,
      error: null,
    };
    try {
      const frontend = await deps.frontend();
      if (!frontend) throw failure('Install ES-DE before opening Console Mode');
      // A frontend relaunched by macOS after a crash runs without isolation.
      (await deps.strayFrontends(frontend.executable)).forEach((pid) =>
        deps.terminate(pid),
      );
      const games = await deps.listGames(library);
      const byID = new Map<string, string>();
      const entries: CatalogEntry[] = [];
      // eslint-disable-next-line no-restricted-syntax -- Bounded sequential identity derivation.
      for (const game of games) {
        // eslint-disable-next-line no-await-in-loop
        const id = await deps.gameID(library, game);
        if (!byID.has(id)) {
          byID.set(id, game.path);
          entries.push({ id, name: game.name });
        }
      }
      report.games = entries.length;
      runtime = await deps.makeRuntime();
      const catalog = await deps.createCatalog(runtime, entries);
      const profile = await deps.publishProfile(
        this.profileHome,
        catalog,
        entries,
      );
      broker = await deps.startBroker(runtime, new Set(byID.keys()), (id) =>
        this.play(library, frontend, byID.get(id), report),
      );
      const child = deps.spawn(
        frontend.executable,
        [
          '--home',
          profile.home,
          '--no-splash',
          '--no-update-check',
          '--gamelist-only',
          // The only frontend configuration that has passed the real lifecycle
          // gate; an earlier VSync-enabled start stalled in SDL's VSync wait.
          '--vsync',
          '0',
        ],
        {
          cwd: frontend.bundle,
          shell: false,
          stdio: 'ignore',
          env: {
            PATH: '/usr/bin:/bin',
            HOME: profile.home,
            ESDE_APPDATA_DIR: profile.appData,
            TMPDIR: process.env.TMPDIR || '/tmp',
            LANG: 'en_US.UTF-8',
          },
        },
      );
      this.frontendChild = child;
      const started = new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      const ownedRuntime = runtime;
      const ownedBroker = broker;
      child.once('exit', (code, signal) => {
        // A failed start already cleaned up; never release a newer session.
        if (this.frontendChild !== child) return;
        report.frontendExit = { code, signal };
        void this.finish(ownedRuntime, ownedBroker, report);
      });
      await started;
      this.current = 'running';
      deps.hideManager();
      this.onChange();
      // Hiding the manager hands focus to whatever macOS picks next, not to the
      // frontend (observed: another app stayed frontmost). An unfocused ES-DE
      // ignores controller input, so bring it forward once its window exists.
      report.startFocus = await this.focusFrontend(child, frontend.bundle);
    } catch (error) {
      report.error =
        error instanceof Error ? error.message : 'Console Mode could not start';
      this.frontendChild = null;
      await broker?.close().catch(() => undefined);
      if (runtime) await deps.removeRuntime(runtime).catch(() => undefined);
      this.lastReport = report;
      this.current = 'idle';
      this.onChange();
      throw error;
    }
  }

  private async focusFrontend(
    child: ChildProcess,
    bundle: string,
  ): Promise<FocusOutcome | null> {
    let outcome: FocusOutcome | null = null;
    // eslint-disable-next-line no-restricted-syntax -- Bounded sequential retries.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null)
        return outcome;
      // eslint-disable-next-line no-await-in-loop -- The window appears asynchronously.
      outcome = await this.dependencies.restoreFocus(child.pid, bundle);
      if (outcome === 'frontmost' || outcome === 'refused') return outcome;
      // eslint-disable-next-line no-await-in-loop
      await this.dependencies.delay(500);
    }
    return outcome;
  }

  private async play(
    library: string,
    frontend: ConsoleFrontend,
    rom: string | undefined,
    report: ConsoleReport,
  ) {
    if (!rom || this.current !== 'running')
      throw failure('Console Mode is not ready');
    const game = this.runner.launchAndWait(library, rom, 'console');
    this.activeGame = game;
    try {
      const result = await game;
      const pid = this.frontendChild?.pid;
      if (
        pid &&
        this.frontendChild?.exitCode === null &&
        this.frontendChild?.signalCode === null
      )
        report.focus.push(
          await this.dependencies.restoreFocus(pid, frontend.bundle),
        );
      return result;
    } finally {
      this.activeGame = null;
    }
  }

  /** Never kill a save-writing game: wait for it, then release everything. */
  private async finish(
    runtime: string,
    broker: { close(): Promise<void> },
    report: ConsoleReport,
  ): Promise<void> {
    this.current = 'stopping';
    this.onChange();
    try {
      if (this.activeGame) await this.activeGame.catch(() => undefined);
      await broker.close().catch(() => undefined);
      await this.dependencies.removeRuntime(runtime).catch(() => undefined);
    } finally {
      this.frontendChild = null;
      const exit = report.frontendExit;
      if (exit && (exit.code !== 0 || exit.signal))
        report.error =
          'Console Mode closed unexpectedly. Your games and saves are unchanged.';
      this.lastReport = report;
      this.current = 'idle';
      this.dependencies.showManager();
      this.onChange();
    }
  }

  /** Quit request from Management Mode; refused while a game is running. */
  stop(): boolean {
    const child = this.frontendChild;
    if (this.current !== 'running' || !child || this.activeGame) return false;
    child.kill('SIGTERM');
    return true;
  }
}

export function relativeGamePath(library: string, file: string): string {
  return path.relative(library, file).split(path.sep).join('/');
}
