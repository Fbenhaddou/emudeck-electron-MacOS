/**
 * ES-DE settings for the persistent Console Mode profile. ES-DE writes
 * es_settings.xml as top-level <bool|int|float|string name value/> siblings. The
 * user's own preferences (theme, sounds, sort order) survive regeneration, but the
 * keys that keep Console Mode safe and controller-exitable are always forced.
 */
type SettingType = 'bool' | 'int' | 'float' | 'string';
interface Setting {
  type: SettingType;
  value: string;
}

const MAX_SETTINGS_BYTES = 256 * 1024;
const MAX_SETTINGS = 1024;
const entryPattern =
  /^\s*<(bool|int|float|string) name="([A-Za-z][A-Za-z0-9]{0,63})" value="([^"<>&\r\n]{0,512})" ?\/>\s*$/;
const valuePatterns: Record<SettingType, RegExp> = {
  bool: /^(true|false)$/,
  int: /^-?\d{1,9}$/,
  float: /^-?\d{1,9}(\.\d{1,9})?$/,
  string: /^[^"<>&\r\n]{0,512}$/,
};

export type ControllerType = 'xbox' | 'ps4' | 'ps5' | 'switchpro';

export interface ManagedSettingsOptions {
  /** Glyph set ES-DE shows; set from detected controllers, never guessed. */
  controllerType?: ControllerType;
}

/** Forced on every start; see docs/research/console-mode.md §2 Phase B. */
function forced(options: ManagedSettingsOptions): Record<string, Setting> {
  return {
    // A background ES-DE uses system() and loses the exact-child wait.
    RunInBackground: { type: 'bool', value: 'false' },
    // Event scripts would execute arbitrary profile-local programs.
    CustomEventScripts: { type: 'bool', value: 'false' },
    CustomEventScriptsBrowsing: { type: 'bool', value: 'false' },
    // Updates come only from reviewed manifests, never ES-DE's own DMG download.
    ApplicationUpdaterFrequency: { type: 'string', value: 'never' },
    // Kiosk mode hides QUIT ES-DE, the only controller path back to the manager.
    ForceKiosk: { type: 'bool', value: 'false' },
    KeyboardQuitShortcut: { type: 'string', value: 'CmdQ' },
    ...(options.controllerType
      ? {
          InputControllerType: {
            type: 'string' as const,
            value: options.controllerType,
          },
        }
      : {}),
  };
}

/** Applied only when the user has not chosen a value. */
const defaults: Record<string, Setting> = {
  StartupSystem: { type: 'string', value: 'gc' },
  StartupView: { type: 'string', value: 'gamelist' },
  SaveGamelistsMode: { type: 'string', value: 'always' },
};

/** Parses only well-formed entries; anything else is dropped, never echoed. */
export function parseSettings(xml: string): Map<string, Setting> {
  const settings = new Map<string, Setting>();
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > MAX_SETTINGS_BYTES)
    return settings;
  xml.split('\n').forEach((line) => {
    if (settings.size >= MAX_SETTINGS) return;
    const match = entryPattern.exec(line);
    if (!match) return;
    const [, type, name, value] = match as unknown as [
      string,
      SettingType,
      string,
      string,
    ];
    if (valuePatterns[type].test(value)) settings.set(name, { type, value });
  });
  return settings;
}

export function managedSettings(
  existingXML: string,
  options: ManagedSettingsOptions = {},
): string {
  const settings = parseSettings(existingXML);
  // UIMode is the user's choice, except that kiosk would remove the controller exit.
  const mode = settings.get('UIMode');
  if (mode && !(mode.type === 'string' && ['full', 'kid'].includes(mode.value)))
    settings.set('UIMode', { type: 'string', value: 'full' });
  Object.entries(defaults).forEach(([name, setting]) => {
    if (!settings.has(name)) settings.set(name, setting);
  });
  Object.entries(forced(options)).forEach(([name, setting]) =>
    settings.set(name, setting),
  );
  const lines = [...settings.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([name, setting]) =>
        `<${setting.type} name="${name}" value="${setting.value}" />`,
    );
  return `<?xml version="1.0"?>\n${lines.join('\n')}\n`;
}
