/* eslint-disable no-bitwise -- POSIX permission checks and no-follow open flags are bit masks. */
import fs from 'fs/promises';
import { constants, Stats } from 'fs';
import path from 'path';

export interface CatalogEntry {
  id: string;
  name: string;
}

export interface Catalog {
  root: string;
  home: string;
  helperPath: string;
  romDirectory: string;
  gamelistPath: string;
  systemsPath: string;
  findRulesPath: string;
  command: string;
  markers: Readonly<Record<string, string>>;
}

const MAX_ENTRIES = 10000;
const MAX_NAME_LENGTH = 1024;
const MAX_NAME_BYTES = 4 * 1024 * 1024;

function displayName(name: string, id: string): string {
  const valid = Array.from(name)
    .filter((character) => {
      const point = character.codePointAt(0) as number;
      return (
        point === 0x09 ||
        point === 0x0a ||
        point === 0x0d ||
        (point >= 0x20 && point <= 0xd7ff) ||
        (point >= 0xe000 && point <= 0xfffd) ||
        (point >= 0x10000 && point <= 0x10ffff)
      );
    })
    .join('');
  return valid || id;
}

function xmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\r/g, '&#13;');
}

function snapshotEntries(entries: readonly CatalogEntry[]): CatalogEntry[] {
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES)
    throw new Error('Catalog entry count exceeds the supported limit');
  const ids = new Set<string>();
  let bytes = 0;
  return Array.from(entries).map((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Object.keys(entry).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(entry, 'id') ||
      !Object.prototype.hasOwnProperty.call(entry, 'name') ||
      typeof entry.id !== 'string' ||
      entry.id.length !== 32 ||
      !/^[a-f0-9]{32}$/.test(entry.id) ||
      ids.has(entry.id)
    )
      throw new Error(
        'Catalog requires unique opaque lowercase hexadecimal IDs',
      );
    if (typeof entry.name !== 'string' || entry.name.length > MAX_NAME_LENGTH)
      throw new Error('Catalog display name exceeds the supported limit');
    bytes += Buffer.byteLength(entry.name, 'utf8');
    if (bytes > MAX_NAME_BYTES)
      throw new Error('Catalog display metadata exceeds the supported limit');
    ids.add(entry.id);
    return { id: entry.id, name: displayName(entry.name, entry.id) };
  });
}

function privateDirectory(stat: Stats, uid: number): boolean {
  return (
    stat.isDirectory() &&
    !stat.isSymbolicLink() &&
    stat.uid === uid &&
    (stat.mode & 0o7777) === 0o700
  );
}

async function assertRoot(
  root: string,
  uid: number,
  identity?: Stats,
): Promise<Stats> {
  const stat = await fs.lstat(root);
  if (
    !privateDirectory(stat, uid) ||
    (identity && (stat.dev !== identity.dev || stat.ino !== identity.ino)) ||
    (await fs.realpath(root)) !== root
  )
    throw new Error('Catalog root must be canonical, owned and private');
  return stat;
}

async function assertHelper(helper: string, uid: number): Promise<void> {
  const expected = await fs.lstat(helper);
  const supported = (stat: Stats) =>
    stat.isFile() &&
    !stat.isSymbolicLink() &&
    stat.uid === uid &&
    stat.nlink === 1 &&
    (stat.mode & 0o100) !== 0 &&
    (stat.mode & 0o7022) === 0;
  if (!supported(expected))
    throw new Error('Catalog helper must be an owned regular executable');
  const handle = await fs.open(
    helper,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const opened = await handle.stat();
    if (
      !supported(opened) ||
      opened.dev !== expected.dev ||
      opened.ino !== expected.ino
    )
      throw new Error('Catalog helper changed during inspection');
  } finally {
    await handle.close();
  }
}

