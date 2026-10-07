/* eslint-disable no-bitwise -- POSIX permission checks are bit masks. */
import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import type { Catalog, CatalogEntry } from './catalog';
import { managedSettings } from './settings';
import type { ManagedSettingsOptions } from './settings';

/**
 * The persistent Console Mode profile (ES-DE --home). ES-DE owns most of it:
 * favorites, play counts, themes and settings survive sessions. Each start this
 * module regenerates only what launches games (systems, find rules, the gamelist
 * paths) and re-applies the safety-critical settings. Per-session secrets, the
 * socket, the helper copy and the opaque markers live in a separate disposable
 * catalog root, never here.
 */

const MAX_GAMELIST_BYTES = 8 * 1024 * 1024;
const MAX_SETTINGS_BYTES = 256 * 1024;
const MAX_RETAINED = 20000;
// ES-DE metadata kept across regeneration. Anything else, notably <altemulator>
// (which selects a launch command) and <path>, is never carried over.
const keptFields = new Set([
  'name',
  'sortname',
  'collectionsortname',
  'desc',
  'rating',
  'releasedate',
  'developer',
  'publisher',
  'genre',
  'players',
  'favorite',
  'completed',
  'kidgame',
  'broken',
  'hidden',
  'nogamecount',
  'nomultiscrape',
  'hidemetadata',
  'playcount',
  // Seconds; observed in a gamelist written by ES-DE 3.5.0.
  'playtime',
  'lastplayed',
  'controller',
]);
const fieldPattern = /<([a-z]{1,32})>([^<]{0,8192})<\/\1>|<([a-z]{1,32}) ?\/>/g;
const badEntity = /&(?!(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/;

type Fields = Map<string, string>;

function xmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Parses only well-formed <game> blocks whose path is exactly an opaque marker. */
export function parseGamelist(xml: string): Map<string, Fields> {
  const games = new Map<string, Fields>();
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > MAX_GAMELIST_BYTES)
    return games;
  const blocks = xml.match(/<game>[\s\S]*?<\/game>/g) || [];
  blocks.forEach((block) => {
    if (games.size >= MAX_RETAINED) return;
    const body = block.slice('<game>'.length, -'</game>'.length);
    const fields: Fields = new Map();
    let id: string | null = null;
    let paths = 0;
    // Everything in the block must be a simple field; nested markup is rejected.
    const rest = body.replace(fieldPattern, (_match, tag, text) => {
      if (!tag) return '';
      if (tag === 'path') {
        paths += 1;
        const marker = /^\.\/([a-f0-9]{32})\.ewgame$/.exec(text);
        id = marker ? marker[1] : null;
      } else if (keptFields.has(tag) && !badEntity.test(text)) {
        fields.set(tag, text);
      }
      return '';
    });
    if (rest.trim() || paths !== 1 || !id || games.has(id)) return;
    games.set(id, fields);
  });
  return games;
}

function serialize(id: string, fields: Fields): string {
  const lines = [`    <path>./${id}.ewgame</path>`];
  fields.forEach((text, tag) => lines.push(`    <${tag}>${text}</${tag}>`));
  return `  <game>\n${lines.join('\n')}\n  </game>`;
}

const declaration = '<?xml version="1.0"?>\n';

/**
 * Current games keep their own metadata (the user's name edits win). Games whose
 * files are temporarily missing (an unplugged drive) move to a retained list and
 * regain their metadata when they return, instead of being lost.
 */
export function mergeGamelist(
  existing: string,
  retained: string,
  games: readonly CatalogEntry[],
): { gamelist: string; retained: string } {
  const known = parseGamelist(retained);
  parseGamelist(existing).forEach((fields, id) => known.set(id, fields));
  const current = new Set(games.map((game) => game.id));
  const active = games.map((game) => {
    const fields: Fields = new Map(known.get(game.id) || []);
    if (!fields.get('name')) fields.set('name', xmlText(game.name));
    return serialize(game.id, fields);
  });
  const kept = [...known.entries()]
    .filter(([id]) => !current.has(id))
    .slice(0, MAX_RETAINED)
    .map(([id, fields]) => serialize(id, fields));
  return {
    gamelist: `${declaration}<gameList>\n${active.join('\n')}\n</gameList>\n`,
    retained: `${declaration}<gameList>\n${kept.join('\n')}\n</gameList>\n`,
  };
}

async function privateDirectory(directory: string, uid: number): Promise<void> {
  await fs.mkdir(directory, { mode: 0o700 }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  });
  const stat = await fs.lstat(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== uid ||
    (stat.mode & 0o022) !== 0 ||
    (await fs.realpath(directory)) !== directory
  )
    throw new Error('Console profile directory is not a private real folder');
}

