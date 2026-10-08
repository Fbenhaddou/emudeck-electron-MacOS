/* eslint import/prefer-default-export: "off" -- Adapters use explicit named exports. */
/* eslint import/extensions: ["error", "ignorePackages", { "ts": "never" }] */
import path from 'path';
import { absolutePath, validateManifest } from '../schema';
import { ComponentAdapter, ComponentPaths, LaunchRequest } from '../types';

const homepage = 'https://dolphin-emu.org/';
const releasePage = 'https://dolphin-emu.org/download/';

// Source and rationale: docs/macos/research/components.md. Release page is discovery metadata,
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

const ipl = (region: 'USA' | 'EUR' | 'JAP') =>
  `emulators/dolphin/User/GC/${region}/IPL.bin`;

/**
 * Optional GameCube IPL. Reference CRC32 values are Redump's, as listed in
 * Dolphin's Source/Core/Core/Boot/Boot.cpp (Load_BS2). NTSC USA and Japan dumps
 * are identical, so a recognized NTSC dump serves both region folders.
 */
const firmware = Object.freeze([
  Object.freeze({
    id: 'gc-ipl',
    system: 'gc',
    title: 'GameCube IPL',
    purpose:
      'The GameCube’s startup software, for its original boot animation and system fonts. Dolphin plays games without it.',
    required: false,
    maxBytes: 2 * 1024 * 1024,
    source: 'Redump, as listed in Dolphin’s Boot.cpp',
    knownDumps: Object.freeze([
      {
        label: 'NTSC Revision 1.0',
        crc32: '6dac1f2a',
        destinations: [ipl('USA'), ipl('JAP')],
      },
      {
        label: 'NTSC Revision 1.1',
        crc32: 'd5e6feea',
        destinations: [ipl('USA'), ipl('JAP')],
      },
      {
        label: 'NTSC Revision 1.2 (DOL-001)',
        crc32: 'd235e3f9',
        destinations: [ipl('USA'), ipl('JAP')],
      },
      {
        label: 'NTSC Revision 1.2 (DOL-101)',
        crc32: '86573808',
        destinations: [ipl('USA'), ipl('JAP')],
      },
      {
        label: 'MPAL Revision 1.1 (Brazil)',
        crc32: '667d0b64',
        destinations: [ipl('USA')],
      },
      {
        label: 'PAL Revision 1.0',
        crc32: '4f319f43',
        destinations: [ipl('EUR')],
      },
      {
        label: 'PAL Revision 1.2',
        crc32: 'ad1b7f16',
        destinations: [ipl('EUR')],
      },
    ]),
  }),
]);

export const dolphin: ComponentAdapter = Object.freeze({
  manifest,
  system: Object.freeze({
    id: 'gc',
    fullname: 'Nintendo GameCube',
    shortName: 'GameCube',
  }),
  firmware,
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
