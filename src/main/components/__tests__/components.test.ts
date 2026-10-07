/* eslint import/extensions: ["error", "ignorePackages", { "ts": "never" }] */
/** @jest-environment node */
import {
  components,
  getComponent,
  checkCompatibility,
  validateManifest,
} from '..';
import { absolutePath } from '../schema';

const dolphin = getComponent('dolphin');
const policy = {
  id: 'dolphin',
  bundleName: 'Dolphin.app',
  executable: 'Contents/MacOS/Dolphin',
  urls: [dolphin.manifest.homepage, dolphin.manifest.releasePage],
};

test('registry exposes GameCube and PSP, one component per system', () => {
  expect(components.map((entry) => entry.manifest.id)).toEqual([
    'dolphin',
    'ppsspp',
  ]);
  const systems = components.flatMap((entry) => entry.manifest.systems);
  expect(new Set(systems).size).toBe(systems.length);
  expect(dolphin.manifest.systems).toEqual(['gc']);
  expect(() => getComponent('__proto__')).toThrow();
  expect(Object.isFrozen(dolphin.manifest.romExtensions)).toBe(true);
});

test.each([
  { executable: '../evil' },
  { executable: '/bin/sh' },
  { architecture: 'm4' },
  { releasePage: 'https://dolphin-emu.org.evil.example/download/' },
  { releasePage: 'https://user:secret@dolphin-emu.org/download/' },
  { releasePage: 'http://dolphin-emu.org/download/' },
  { releasePage: 'https://dolphin-emu.org:444/download/' },
  { releasePage: 'https://dolphin-emu.org/download/#payload' },
  { run: 'shell command' },
  { schemaVersion: 2 },
  { systems: ['../gc'] },
  { romExtensions: ['.iso', '.iso'] },
  { capabilities: { launch: 'working' } },
])('rejects untrusted manifest patch %p', (patch) => {
  expect(() =>
    validateManifest({ ...dolphin.manifest, ...patch }, policy),
  ).toThrow();
});
test.each([null, [], 'text', 3])('rejects malformed manifest %p', (input) => {
  expect(() => validateManifest(input, policy)).toThrow();
});
test.each(['arm64', 'x64'])('accepts native %s', (architecture) => {
  expect(
    checkCompatibility(dolphin.manifest, {
      platform: 'darwin',
      architecture,
      osVersion: '11.0',
    }).compatible,
  ).toBe(true);
});
test.each([
  { platform: 'linux', architecture: 'arm64', osVersion: '26.0' },
  { platform: 'darwin', architecture: 'ia32', osVersion: '26.0' },
  { platform: 'darwin', architecture: 'arm64', osVersion: '10.15.7' },
  { platform: 'darwin', architecture: 'arm64', osVersion: 'unknown' },
])('rejects unsupported host %p', (host) => {
  expect(checkCompatibility(dolphin.manifest, host).compatible).toBe(false);
});
const libraryRoot = '/Volumes/Game Library 日本語';
const appBundlePath = '/Users/test/Applications/Dolphin.app';
test('preserves shell metacharacters as a single argument', () => {
  const romPath = `${libraryRoot}/roms/gc/test $(touch bad);'".dol`;
  const plan = dolphin.planLaunch({ libraryRoot, appBundlePath, romPath });
  expect(plan.executable).toBe(`${appBundlePath}/Contents/MacOS/Dolphin`);
  expect(plan.args).toEqual([
    '--user',
    `${libraryRoot}/emulators/dolphin/User`,
    '--batch',
    '--exec',
    romPath,
  ]);
});
test('console launches override confirmation and fullscreen per launch only', () => {
  const romPath = `${libraryRoot}/roms/gc/game.iso`;
  const plan = dolphin.planLaunch({
    libraryRoot,
    appBundlePath,
    romPath,
    presentation: 'console',
  });
  expect(plan.args).toEqual([
    '--user',
    `${libraryRoot}/emulators/dolphin/User`,
    '--config',
    'Dolphin.Interface.ConfirmStop=False',
    '--config',
    'Dolphin.Display.Fullscreen=True',
    '--batch',
    '--exec',
    romPath,
  ]);
  // The ROM is still the single final argument after any overrides.
  expect(plan.args[plan.args.length - 1]).toBe(romPath);
});
test('keeps saves and states outside resettable configuration', () => {
  const p = dolphin.paths(libraryRoot);
  expect(p.configuration).toBe(`${p.user}/Config`);
  expect(p.saves).toBe(`${p.user}/GC`);
  expect(p.states).toBe(`${p.user}/StateSaves`);
  expect(p.saves.startsWith(`${p.configuration}/`)).toBe(false);
});
test.each([
  'relative',
  '/tmp/../saves',
  '/tmp/./games',
  '/tmp/evil\u0000',
  '/tmp/back\\slash',
])('rejects malformed path %p', (value) => {
  expect(() => absolutePath(value)).toThrow();
});
test.each([
  '/tmp/game.dol',
  `${libraryRoot}/roms/gc-other/game.dol`,
  `${libraryRoot}/roms/gc/../game.dol`,
  `${libraryRoot}/roms/gc/game.sh`,
])('rejects invalid ROM %s', (romPath) => {
  expect(() =>
    dolphin.planLaunch({ libraryRoot, appBundlePath, romPath }),
  ).toThrow();
});
test('rejects alternate bundle', () => {
  expect(() =>
    dolphin.planLaunch({
      libraryRoot,
      appBundlePath: '/Applications/Evil.app',
      romPath: `${libraryRoot}/roms/gc/game.dol`,
    }),
  ).toThrow();
});