/** Reads a profile file only if it is an owned, bounded regular file. */
async function readOwned(
  file: string,
  uid: number,
  limit: number,
): Promise<string> {
  try {
    const stat = await fs.lstat(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.uid !== uid ||
      stat.size > limit
    )
      throw new Error('Console profile file is not a regular owned file');
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

/** Write-then-rename so ES-DE never reads a half-written file. */
async function replaceFile(file: string, content: string, uid: number) {
  await readOwned(file, uid, Number.MAX_SAFE_INTEGER);
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`,
  );
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, file);
}

export interface PublishedProfile {
  home: string;
  appData: string;
}

export async function publishProfile(
  home: string,
  catalog: Catalog,
  /** Entries per ES-DE system id; a plain list means GameCube. */
  games:
    readonly CatalogEntry[] | Readonly<Record<string, readonly CatalogEntry[]>>,
  options: ManagedSettingsOptions = {},
): Promise<PublishedProfile> {
  const bySystem: Readonly<Record<string, readonly CatalogEntry[]>> =
    Array.isArray(games)
      ? { gc: games as readonly CatalogEntry[] }
      : (games as Readonly<Record<string, readonly CatalogEntry[]>>);
  const systemIDs = Object.keys(bySystem);
  if (
    systemIDs.length > 32 ||
    systemIDs.some((id) => !/^[a-z0-9]{1,16}$/.test(id))
  )
    throw new Error('Console profile requires valid system ids');
  if (
    typeof home !== 'string' ||
    !path.isAbsolute(home) ||
    path.resolve(home) !== home ||
    home.includes('\0')
  )
    throw new Error('Console profile requires an absolute normalized path');
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error('Console profile requires POSIX');
  const appData = path.join(home, 'ES-DE');
  const directories = [
    home,
    appData,
    path.join(appData, 'custom_systems'),
    path.join(appData, 'settings'),
    path.join(appData, 'gamelists'),
    ...systemIDs.map((id) => path.join(appData, 'gamelists', id)),
  ];
  /* eslint-disable no-restricted-syntax, no-await-in-loop -- Parents before children. */
  for (const directory of directories) await privateDirectory(directory, uid);
  /* eslint-enable no-restricted-syntax, no-await-in-loop */
  // Event scripts are disabled in settings; a populated scripts folder is still
  // refused so a stale or planted script can never run if settings are edited.
  const scripts = await fs
    .readdir(path.join(appData, 'scripts'))
    .catch(() => [] as string[]);
  if (scripts.some((name) => !name.startsWith('.')))
    throw new Error('Console profile contains event scripts');

  const systems = path.join(appData, 'custom_systems', 'es_systems.xml');
  const findRules = path.join(appData, 'custom_systems', 'es_find_rules.xml');
  const settings = path.join(appData, 'settings', 'es_settings.xml');
  await replaceFile(
    systems,
    await readOwned(catalog.systemsPath, uid, 1024 * 1024),
    uid,
  );
  await replaceFile(
    findRules,
    await readOwned(catalog.findRulesPath, uid, 1024 * 1024),
    uid,
  );
  await replaceFile(
    settings,
    managedSettings(
      await readOwned(settings, uid, MAX_SETTINGS_BYTES),
      options,
    ),
    uid,
  );
  // Each system's metadata is merged independently and keyed by its own ids.
  /* eslint-disable no-restricted-syntax, no-await-in-loop -- Sequential per system. */
  for (const id of systemIDs) {
    const gamelist = path.join(appData, 'gamelists', id, 'gamelist.xml');
    const retained = path.join(
      appData,
      'gamelists',
      id,
      'emulation-workspace-retained.xml',
    );
    const merged = mergeGamelist(
      await readOwned(gamelist, uid, MAX_GAMELIST_BYTES),
      await readOwned(retained, uid, MAX_GAMELIST_BYTES),
      bySystem[id],
    );
    await replaceFile(retained, merged.retained, uid);
    await replaceFile(gamelist, merged.gamelist, uid);
  }
  /* eslint-enable no-restricted-syntax, no-await-in-loop */
  return Object.freeze({ home, appData });
}
