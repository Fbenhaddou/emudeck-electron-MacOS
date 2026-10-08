import manifest from './macos-bridge-inventory.json';
import type { MacAPI } from './macos';

export interface BridgeEntry {
  channel: string;
  /** none: zero arguments; one: a single allowlisted literal; callback: an event subscription. */
  argument: 'none' | 'one' | 'callback';
  /** A valid literal for methods that forward one argument. */
  sample?: string;
}

type ManifestMethod = keyof typeof manifest.methods;
// Compile-time: the manifest lists exactly the methods of MacAPI.
const noMissing: [Exclude<keyof MacAPI, ManifestMethod>] extends [never]
  ? true
  : never = true;
const noExtra: [Exclude<ManifestMethod, keyof MacAPI>] extends [never]
  ? true
  : never = true;

export const bridgeComplete = noMissing && noExtra;

/** Every preload method, its channel and its argument rule. */
export const bridgeMethods = manifest.methods as Record<
  keyof MacAPI,
  BridgeEntry
>;

/** Sorted method names, as the renderer sees them on window.mac. */
export const bridgeMethodNames = (
  Object.keys(bridgeMethods) as Array<keyof MacAPI>
).sort();

/** Channels main must handle with ipcMain.handle (everything except events). */
export const invokeChannels = bridgeMethodNames
  .filter((name) => bridgeMethods[name].argument !== 'callback')
  .map((name) => bridgeMethods[name].channel)
  .sort();
