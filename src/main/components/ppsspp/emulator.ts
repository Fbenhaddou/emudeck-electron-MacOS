/* eslint import/prefer-default-export: "off" -- One registry entry per component. */
import path from 'path';
import type { ManagedEmulator } from '../registry-types';
import { ppsspp, ppssppApp } from '.';
import { applyManagedControls } from './input';
import { ppssppPreflight } from './preflight';

export const ppssppEmulator: ManagedEmulator = Object.freeze({
  adapter: ppsspp,
  app: ppssppApp,
  preflight: ppssppPreflight(),
  // PPSSPP 1.20.4's default L/R bindings are unreachable on game controllers.
  prepareLaunch: async (library: string) => {
    const { configuration, user } = ppsspp.paths(library);
    const result = await applyManagedControls(
      configuration,
      path.join(user, '.emulation-workspace-input.json'),
    );
    return result.files;
  },
});
