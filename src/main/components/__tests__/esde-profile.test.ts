import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { mergeGamelist, parseGamelist, publishProfile } from '../es-de/profile';
import type { Catalog } from '../es-de/catalog';

const a = 'ccecb4cf240dc6f8896c8b49bb76d342';
const b = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
// Verbatim structure of a gamelist written by ES-DE 3.5.0 after three plays.
const written = `<?xml version="1.0"?>
<gameList>
\t<game>
\t\t<path>./${a}.ewgame</path>
\t\t<name>240p Test Suite — original Unicode / \`backtick\` | &amp; %ROM% name</name>
\t\t<playcount>3</playcount>
\t\t<playtime>150</playtime>
\t\t<lastplayed>20261005T000957</lastplayed>
\t</game>
</gameList>
`;

describe('gamelist merge', () => {
  it('keeps ES-DE play statistics and the user-visible name', () => {
    const { gamelist } = mergeGamelist(written, '', [
      { id: a, name: 'ignored new name' },
    ]);
    const fields = parseGamelist(gamelist).get(a)!;
    expect(fields.get('playcount')).toBe('3');
    expect(fields.get('playtime')).toBe('150');
    expect(fields.get('lastplayed')).toBe('20261005T000957');
    expect(fields.get('name')).toContain('&amp; %ROM% name');
  });

  it('names new games from the catalog with XML escaping', () => {
    const { gamelist } = mergeGamelist('', '', [
      { id: b, name: 'A & B <x> "q"' },
    ]);
    expect(gamelist).toContain(
      '<name>A &amp; B &lt;x&gt; &quot;q&quot;</name>',
    );
  });

  it('retains metadata for a missing game and restores it when it returns', () => {
    const away = mergeGamelist(written, '', []);
    expect(parseGamelist(away.gamelist).size).toBe(0);
    expect(parseGamelist(away.retained).get(a)?.get('playcount')).toBe('3');
    const back = mergeGamelist(away.gamelist, away.retained, [
      { id: a, name: 'x' },
    ]);
    expect(parseGamelist(back.gamelist).get(a)?.get('playtime')).toBe('150');
    expect(parseGamelist(back.retained).size).toBe(0);
  });

  it('never carries over a launch-command selector or a foreign path', () => {
    const hostile = `<gameList>
<game><path>./${a}.ewgame</path><altemulator>Evil</altemulator><name>x</name></game>
<game><path>/etc/passwd</path><name>y</name></game>
<game><path>./${b}.ewgame</path><path>./${a}.ewgame</path></game>
<game><path>./${b}.ewgame</path><desc><b>nested</b></desc></game>
<game><path>./${b}.ewgame</path><name>bad &entity</name></game>
</gameList>`;
    const parsed = parseGamelist(hostile);
    expect([...parsed.keys()]).toEqual([a, b]);
    expect(parsed.get(a)!.has('altemulator')).toBe(false);
    // Block 4 (nested markup) is rejected whole; block 5 keeps only valid fields.
    expect(parsed.get(b)!.has('name')).toBe(false);
    const { gamelist } = mergeGamelist(hostile, '', [{ id: a, name: 'z' }]);
    expect(gamelist).not.toContain('altemulator');
    expect(gamelist).not.toContain('/etc/passwd');
  });

  it('is idempotent', () => {
    const once = mergeGamelist(written, '', [{ id: a, name: 'x' }]);
    const twice = mergeGamelist(once.gamelist, once.retained, [
      { id: a, name: 'x' },
    ]);
    expect(twice).toEqual(once);
  });
});

describe('publishProfile', () => {
  let root: string;
  let catalog: Catalog;
  beforeEach(async () => {
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'esde-profile-')),
    );
    const systemsPath = path.join(root, 'systems.xml');
    const findRulesPath = path.join(root, 'rules.xml');
    await fs.writeFile(systemsPath, '<systemList/>\n', { mode: 0o600 });
    await fs.writeFile(findRulesPath, '<ruleList/>\n', { mode: 0o600 });
    catalog = { systemsPath, findRulesPath } as Catalog;
  });
  afterEach(() => fs.rm(root, { recursive: true, force: true }));

  it('publishes launch files and forced settings, keeping user metadata', async () => {
    const home = path.join(root, 'home');
    await publishProfile(home, catalog, [{ id: a, name: 'x' }]);
    const gamelists = path.join(home, 'ES-DE', 'gamelists', 'gc');
    await fs.writeFile(path.join(gamelists, 'gamelist.xml'), written);
    const settings = path.join(home, 'ES-DE', 'settings', 'es_settings.xml');
    await fs.writeFile(
      settings,
      '<string name="ThemeSet" value="modern-es-de" />\n<bool name="RunInBackground" value="true" />\n',
    );
    await publishProfile(home, catalog, [{ id: a, name: 'x' }]);
    const list = await fs.readFile(
      path.join(gamelists, 'gamelist.xml'),
      'utf8',
    );
    expect(list).toContain('<playtime>150</playtime>');
    const saved = await fs.readFile(settings, 'utf8');
    expect(saved).toContain('value="modern-es-de"');
    expect(saved).toContain('<bool name="RunInBackground" value="false" />');
    expect(
      await fs.readFile(
        path.join(home, 'ES-DE', 'custom_systems', 'es_systems.xml'),
        'utf8',
      ),
    ).toBe('<systemList/>\n');
    // No temporary files are left behind.
    expect(
      (await fs.readdir(gamelists)).filter((name) => name.endsWith('.tmp')),
    ).toEqual([]);
  });

  it('refuses a profile containing event scripts', async () => {
    const home = path.join(root, 'home');
    await fs.mkdir(path.join(home, 'ES-DE', 'scripts', 'game-start'), {
      recursive: true,
      mode: 0o700,
    });
    await expect(publishProfile(home, catalog, [])).rejects.toThrow(
      'event scripts',
    );
  });

  it('refuses a symlinked profile file instead of following it', async () => {
    const home = path.join(root, 'home');
    await publishProfile(home, catalog, []);
    const target = path.join(root, 'outside.xml');
    await fs.writeFile(target, 'keep');
    const settings = path.join(home, 'ES-DE', 'settings', 'es_settings.xml');
    await fs.rm(settings);
    await fs.symlink(target, settings);
    await expect(publishProfile(home, catalog, [])).rejects.toThrow();
    expect(await fs.readFile(target, 'utf8')).toBe('keep');
  });

  it('refuses a symlinked profile directory', async () => {
    const real = path.join(root, 'real');
    await fs.mkdir(real, { mode: 0o700 });
    const home = path.join(root, 'link');
    await fs.symlink(real, home);
    await expect(publishProfile(home, catalog, [])).rejects.toThrow(
      'private real folder',
    );
  });
});
