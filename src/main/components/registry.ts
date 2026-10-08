/* eslint import/prefer-default-export: "off" -- The one registry. */
import { ppssppEmulator } from './ppsspp/emulator';
import type { ManagedEmulator } from './registry-types';

/**
 * Pinned-release emulators, in the order they appear. Adding an emulator is one
 * line here plus its own component folder; Console Mode, the library overview,
 * firmware and the install/play allowlists all follow from this list.
 * (Dolphin predates this pattern and is managed by ComponentManager.)
 */
export const managedEmulators: readonly ManagedEmulator[] = Object.freeze([
  ppssppEmulator,
]);
