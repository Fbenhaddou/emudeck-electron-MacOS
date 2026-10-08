export interface LibraryInfo {
  path: string;
  available: boolean;
}

export interface DolphinStatus {
  version: string | null;
  operation: 'idle' | 'installing' | 'launching' | 'running' | 'resetting';
}

export interface ConsoleStatus {
  /** Installed managed ES-DE version, or null. */
  frontend: string | null;
  /** Damaged: our receipt exists but files a launch needs are missing or changed. */
  frontendState: 'missing' | 'installed' | 'damaged';
  state: 'idle' | 'installing' | 'starting' | 'running' | 'stopping';
  /** Plain-language problem from the last session, if any. */
  lastError: string | null;
  games: number | null;
}

/** A registered pinned-app emulator id; main accepts only ids in its registry. */
export type PinnedEmulatorID = string;

export interface EmulatorSummary {
  id: PinnedEmulatorID;
  name: string;
  systems: readonly string[];
  /** Short system name for people, e.g. 'PSP'. */
  systemName: string;
  /** The pinned build's architecture; x64 needs Rosetta. */
  architecture: 'arm64' | 'x64' | 'universal';
  version: string | null;
  health: 'missing' | 'installed' | 'damaged';
  operation: 'idle' | 'installing' | 'launching' | 'running';
}

export interface MacStatus {
  dolphin: DolphinStatus;
  /** Pinned-release emulators beyond Dolphin (PPSSPP first). */
  emulators: EmulatorSummary[];
  console: ConsoleStatus;
  appVersion: string;
  platform: 'darwin';
  architecture: string;
  osVersion: string;
  memoryBytes: number;
  displays: Array<{
    width: number;
    height: number;
    scaleFactor: number;
    refreshRate: number | null;
    hdr: 'unknown';
  }>;
  library: LibraryInfo | null;
  libraryError: string | null;
  capabilities: {
    controllers: 'untested';
    installation: 'planned';
    consoleMode: 'preview';
  };
}

export interface ControllerSummary {
  name: string;
  kind: 'ps5' | 'ps4' | 'xbox' | 'switchpro' | 'other';
  battery: number | null;
  charging: boolean;
  haptics: boolean;
  motion: boolean;
}

export interface ControllersStatus {
  controllers: ControllerSummary[];
  /** Steam is running and has replaced a controller with its virtual pad. */
  steamInput: boolean;
  stickResponse: 'standard' | 'precise';
  /** The library's Dolphin controls; no-library when none is available. */
  dolphinControls: 'recommended' | 'user' | 'not-set' | 'no-library';
  /** Recommended controls exist for the connected controller. */
  recommendedAvailable: boolean;
}

export interface LibrarySystem {
  id: string;
  name: string;
  emulator: string;
  installed: boolean;
  games: number;
  /** Library-relative games folder, e.g. 'roms/gc'. */
  folder: string;
}

export interface FirmwareSummary {
  id: string;
  system: string;
  title: string;
  purpose: string;
  required: boolean;
  state: 'missing' | 'recognized' | 'unrecognized';
  /** Recognized dump label. */
  detail: string | null;
}

export interface LibraryOverview {
  available: boolean;
  systems: LibrarySystem[];
  firmware: FirmwareSummary[];
}

export type ActionResult = { ok: true } | { ok: false; error: string };
export type LibraryResult =
  | { ok: true; library: LibraryInfo }
  | { ok: false; cancelled?: boolean; error: string };

export interface MacAPI {
  getStatus(): Promise<MacStatus>;
  onRefreshStatus(callback: () => void): () => void;
  chooseLibrary(): Promise<LibraryResult>;
  revealLibrary(): Promise<ActionResult>;
  installDolphin(): Promise<ActionResult>;
  playGame(): Promise<ActionResult>;
  resetDolphin(): Promise<ActionResult>;
  recoverLibrarySettings(): Promise<ActionResult>;
  installConsole(): Promise<ActionResult>;
  enterConsole(): Promise<ActionResult>;
  getControllers(): Promise<ControllersStatus>;
  setStickResponse(value: 'standard' | 'precise'): Promise<ActionResult>;
  useRecommendedControls(): Promise<ActionResult>;
  installEmulator(id: PinnedEmulatorID): Promise<ActionResult>;
  playEmulator(id: PinnedEmulatorID): Promise<ActionResult>;
  getLibraryOverview(): Promise<LibraryOverview>;
  addFirmware(id: string): Promise<ActionResult>;
  revealSystem(id: string): Promise<ActionResult>;
  exportDiagnostics(): Promise<ActionResult>;
}
