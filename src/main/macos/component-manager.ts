import fs from 'fs/promises';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { dolphin } from '../components/dolphin';
import { discoverRelease } from '../components/dolphin/download';
import { installDolphin, verifyBundle } from '../components/dolphin/install';
import {
  prepareDolphinLibrary,
  resetDolphinConfiguration,
  validateGame,
} from './dolphin-library';
import type { DolphinResetResult } from './dolphin-library';

const defaultDependencies = {
  discoverRelease,
  installDolphin,
  verifyBundle,
  prepareDolphinLibrary,
  resetDolphinConfiguration,
  validateGame,
  spawn,
};

export interface DolphinStatus {
  version: string | null;
  operation: 'idle' | 'installing' | 'launching' | 'running' | 'resetting';
}

/** One component vertical slice; installation never writes into the portable library. */
export class ComponentManager {
  private operation: DolphinStatus['operation'] = 'idle';

  private child: ChildProcess | null = null;

  // TypeScript parameter properties initialize the manager's dependencies.
  // eslint-disable-next-line no-useless-constructor
  constructor(
    private readonly installRoot: string,
    private readonly onExit: () => void,
    private readonly dependencies = defaultDependencies,
  ) {
    /* Parameter properties own initialization. */
  }

  private async root(): Promise<string> {
    await fs.mkdir(this.installRoot, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(this.installRoot);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error('Installation directory is unavailable');
    return fs.realpath(this.installRoot);
  }

  // Sequentially inspect bounded receipts, skipping unknown entries without mutation.
  /* eslint-disable no-continue, no-await-in-loop */
  private async installed(): Promise<{
    version: string;
    bundle: string;
  } | null> {
    const root = await this.root();
    const versions = (await fs.readdir(root))
      .filter((version) => /^\d{4}[a-z]?$/.test(version))
      .sort()
      .reverse();
    // eslint-disable-next-line no-restricted-syntax -- Inspect candidates in newest-first order.
    for (const version of versions) {
      const directory = path.join(root, version);
      try {
        // eslint-disable-next-line no-await-in-loop -- Check the version boundary before reading its receipt.
        const directoryStat = await fs.lstat(directory);
        if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
          continue;
        // eslint-disable-next-line no-await-in-loop -- Stop at the first valid complete receipt.
        const stat = await fs.lstat(path.join(directory, 'receipt.json'));
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384)
          continue;
        // eslint-disable-next-line no-await-in-loop -- Receipt is bounded before reading.
        const receipt = JSON.parse(
          await fs.readFile(path.join(directory, 'receipt.json'), 'utf8'),
        );
        const bundle = path.join(directory, 'Dolphin.app');
        if (
          receipt.version !== version ||
          receipt.bundlePath !== bundle ||
          receipt.verification !== 'codesign-and-gatekeeper'
        )
          continue;
        // eslint-disable-next-line no-await-in-loop -- Refuse replaced or redirected bundles.
        if ((await fs.realpath(bundle)) !== bundle) continue;
        return { version, bundle };
      } catch {
        /* Incomplete/unknown installations are preserved but never activated. */
      }
    }
    return null;
  }
  /* eslint-enable no-continue, no-await-in-loop */

  async status(): Promise<DolphinStatus> {
    return {
      version: (await this.installed())?.version || null,
      operation: this.operation,
    };
  }

  async install(): Promise<void> {
    if (this.isBusy) throw new Error('Another emulator operation is active');
    this.operation = 'installing';
    try {
      const release = await this.dependencies.discoverRelease();
      const current = await this.installed();
      if (current?.version === release.version) {
        await this.dependencies.verifyBundle(current.bundle);
        return;
      }
      await this.dependencies.installDolphin(release, await this.root());
    } finally {
      this.operation = 'idle';
    }
  }

  async reset(library: string): Promise<DolphinResetResult> {
    if (this.isBusy) throw new Error('Another emulator operation is active');
    this.operation = 'resetting';
    try {
      return await this.dependencies.resetDolphinConfiguration(library);
    } finally {
      this.operation = 'idle';
    }
  }

  async launch(library: string, game: string): Promise<void> {
    if (this.isBusy) throw new Error('Another emulator operation is active');
    this.operation = 'launching';
    try {
      const installed = await this.installed();
      if (!installed) throw new Error('Install Dolphin first');
      await this.dependencies.verifyBundle(installed.bundle);
      await this.dependencies.prepareDolphinLibrary(library);
      const rom = await this.dependencies.validateGame(library, game);
      const plan = dolphin.planLaunch({
        libraryRoot: library,
        appBundlePath: installed.bundle,
        romPath: rom,
      });
      await new Promise<void>((resolve, reject) => {
        const child = this.dependencies.spawn(plan.executable, [...plan.args], {
          cwd: plan.cwd,
          shell: false,
          stdio: 'ignore',
        });
        this.child = child;
        child.once('error', reject);
        child.once('spawn', () => {
          this.operation = 'running';
          resolve();
        });
        child.once('exit', () => {
          if (this.child !== child) return;
          this.child = null;
          this.operation = 'idle';
          this.onExit();
        });
      });
    } catch (error) {
      this.operation = 'idle';
      this.child = null;
      throw error;
    }
  }

  get isBusy(): boolean {
    return this.operation !== 'idle' || this.child !== null;
  }
}
