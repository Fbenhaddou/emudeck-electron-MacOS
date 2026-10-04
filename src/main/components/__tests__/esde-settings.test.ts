import { managedSettings, parseSettings } from '../es-de/settings';

const values = (xml: string) =>
  Object.fromEntries(
    [...parseSettings(xml).entries()].map(([name, setting]) => [
      name,
      setting.value,
    ]),
  );

describe('ES-DE managed settings', () => {
  it('forces the keys that keep Console Mode safe and exitable', () => {
    const result = values(managedSettings(''));
    expect(result).toMatchObject({
      RunInBackground: 'false',
      CustomEventScripts: 'false',
      CustomEventScriptsBrowsing: 'false',
      ApplicationUpdaterFrequency: 'never',
      ForceKiosk: 'false',
      KeyboardQuitShortcut: 'CmdQ',
      StartupSystem: 'gc',
      StartupView: 'gamelist',
    });
    expect(result.InputControllerType).toBeUndefined();
  });

  it('overrides unsafe user values but keeps their own preferences', () => {
    const existing = [
      '<?xml version="1.0"?>',
      '<bool name="RunInBackground" value="true" />',
      '<bool name="CustomEventScripts" value="true" />',
      '<string name="ApplicationUpdaterFrequency" value="always" />',
      '<string name="ThemeSet" value="linear-es-de" />',
      '<bool name="NavigationSounds" value="false" />',
      '<string name="StartupSystem" value="favorites" />',
    ].join('\n');
    const result = values(managedSettings(existing));
    expect(result.RunInBackground).toBe('false');
    expect(result.CustomEventScripts).toBe('false');
    expect(result.ApplicationUpdaterFrequency).toBe('never');
    expect(result.ThemeSet).toBe('linear-es-de');
    expect(result.NavigationSounds).toBe('false');
    expect(result.StartupSystem).toBe('favorites');
  });

  it.each(['kiosk', 'KIOSK', ''])('replaces UI mode %p with full', (mode) => {
    const result = values(
      managedSettings(`<string name="UIMode" value="${mode}" />`),
    );
    expect(result.UIMode).toBe('full');
  });

  it('keeps the kid UI mode, which still offers QUIT ES-DE', () => {
    expect(
      values(managedSettings('<string name="UIMode" value="kid" />')).UIMode,
    ).toBe('kid');
  });

  it('sets controller glyphs only when a controller type is supplied', () => {
    expect(
      values(managedSettings('', { controllerType: 'ps5' }))
        .InputControllerType,
    ).toBe('ps5');
  });

  it.each([
    '<string name="ThemeSet" value="x" /><bool name="RunInBackground" value="true" />',
    '<string name="ThemeSet" value="a&quot;b" />',
    '<string name="Theme Set" value="x" />',
    '<bool name="ParseGamelistOnly" value="yes" />',
    '<int name="MaxVRAM" value="1e9" />',
    '<script name="X" value="y" />',
  ])('drops malformed or smuggled entries: %s', (line) => {
    const output = managedSettings(line);
    expect(output.match(/RunInBackground/g)).toHaveLength(1);
    expect(output).toContain('<bool name="RunInBackground" value="false" />');
    expect(output).not.toContain('ThemeSet');
    expect(output).not.toContain('Theme Set');
    expect(output).not.toContain('ParseGamelistOnly');
    expect(output).not.toContain('MaxVRAM');
    expect(output).not.toContain('<script');
  });

  it('ignores oversized input instead of parsing it', () => {
    const huge = `<string name="ThemeSet" value="x" />\n`.repeat(20000);
    expect(managedSettings(huge)).not.toContain('ThemeSet');
  });

  it('is deterministic and idempotent', () => {
    const once = managedSettings('<string name="ThemeSet" value="x" />');
    expect(managedSettings(once)).toBe(once);
  });
});
