import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import type { ChildProcess, SpawnOptions } from 'child_process';
import type { ComponentAdapter } from '../components/types';
import type {
  AppHealth,
  InstalledApp,
  PinnedInstallOptions,
} from '../components/shared/pinned-app';

export type EmulatorOperation = 'idle' | 'installing' | 'launching' | 'running';

export interface EmulatorStatus {
  id: string;
  name: string;
  systems: readonly string[];
  version: string | null;
  health: AppHealth;
  operation: EmulatorOperation;
}

export interface EmulatorExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/** The pinned-app installer surface a runtime needs (see shared/pinned-app). */
export interface PinnedAppInstaller {
  spec: { version: string };
  health(root: string): Promise<AppHealth>;
  installed(root: string): Promise<InstalledApp | null>;
  install(root: string, options?: PinnedInstallOptions): Promise<InstalledApp>;
}

/* eslint-disable no-unused-vars -- Names document injected contracts. */
export interface RuntimeDependencies {
  spawn(
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ): ChildProcess;
  /** Read-only checks before launch; throw a plain-language Error to refuse. */
  preflight(): Promise<void>;
  /** Library identity still matches the selected, available library. */
  assertLibrary(root: string): Promise<void>;
}
/* eslint-enable no-unused-vars */

/**
 * One pinned-release emulator: install, health, verified launch, exact-child
 * tracking and an emergency stop. Everything component-specific comes from the
 * adapter (paths, launch plan) and the pinned app (trust and installation).
 */
export class EmulatorRuntime {
  private operation: EmulatorOperation = 'idle';

  private child: ChildProcess | null = null;

  // eslint-disable-next-line no-useless-constructor -- Parameter properties.
  constructor(
    readonly adapter: ComponentAdapter,
    private readonly app: PinnedAppInstaller,
    private readonly installRoot: string,
    private readonly dependencies: RuntimeDependencies,
    private readonly onExit: () => void = () => undefined,
  ) {
    /* Parameter properties own initialization. */
  }

  private async root(): Promise<string> {
    await fs.mkdir(this.installRoot, { recursive: true, mode: 0o700 });
    return fs.realpath(this.installRoot);
  }

  get isBusy(): boolean {
    return this.operation !== 'idle' || this.child !== null;
  }

  /** Read-only: never creates folders. */
  async status(): Promise<EmulatorStatus> {
    let health: AppHealth = 'missing';
    try {
      health = await this.app.health(await fs.realpath(this.installRoot));
    } catch {
      health = 'missing';
    }
    return {
      id: this.adapter.manifest.id,
      name: this.adapter.manifest.name,
      systems: this.adapter.manifest.systems,
      version: health === 'missing' ? null : this.app.spec.version,
      health,
      operation: this.operation,
    };
  }

  private begin(operation: EmulatorOperation): void {
    if (this.isBusy) throw new Error('Another emulator operation is active');
    this.operation = operation;
  }

  async install(): Promise<void> {
    this.begin('installing');
    try {
      await this.app.install(await this.root());
    } finally {
      this.operation = 'idle';
    }
  }

  /** Library folders this emulator needs; never replaces anything existing. */
  async prepareLibrary(library: string): Promise<void> {
    const directories = this.adapter.paths(library);
    // eslint-disable-next-line no-restricted-syntax -- Parents before children.
    for (const directory of [directories.roms, directories.user]) {
      // eslint-disable-next-line no-await-in-loop
      await fs.mkdir(directory, { recursive: true, mode: 0o755 });
      // eslint-disable-next-line no-await-in-loop
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error('Library folder is not a real folder');
    }
  }

  /** Validates the game is a supported regular file inside this system's folder. */
  async validateGame(library: string, game: string): Promise<string> {
    const { roms } = this.adapter.paths(library);
    const canonical = await fs.realpath(game);
    const stat = await fs.lstat(canonical);
    if (
      canonical !== game ||
      !canonical.startsWith(`${roms}${path.sep}`) ||
      !stat.isFile() ||
      !this.adapter.manifest.romExtensions.includes(
        path.extname(game).toLowerCase(),
      )
    )
      throw new Error('Choose a supported game inside this library');
    return canonical;
  }

  /** Windowed play: resolves once the emulator has started. */
  async launch(library: string, game: string): Promise<void> {
    const { finished } = await this.start(library, game, 'window');
    finished.catch(() => undefined);
  }

  /** Console Mode: resolves when this exact emulator process exits. */
  async launchAndWait(
    library: string,
    game: string,
    presentation: 'window' | 'console' = 'window',
  ): Promise<EmulatorExit> {
    const { finished } = await this.start(library, game, presentation);
    return finished;
  }

  private async start(
    library: string,
    game: string,
    presentation: 'window' | 'console',
  ): Promise<{ finished: Promise<EmulatorExit> }> {
    this.begin('launching');
    try {
      const app = await this.app.installed(await this.root());
      if (!app) throw new Error(`Install ${this.adapter.manifest.name} first`);
      await this.dependencies.preflight();
      await this.dependencies.assertLibrary(library);
      await this.prepareLibrary(library);
      const rom = await this.validateGame(library, game);
      await this.dependencies.assertLibrary(library);
      const plan = this.adapter.planLaunch({
        libraryRoot: library,
        appBundlePath: app.bundle,
        romPath: rom,
        presentation,
      });
      const child = this.dependencies.spawn(plan.executable, [...plan.args], {
        cwd: plan.cwd,
        shell: false,
        stdio: 'ignore',
        // A minimal environment: nothing from this process leaks into the emulator.
        env: {
          PATH: '/usr/bin:/bin',
          TMPDIR: process.env.TMPDIR || '/tmp',
          LANG: 'en_US.UTF-8',
          ...plan.env,
        },
      });
      this.child = child;
      const finished = new Promise<EmulatorExit>((resolve) => {
        child.once('exit', (code, signal) => {
          resolve({ code, signal });
          if (this.child === child) {
            this.child = null;
            this.operation = 'idle';
            this.onExit();
          }
        });
      });
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', () => {
          this.operation = 'running';
          resolve();
        });
        child.once('error', reject);
      });
      return { finished };
    } catch (error) {
      this.child = null;
      this.operation = 'idle';
      throw error;
    }
  }

  /** Emergency stop for this runtime's own running game only. */
  forceStop(graceMilliseconds = 4000): boolean {
    const { child } = this;
    if (!child || child.exitCode !== null || child.signalCode !== null)
      return false;
    child.kill('SIGTERM');
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill('SIGKILL');
    }, graceMilliseconds);
    child.once('exit', () => clearTimeout(timer));
    return true;
  }
}

export const defaultSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => spawn(command, [...args], options);
