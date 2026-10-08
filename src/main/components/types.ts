/* eslint no-unused-vars: "off" -- TypeScript interface parameter names document the API. */
/* eslint import/extensions: ["error", "ignorePackages", { "ts": "never" }] */
export type Architecture = 'arm64' | 'x64' | 'universal';

/**
 * A folder game is a direct child of the system's roms folder that contains
 * every marker as a regular, non-empty file, reached without symlinks.
 */
export interface FolderGameSpec {
  /** Folder-relative POSIX paths, e.g. 'eboot.bin', 'sce_sys/param.sfo'. */
  markers: readonly string[];
  /** The marker passed to the emulator, e.g. 'eboot.bin'. */
  launchTarget: string;
  /** Sibling folders that belong to a game (updates, DLC); never games themselves. */
  companionSuffixes: readonly string[];
}

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
  /** File games' extensions; may be empty only when folderGame is declared. */
  romExtensions: readonly string[];
  /** Games that are folders (PS4, PS3, Wii U) rather than single files. */
  folderGame?: FolderGameSpec;
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
  /** Extra environment for isolation (e.g. HOME); merged over a minimal base. */
  env?: Readonly<Record<string, string>>;
}

/** A known-good dump, identified by a public reference hash. */
export interface FirmwareDump {
  /** Plain-language name, e.g. 'NTSC Revision 1.2 (DOL-001)'. */
  label: string;
  /** Lowercase hex CRC32 over the whole file (the reference's own method). */
  crc32: string;
  /** Library-relative destinations a recognized dump is copied to. */
  destinations: readonly string[];
}

/**
 * Firmware or BIOS a component can use. Lives with the component (what, why,
 * where, how to recognize a good dump); the firmware manager is generic. Files
 * always come from the user's own hardware; nothing is ever downloaded.
 */
export interface FirmwareRequirement {
  id: string;
  system: string;
  title: string;
  /** Why it is needed, in plain language. */
  purpose: string;
  required: boolean;
  maxBytes: number;
  /** Reference source for the hashes, e.g. 'Redump via Dolphin Boot.cpp'. */
  source: string;
  knownDumps: readonly FirmwareDump[];
}

/** How a system is named for people and for ES-DE. */
export interface SystemInfo {
  /** ES-DE system id and library folder name, e.g. 'psp' (roms/psp). */
  id: string;
  /** ES-DE full name, e.g. 'Sony PlayStation Portable'. */
  fullname: string;
  /** Short name shown in Management Mode, e.g. 'PSP'. */
  shortName: string;
}

export interface ComponentAdapter {
  manifest: ComponentManifest;
  /** The system this component plays; its id is one of manifest.systems. */
  system: SystemInfo;
  /** Firmware/BIOS this component can use; absent when none is needed. */
  firmware?: readonly FirmwareRequirement[];
  paths: (libraryRoot: string) => ComponentPaths;
  planLaunch: (request: LaunchRequest) => LaunchPlan;
}
