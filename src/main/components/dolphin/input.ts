import {
  adoptManagedFiles,
  applyManagedFiles,
  managedState,
} from '../shared/managed-ini';
import type { InputResult, InputState } from '../shared/managed-ini';

export type { InputResult, InputState };

/**
 * Managed Dolphin input for Console Mode: a GameCube pad mapping and a
 * controller exit hotkey for one controller family. Files are written only when
 * absent or still exactly as this app last wrote them; any edit by the user (or
 * by Dolphin's own controller dialog) makes the file theirs and it is kept.
 */

export type InputFamily = 'ps5';
/** Standard is linear. Precise squares the stick: finer near the centre, still 100% at full push. */
export type StickResponse = 'standard' | 'precise';

// Dolphin names SDL devices <source>/<index among same-named devices>/<name>.
const devices: Record<InputFamily, string> = {
  ps5: 'SDL/0/DualSense Wireless Controller',
};

// Measured with a physical DualSense on Dolphin 2609: SDL reports up as Y+, and
// PlayStation players expect ○ to cancel, so GameCube B is ○ and X is □.
function axis(control: string, response: StickResponse): string {
  const input = `\`${control}\``;
  // Dolphin input expressions multiply controls; x·x keeps 0 and 1 fixed.
  return response === 'precise' ? `${input} * ${input}` : input;
}

function pad(device: string, response: StickResponse): string {
  return `[GCPad1]
Device = ${device}
Buttons/A = \`Button S\`
Buttons/B = \`Button E\`
Buttons/X = \`Button W\`
Buttons/Y = \`Button N\`
Buttons/Z = \`Shoulder R\`
Buttons/Start = \`Start\`
Main Stick/Up = ${axis('Left Y+', response)}
Main Stick/Down = ${axis('Left Y-', response)}
Main Stick/Left = ${axis('Left X-', response)}
Main Stick/Right = ${axis('Left X+', response)}
C-Stick/Up = ${axis('Right Y+', response)}
C-Stick/Down = ${axis('Right Y-', response)}
C-Stick/Left = ${axis('Right X-', response)}
C-Stick/Right = ${axis('Right X+', response)}
Triggers/L = \`Trigger L\`
Triggers/R = \`Trigger R\`
Triggers/L-Analog = \`Trigger L\`
Triggers/R-Analog = \`Trigger R\`
D-Pad/Up = \`Pad N\`
D-Pad/Down = \`Pad S\`
D-Pad/Left = \`Pad W\`
D-Pad/Right = \`Pad E\`
Rumble/Motor = \`Motor\`
`;
}

// Hold Create (Back) + Options (Start) for 1.5 s: hard to press by accident.
function hotkeys(device: string): string {
  return `[Hotkeys]
Device = ${device}
General/Exit = hold(\`Back\` & \`Start\`, 1.5)
`;
}

export function managedInput(
  family: InputFamily,
  response: StickResponse = 'standard',
): Record<string, string> {
  const device = devices[family];
  return {
    'GCPadNew.ini': pad(device, response),
    'Hotkeys.ini': hotkeys(device),
  };
}

export function isInputFamily(family: string): family is InputFamily {
  return Object.prototype.hasOwnProperty.call(devices, family);
}

export function applyManagedInput(
  configDirectory: string,
  ownershipFile: string,
  family: InputFamily,
  response: StickResponse = 'standard',
): Promise<InputResult> {
  return applyManagedFiles(
    configDirectory,
    ownershipFile,
    managedInput(family, response),
  );
}

/** Read-only: whether the library's Dolphin controls are this app's, the user's, or absent. */
export function inputState(
  configDirectory: string,
  ownershipFile: string,
): Promise<InputState> {
  return managedState(configDirectory, ownershipFile, [
    'GCPadNew.ini',
    'Hotkeys.ini',
  ]);
}

/** Explicit request: back up the user's Dolphin controls, then use the recommended ones. */
export function adoptManagedInput(
  configDirectory: string,
  ownershipFile: string,
  family: InputFamily,
  response: StickResponse = 'standard',
  now: Date = new Date(),
): Promise<{ backups: string[] }> {
  return adoptManagedFiles(
    configDirectory,
    ownershipFile,
    managedInput(family, response),
    now,
  );
}