async function absent(target: string): Promise<void> {
  try {
    await fs.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error('Existing catalog or profile is preserved');
}

/**
 * Build only disposable owned state. The caller first copies its verified native
 * helper to root/helper and keeps opaque-ID -> original-ROM mappings in memory.
 * Never run this concurrently with a process modifying the private session root.
 * Failure leaves partial owned state for the caller to discard; no recursive
 * rollback can accidentally delete a directory replaced during construction.
 */
export async function createCatalog(
  root: string,
  entries: readonly CatalogEntry[],
): Promise<Catalog> {
  if (
    typeof root !== 'string' ||
    root.length > 512 ||
    root.length < 2 ||
    !root.startsWith('/') ||
    /[^A-Za-z0-9._/-]/.test(root) ||
    path.resolve(root) !== root
  )
    throw new Error('Catalog root requires a bounded absolute ASCII path');
  const uid = process.getuid?.();
  if (uid === undefined)
    throw new Error('Catalog requires POSIX ownership checks');
  // Snapshot before the first await so caller mutation cannot alter checked IDs.
  const games = snapshotEntries(entries);
  const identity = await assertRoot(root, uid);
  const helperPath = path.join(root, 'helper');
  await assertHelper(helperPath, uid);
  const home = path.join(root, 'home');
  const appData = path.join(home, 'ES-DE');
  const systemsDirectory = path.join(appData, 'custom_systems');
  const gamelists = path.join(appData, 'gamelists');
  const gamelistDirectory = path.join(gamelists, 'gc');
  const roms = path.join(root, 'roms');
  const romDirectory = path.join(roms, 'gc');
  const systemsPath = path.join(systemsDirectory, 'es_systems.xml');
  const findRulesPath = path.join(systemsDirectory, 'es_find_rules.xml');
  const gamelistPath = path.join(gamelistDirectory, 'gamelist.xml');
  await Promise.all([absent(home), absent(roms)]);
  const directories = [
    home,
    appData,
    systemsDirectory,
    gamelists,
    gamelistDirectory,
    roms,
    romDirectory,
  ];
  /* eslint-disable no-restricted-syntax, no-await-in-loop -- Exclusive mutations run in a deterministic order. */
  for (const directory of directories) {
    await assertRoot(root, uid, identity);
    await fs.mkdir(directory, { mode: 0o700 });
    const stat = await fs.lstat(directory);
    if (
      !privateDirectory(stat, uid) ||
      (await fs.realpath(directory)) !== directory
    )
      throw new Error('Catalog directory boundary changed');
  }

  const markers: Record<string, string> = {};
  for (const game of games) {
    await assertRoot(root, uid, identity);
    const marker = path.join(romDirectory, `${game.id}.ewgame`);
    await fs.writeFile(marker, '', { flag: 'wx', mode: 0o600 });
    markers[game.id] = marker;
  }
  /* eslint-enable no-restricted-syntax, no-await-in-loop */

  const command = `'${helperPath}' --session '${root}' --game %ROM%`;
  const declaration = '<?xml version="1.0" encoding="UTF-8"?>\n';
  const gamelist = `${declaration}<gameList>\n${games
    .map(
      (game) =>
        `  <game><path>./${game.id}.ewgame</path><name>${xmlText(game.name)}</name></game>`,
    )
    .join('\n')}\n</gameList>\n`;
  // ES-DE deliberately reads loadExclusive as a top-level sibling (pugixml).
  const systems = `${declaration}<loadExclusive/>\n<systemList>\n  <system>\n    <name>gc</name>\n    <fullname>Nintendo GameCube</fullname>\n    <path>${romDirectory}</path>\n    <extension>.ewgame</extension>\n    <command label="Dolphin">${xmlText(command)}</command>\n    <platform>gc</platform>\n    <theme>gc</theme>\n  </system>\n</systemList>\n`;
  await assertRoot(root, uid, identity);
  await fs.writeFile(gamelistPath, gamelist, { flag: 'wx', mode: 0o600 });
  // A literal helper command needs no discovery rules or additional emulators.
  await fs.writeFile(findRulesPath, `${declaration}<ruleList/>\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  // Publish the launch profile last, after its markers and gamelist exist.
  await fs.writeFile(systemsPath, systems, { flag: 'wx', mode: 0o600 });
  await assertRoot(root, uid, identity);
  await assertHelper(helperPath, uid);
  return Object.freeze({
    root,
    home,
    helperPath,
    romDirectory,
    gamelistPath,
    systemsPath,
    findRulesPath,
    command,
    markers: Object.freeze(markers),
  });
}
