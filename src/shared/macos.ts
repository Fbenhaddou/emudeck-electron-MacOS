export interface LibraryInfo {
  path: string;
  available: boolean;
}

export interface DolphinStatus {
  version: string | null;
  operation: 'idle' | 'installing' | 'launching' | 'running' | 'resetting';
}

export interface MacStatus {
  dolphin: DolphinStatus;
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
    consoleMode: 'planned';
  };
}

export type ActionResult = { ok: true } | { ok: false; error: string };
export type LibraryResult =
  | { ok: true; library: LibraryInfo }
  | { ok: false; cancelled?: boolean; error: string };

export interface MacAPI {
  getStatus(): Promise<MacStatus>;
  chooseLibrary(): Promise<LibraryResult>;
  revealLibrary(): Promise<ActionResult>;
  installDolphin(): Promise<ActionResult>;
  playGame(): Promise<ActionResult>;
  resetDolphin(): Promise<ActionResult>;
  recoverLibrarySettings(): Promise<ActionResult>;
}
