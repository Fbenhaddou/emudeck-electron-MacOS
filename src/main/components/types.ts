/* eslint no-unused-vars: "off" -- TypeScript interface parameter names document the API. */
/* eslint import/extensions: ["error", "ignorePackages", { "ts": "never" }] */
export type Architecture = 'arm64' | 'x64' | 'universal';

export interface ComponentManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  systems: readonly string[];
  platform: 'darwin';
  architecture: Architecture;
  minimumOS: string;
  homepage: string;
  releasePage: string;
  license: string;
  bundleName: string;
  executable: string;
  romExtensions: readonly string[];
  capabilities: {
    installation: 'planned';
    configuration: 'planned';
    launch: 'plan-only';
    frontend: 'planned';
  };
}

export interface TrustPolicy {
  id: string;
  bundleName: string;
  executable: string;
  urls: readonly string[];
}

export interface HostCapabilities {
  platform: string;
  architecture: string;
  osVersion: string;
}

export interface ComponentPaths {
  roms: string;
  user: string;
  configuration: string;
  saves: string;
  states: string;
}

export interface LaunchRequest {
  libraryRoot: string;
  appBundlePath: string;
  romPath: string;
  /** Console Mode launches are controller-first: fullscreen, no confirmations. */
  presentation?: 'window' | 'console';
}

export interface LaunchPlan {
  executable: string;
  args: readonly string[];
  cwd: string;
}

export interface ComponentAdapter {
  manifest: ComponentManifest;
  paths: (libraryRoot: string) => ComponentPaths;
  planLaunch: (request: LaunchRequest) => LaunchPlan;
}
