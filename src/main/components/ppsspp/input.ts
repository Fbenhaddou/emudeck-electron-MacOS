import { applyManagedFiles } from '../shared/managed-ini';
import type { InputResult } from '../shared/managed-ini';

/**
 * PPSSPP 1.20.4's default pad mapping binds PSP L/R to generic buttons 7/8,
 * which its own SDL layer never produces for a game controller (left shoulder
 * is button 6, right shoulder button 5: SDL/SDLJoystick.cpp at v1.20.4). On a
 * DualSense the PSP shoulder buttons were therefore unreachable. This is that
 * default file, as PPSSPP 1.20.4 wrote it, with only L and R corrected.
 * Device 1 is the keyboard, device 10 the first game controller.
 */
const controls = `[ControlMapping]
Up = 1-19,10-19
Down = 1-20,10-20
Left = 1-21,10-21
Right = 1-22,10-22
Circle = 1-52,10-190
Cross = 1-54,10-189
Square = 1-29,10-191
Triangle = 1-47,10-188
Start = 1-62,10-197
Select = 1-66,10-196
L = 1-45,10-193
R = 1-51,10-192
An.Up = 1-37,10-4003
An.Down = 1-39,10-4002
An.Left = 1-38,10-4001
An.Right = 1-40,10-4000
Analog limiter = 1-60
RapidFire = 1-59
Fast-forward = 1-61
Pause = 1-111,10-109,10-104,10-4034
Pause (no menu) = 1-138
SpeedToggle = 1-68
Analog speed = 10-4036
Rewind = 1-67
Toggle Debugger = 1-142
`;

// PPSSPP 1.20.4's own default, recognised so its unreachable L/R can be fixed.
const upstreamDefault = controls
  .replace('L = 1-45,10-193', 'L = 1-45,10-194')
  .replace('R = 1-51,10-192', 'R = 1-51,10-195');

export function managedControls(): Record<string, string> {
  return { 'controls.ini': controls };
}

/** Before every PPSSPP launch: only when absent or still exactly ours. */
export function applyManagedControls(
  configDirectory: string,
  ownershipFile: string,
): Promise<InputResult> {
  return applyManagedFiles(configDirectory, ownershipFile, managedControls(), {
    'controls.ini': upstreamDefault,
  });
}
