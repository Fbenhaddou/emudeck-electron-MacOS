/* eslint no-unused-vars: "off" -- Interface parameter names document the API. */
import type {
  AppHealth,
  InstalledApp,
  PinnedInstallOptions,
} from './shared/pinned-app';
import type { ComponentAdapter } from './types';

/** The pinned-app installer surface (see shared/pinned-app). */
export interface PinnedAppInstaller {
  spec: { version: string };
  health(root: string): Promise<AppHealth>;
  installed(root: string): Promise<InstalledApp | null>;
  install(root: string, options?: PinnedInstallOptions): Promise<InstalledApp>;
}

/**
 * Everything the app needs to manage one pinned-release emulator. A component
 * folder exports one of these; registry.ts lists them. Nothing else in the app
 * names a specific emulator.
 */
export interface ManagedEmulator {
  adapter: ComponentAdapter;
  app: PinnedAppInstaller;
  /** Read-only checks before launch; throw LaunchRefusal to refuse in plain language. */
  preflight?: () => Promise<void>;
  /** Best effort before every launch (e.g. managed controls); returns a path-free summary for diagnostics. */
  prepareLaunch?: (library: string) => Promise<unknown>;
}
