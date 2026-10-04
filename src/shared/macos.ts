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
  state: 'idle' | 'installing' | 'starting' | 'running' | 'stopping';
  /** Plain-language problem from the last session, if any. */
  lastError: string | null;
  games: number | null;
}

export interface MacStatus {
  dolphin: DolphinStatus;
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
}
