/* eslint import/prefer-default-export: "off" -- Adapters use explicit named exports. */
import path from 'path';
import { absolutePath, validateManifest } from '../schema';
import { ComponentAdapter, ComponentPaths, LaunchRequest } from '../types';
import { pinnedApp } from '../shared/pinned-app';

const homepage = 'https://www.ppsspp.org/';
const releasePage = 'https://www.ppsspp.org/download/';

// Source and verified evidence: docs/macos/research/ppsspp-component.md §0.
const manifest = validateManifest(
  {
    schemaVersion: 1,
    id: 'ppsspp',
    name: 'PPSSPP',
    systems: ['psp'],
    platform: 'darwin',
    architecture: 'universal',
    minimumOS: '11.0',
    homepage,
    releasePage,
    license: 'GPL-2.0-or-later',
    bundleName: 'PPSSPPSDL.app',
    executable: 'Contents/MacOS/PPSSPPSDL',
    // .zip/.7z/.rar are install archives to PPSSPP, not boot targets.
    romExtensions: ['.iso', '.cso', '.chd', '.pbp', '.elf', '.prx'],
    capabilities: {
      installation: 'planned',
      configuration: 'planned',
      launch: 'plan-only',
      frontend: 'planned',
    },
  },
  {
    id: 'ppsspp',
    bundleName: 'PPSSPPSDL.app',
    executable: 'Contents/MacOS/PPSSPPSDL',
    urls: [homepage, releasePage],
  },
);

/**
 * PPSSPP has no --user flag: on macOS it keeps everything under
 * $HOME/.config/ppsspp. Launching with HOME set to the library's own folder
 * isolates configuration, saves and states (measured: zero writes to the real
 * home). Config is PSP/SYSTEM; saves PSP/SAVEDATA; states PSP/PPSSPP_STATE.
 */
function paths(libraryRoot: string): ComponentPaths {
  const root = absolutePath(libraryRoot);
  const home = path.posix.join(root, 'emulators', 'ppsspp');
  const memstick = path.posix.join(home, '.config', 'ppsspp', 'PSP');
  return Object.freeze({
    roms: path.posix.join(root, 'roms', 'psp'),
    user: home,
    configuration: path.posix.join(memstick, 'SYSTEM'),
    saves: path.posix.join(memstick, 'SAVEDATA'),
    states: path.posix.join(memstick, 'PPSSPP_STATE'),
  });
}

export const ppsspp: ComponentAdapter = Object.freeze({
  manifest,
  system: Object.freeze({
    id: 'psp',
    fullname: 'Sony PlayStation Portable',
    shortName: 'PSP',
  }),
  paths,
  planLaunch: ({
    libraryRoot,
    appBundlePath,
    romPath,
    presentation = 'window',
  }: LaunchRequest) => {
    const directories = paths(libraryRoot);
    const bundle = absolutePath(appBundlePath);
    const rom = absolutePath(romPath);
    if (path.posix.basename(bundle) !== manifest.bundleName)
      throw new Error('Unexpected application bundle');
    if (
      !rom.startsWith(`${directories.roms}/`) ||
      !manifest.romExtensions.includes(path.posix.extname(rom).toLowerCase())
    )
      throw new Error(
        'Game must be a supported file inside this library system',
      );
    return Object.freeze({
      executable: path.posix.join(bundle, manifest.executable),
      args: Object.freeze([
        // Console Mode is controller-first: fullscreen, and leaving through the
        // pause menu returns straight to the frontend.
        ...(presentation === 'console'
          ? ['--fullscreen', '--pause-menu-exit']
          : []),
        rom,
      ]),
      cwd: bundle,
      env: Object.freeze({ HOME: directories.user }),
    });
  },
});

/** Reviewed release; verified 2026-10-05 (Universal, notarized, team 97NS59EENG). */
export const ppssppApp = pinnedApp({
  id: 'ppsspp',
  displayName: 'PPSSPP',
  version: '1.20.4',
  artifact: Object.freeze({
    url: 'https://www.ppsspp.org/files/1_20_4/PPSSPP_macOS.dmg',
    bytes: 37090805,
    sha256: 'bad86fc544a2c2fc5795d6a5832a8925d6db43e5789fe507f742305aaa357e17',
  }),
  bundleName: 'PPSSPPSDL.app',
  executable: 'PPSSPPSDL',
  bundleIdentifier: 'org.ppsspp.ppsspp',
  teamIdentifier: '97NS59EENG',
  license: 'none',
});
