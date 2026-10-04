/* eslint import/prefer-default-export: "off" -- Adapters use explicit named exports. */
/* eslint import/extensions: ["error", "ignorePackages", { "ts": "never" }] */
import path from 'path';
import { absolutePath, validateManifest } from '../schema';
import { ComponentAdapter, ComponentPaths, LaunchRequest } from '../types';

const homepage = 'https://dolphin-emu.org/';
const releasePage = 'https://dolphin-emu.org/download/';

// Source and rationale: docs/research/components.md. Release page is discovery metadata,
// not permission to download or execute arbitrary assets linked from it.
const manifest = validateManifest(
  {
    schemaVersion: 1,
    id: 'dolphin',
    name: 'Dolphin',
    systems: ['gc'],
    platform: 'darwin',
    architecture: 'universal',
    minimumOS: '11.0',
    homepage,
    releasePage,
    license: 'GPL-2.0-or-later',
    bundleName: 'Dolphin.app',
    executable: 'Contents/MacOS/Dolphin',
    romExtensions: ['.dol', '.elf', '.iso', '.gcm', '.rvz', '.gcz', '.wia'],
    capabilities: {
      installation: 'planned',
      configuration: 'planned',
      launch: 'plan-only',
      frontend: 'planned',
    },
  },
  {
    id: 'dolphin',
    bundleName: 'Dolphin.app',
    executable: 'Contents/MacOS/Dolphin',
    urls: [homepage, releasePage],
  },
);

function paths(libraryRoot: string): ComponentPaths {
  const root = absolutePath(libraryRoot);
  const user = path.posix.join(root, 'emulators', 'dolphin', 'User');
  return Object.freeze({
    roms: path.posix.join(root, 'roms', 'gc'),
    user,
    configuration: path.posix.join(user, 'Config'),
    saves: path.posix.join(user, 'GC'),
    states: path.posix.join(user, 'StateSaves'),
  });
}

export const dolphin: ComponentAdapter = Object.freeze({
  manifest,
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
        '--user',
        directories.user,
        // Per-launch overrides are never written to the user's Dolphin.ini. A stop
        // confirmation would strand a controller-only player after quitting.
        ...(presentation === 'console'
          ? [
              '--config',
              'Dolphin.Interface.ConfirmStop=False',
              '--config',
              'Dolphin.Display.Fullscreen=True',
            ]
          : []),
        '--batch',
        '--exec',
        rom,
      ]),
      cwd: bundle,
    });
  },
});
