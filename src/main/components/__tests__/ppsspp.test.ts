import { ppsspp, ppssppApp } from '../ppsspp';
import { getComponent } from '..';

const libraryRoot = '/Volumes/Game Library 日本語';
const appBundlePath =
  '/Users/test/Library/Application Support/x/1.20.4/PPSSPPSDL.app';

describe('PPSSPP component', () => {
  it('is registered for PSP with the verified bundle and executable', () => {
    expect(getComponent('ppsspp')).toBe(ppsspp);
    expect(ppsspp.manifest.systems).toEqual(['psp']);
    expect(ppsspp.manifest.executable).toBe('Contents/MacOS/PPSSPPSDL');
    expect(ppssppApp.spec).toMatchObject({
      bundleIdentifier: 'org.ppsspp.ppsspp',
      teamIdentifier: '97NS59EENG',
      license: 'none',
    });
  });

  it('isolates everything under the library through HOME', () => {
    const p = ppsspp.paths(libraryRoot);
    expect(p.user).toBe(`${libraryRoot}/emulators/ppsspp`);
    expect(p.configuration).toBe(`${p.user}/.config/ppsspp/PSP/SYSTEM`);
    expect(p.saves).toBe(`${p.user}/.config/ppsspp/PSP/SAVEDATA`);
    expect(p.states).toBe(`${p.user}/.config/ppsspp/PSP/PPSSPP_STATE`);
    expect(p.saves.startsWith(`${p.configuration}/`)).toBe(false);
  });

  it('keeps a hostile file name as one argument and sets HOME', () => {
    const romPath = `${libraryRoot}/roms/psp/game $(touch bad); \`x\` | &.pbp`;
    const plan = ppsspp.planLaunch({ libraryRoot, appBundlePath, romPath });
    expect(plan.executable).toBe(`${appBundlePath}/Contents/MacOS/PPSSPPSDL`);
    expect(plan.args).toEqual([romPath]);
    expect(plan.env).toEqual({ HOME: `${libraryRoot}/emulators/ppsspp` });
  });

  it('adds fullscreen and pause-menu exit only in Console Mode', () => {
    const romPath = `${libraryRoot}/roms/psp/homebrew.elf`;
    const plan = ppsspp.planLaunch({
      libraryRoot,
      appBundlePath,
      romPath,
      presentation: 'console',
    });
    expect(plan.args).toEqual(['--fullscreen', '--pause-menu-exit', romPath]);
  });

  it.each([
    `${libraryRoot}/roms/gc/game.iso`,
    `${libraryRoot}/roms/psp/archive.zip`,
    '/tmp/game.iso',
    `${libraryRoot}/roms/psp/../psp-evil/game.iso`,
  ])('refuses %s', (romPath) => {
    expect(() =>
      ppsspp.planLaunch({ libraryRoot, appBundlePath, romPath }),
    ).toThrow();
  });

  it('refuses a different application bundle', () => {
    expect(() =>
      ppsspp.planLaunch({
        libraryRoot,
        appBundlePath: '/Applications/Other.app',
        romPath: `${libraryRoot}/roms/psp/game.iso`,
      }),
    ).toThrow('Unexpected application bundle');
  });
});
