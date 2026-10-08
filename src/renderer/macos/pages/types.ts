import type { MacStatus } from '../../../shared/macos';

export type Action =
  | 'choosing-library'
  | 'recovering-library'
  | 'installing'
  | 'choosing-game'
  | 'resetting'
  | 'installing-console'
  | 'opening-console'
  | 'adding-firmware'
  | 'exporting-diagnostics'
  | 'backing-up'
  | 'restoring';

/* eslint-disable no-unused-vars -- Parameter names document the callback. */
export type Operate = (
  action: Action,
  operation: () => Promise<{ ok: boolean; error?: string }>,
) => Promise<void>;
/* eslint-enable no-unused-vars */

/** What every page receives from the window: status and the shared action state. */
export interface PageProps {
  status: MacStatus;
  action: Action | null;
  /** An action started from this window is in progress. */
  busy: boolean;
  /** Any emulator, or an action from this window, is busy. */
  emulatorBusy: boolean;
  consoleBusy: boolean;
  operate: Operate;
}
