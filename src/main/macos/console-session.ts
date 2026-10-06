/* eslint max-classes-per-file: ["error", 2] -- A tiny user-facing error marker lives with its only user. */
import path from 'path';
import type { ChildProcess, SpawnOptions } from 'child_process';
import type { Catalog, CatalogEntry } from '../components/es-de/catalog';
import type { PublishedProfile } from '../components/es-de/profile';
import { activateUntilHeld } from './focus';
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
  forceStop(): boolean;
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
  /** Reports a long controller exit hold, even while an emulator is frontmost. */
  watchExitHold(onHold: () => void): { stop(): void };
  /** Best effort: managed controller input for the game about to start. */
  prepareGameInput(library: string): Promise<void>;
}
/* eslint-enable no-unused-vars */

export type ConsoleState = 'idle' | 'starting' | 'running' | 'stopping';

export interface ConsoleReport {
  /** How the last session ended, shown in Management Mode afterwards. */
  frontendExit: { code: number | null; signal: string | null } | null;
  focus: FocusOutcome[];
  /** Focus outcome when the frontend first opened. */
  startFocus: FocusOutcome | null;
  /** Games stopped through the controller escape hatch. */
  forcedStops: number;
  games: number;
  error: string | null;
}

/** Errors whose message was written for people; anything else is never shown raw. */
export class ConsoleError extends Error {}
const failure = (message: string) => new ConsoleError(message);
const REPAIR =
  'ES-DE needs to be repaired: some of its files are missing or were changed. Choose Repair ES-DE. Your games and saves are unchanged.';
const GENERIC =
  'Console Mode could not start. Check that your library drive is connected. Your games and saves are unchanged.';

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

  private exitWatch: { stop(): void } | null = null;

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
    let hidden = false;
    let broker: { close(): Promise<void> } | null = null;
    const report: ConsoleReport = {
      frontendExit: null,
      focus: [],
      startFocus: null,
      forcedStops: 0,
      games: 0,
      error: null,
    };
    try {
      const frontend = await deps.frontend().catch(() => {
        // A receipt exists but the bundle no longer verifies.
        throw failure(REPAIR);
      });
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
      // Hide before the frontend appears: hiding completes asynchronously and
      // would otherwise hand focus to another app after ES-DE was activated.
      deps.hideManager();
      hidden = true;
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
      // Escape hatch: if a game's emulator stops responding, a long hold of the
      // controller exit combination stops that game and returns to the frontend.
      this.exitWatch = deps.watchExitHold(() => {
        if (this.activeGame && this.runner.forceStop()) report.forcedStops += 1;
      });
      this.current = 'running';
      this.onChange();
      // Hiding the manager hands focus to whatever macOS picks next, not to the
      // frontend (observed: another app stayed frontmost). An unfocused ES-DE
      // ignores controller input, so bring it forward once its window exists.
      report.startFocus = await this.focusFrontend(child, frontend.bundle);
      this.lastReport = report;
      this.onChange();
    } catch (error) {
      report.error = error instanceof ConsoleError ? error.message : GENERIC;
      this.frontendChild = null;
      await broker?.close().catch(() => undefined);
      if (runtime) await deps.removeRuntime(runtime).catch(() => undefined);
      if (hidden) deps.showManager();
      this.lastReport = report;
      this.current = 'idle';
      this.onChange();
      throw error;
    }
  }

  private focusFrontend(
    child: ChildProcess,
    bundle: string,
  ): Promise<FocusOutcome | null> {
    return activateUntilHeld(
      () => this.dependencies.restoreFocus(child.pid as number, bundle),
      this.dependencies.delay,
      () =>
        Boolean(child.pid) &&
        child.exitCode === null &&
        child.signalCode === null,
    );
  }

  private async play(
    library: string,
    frontend: ConsoleFrontend,
    rom: string | undefined,
    report: ConsoleReport,
  ) {
    if (!rom || this.current !== 'running')
      throw failure('Console Mode is not ready');
    await this.dependencies.prepareGameInput(library).catch(() => undefined);
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
      this.exitWatch?.stop();
      this.exitWatch = null;
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
