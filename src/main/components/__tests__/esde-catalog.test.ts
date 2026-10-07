/** @jest-environment jsdom */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  createCatalog,
  createSystemsCatalog,
  CatalogEntry,
} from '../es-de/catalog';

let root: string;
const first = 'a'.repeat(32);
const second = 'b'.repeat(32);

beforeEach(async () => {
  const temporary = await fs.realpath(os.tmpdir());
  root = await fs.mkdtemp(path.join(temporary, 'esde-catalog-test-'));
  await fs.chmod(root, 0o700);
  await fs.writeFile(path.join(root, 'helper'), 'owned test placeholder\n', {
    mode: 0o700,
    flag: 'wx',
  });
});

afterEach(async () => {
  jest.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

function parseXML(text: string, fragment = false): Document {
  // ES-DE's loadExclusive is a documented top-level fragment, not a child tag.
  const input = fragment
    ? `<document>${text.replace(/^<\?xml[^?]*\?>\s*/, '')}</document>`
    : text;
  const document = new DOMParser().parseFromString(input, 'application/xml');
  expect(document.querySelector('parsererror')).toBeNull();
  return document;
}

test('creates only opaque markers and a GameCube-exclusive launch profile', async () => {
  const names = [
    '/Users/private/Original `touch injected`|$(evil) & <tag> "quote".dol',
    "العربية 日本語 🎮 & 'quoted'\nsecond line\rthird line",
  ];
  const catalog = await createCatalog(root, [
    { id: first, name: names[0] },
    { id: second, name: names[1] },
  ]);
  expect(catalog.home).toBe(path.join(root, 'home'));
  expect(catalog.gamelistPath).toBe(
    path.join(root, 'home/ES-DE/gamelists/gc/gamelist.xml'),
  );
  const systems = parseXML(
    await fs.readFile(catalog.systemsPath, 'utf8'),
    true,
  );
  expect(systems.querySelectorAll('loadExclusive')).toHaveLength(1);
  expect(systems.querySelectorAll('system')).toHaveLength(1);
  expect(systems.querySelector('system > name')?.textContent).toBe('gc');
  expect(systems.querySelector('system > path')?.textContent).toBe(
    path.join(root, 'roms/gc'),
  );
  expect(systems.querySelector('extension')?.textContent).toBe('.ewgame');
  expect(systems.querySelectorAll('command')).toHaveLength(1);
  expect(systems.querySelector('command')?.textContent).toBe(catalog.command);
  expect(catalog.command).toBe(
    `${root}/helper --session '${root}' --game %ROM%`,
  );
  expect(catalog.command.match(/%[^%]+%/g)).toEqual(['%ROM%']);
  names.forEach((name) => expect(catalog.command).not.toContain(name));
  expect(catalog.command).not.toContain('/Users/private');
  const gamelist = parseXML(await fs.readFile(catalog.gamelistPath, 'utf8'));
  expect(gamelist.querySelectorAll('name')).toHaveLength(2);
  expect(
    Array.from(gamelist.querySelectorAll('name'), (n) => n.textContent),
  ).toEqual(names);
  expect(
    Array.from(gamelist.querySelectorAll('path'), (p) => p.textContent),
  ).toEqual([`./${first}.ewgame`, `./${second}.ewgame`]);
  expect(gamelist.querySelector('command')).toBeNull();
  const rules = parseXML(await fs.readFile(catalog.findRulesPath, 'utf8'));
  expect(rules.documentElement.tagName).toBe('ruleList');
  expect(rules.querySelector('emulator')).toBeNull();
  expect(await fs.readdir(catalog.romDirectory)).toEqual([
    `${first}.ewgame`,
    `${second}.ewgame`,
  ]);
  const markerStats = await Promise.all(
    Object.values(catalog.markers).map((marker) => fs.lstat(marker)),
  );
  markerStats.forEach((stat) => {
    expect(stat.isFile()).toBe(true);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.size).toBe(0);
    expect(stat.nlink).toBe(1);
    // eslint-disable-next-line no-bitwise -- Assert the actual POSIX permission bits.
    expect(stat.mode & 0o777).toBe(0o600);
  });
  expect(Object.isFrozen(catalog.markers)).toBe(true);
});

test('discards XML-invalid codepoints without injecting metadata nodes', async () => {
  const name =
    'safe\u0000\u0001\u000b\ud800\ufffe\uffff</name><command>&evil;🎮';
  const catalog = await createCatalog(root, [
    { id: first, name },
    { id: second, name: '\u0000\udfff' },
  ]);
  const gamelist = parseXML(await fs.readFile(catalog.gamelistPath, 'utf8'));
  expect(gamelist.querySelectorAll('command')).toHaveLength(0);
  expect(
    Array.from(gamelist.querySelectorAll('name'), (n) => n.textContent),
  ).toEqual(['safe</name><command>&evil;🎮', second]);
});

test.each([
  '../escape',
  `${first}.dol`,
  'A'.repeat(32),
  'a'.repeat(31),
  'a'.repeat(33),
  '`touch escaped`',
  `${'a'.repeat(31)}|`,
  `${first}\n`,
  `${first}\u0000`,
])('rejects tampered ID %j before filesystem mutations', async (id) => {
  await expect(createCatalog(root, [{ id, name: 'title' }])).rejects.toThrow(
    'opaque',
  );
  expect(await fs.readdir(root)).toEqual(['helper']);
});

test('rejects duplicate IDs and source-path fields rather than embedding them', async () => {
  await expect(
    createCatalog(root, [
      { id: first, name: 'one' },
      { id: first, name: 'two' },
    ]),
  ).rejects.toThrow('unique');
  await expect(
    createCatalog(root, [
      {
        id: first,
        name: 'title',
        sourcePath: '/outside/game.dol',
      } as CatalogEntry,
    ]),
  ).rejects.toThrow('opaque');
  expect(await fs.readdir(root)).toEqual(['helper']);
});

test('snapshots caller input before asynchronous filesystem inspection', async () => {
  const entries = [{ id: first, name: 'original title' }];
  const pending = createCatalog(root, entries);
  entries[0].id = '../escape';
  entries[0].name = 'replacement';
  const catalog = await pending;
  expect(Object.keys(catalog.markers)).toEqual([first]);
  const gamelist = parseXML(await fs.readFile(catalog.gamelistPath, 'utf8'));
  expect(gamelist.querySelector('name')?.textContent).toBe('original title');
});

test('bounds entry count, individual names and total display metadata', async () => {
  await expect(
    createCatalog(
      root,
      Array.from({ length: 10001 }, () => ({ id: first, name: 'a' })),
    ),
  ).rejects.toThrow('count');
  await expect(
    createCatalog(root, [{ id: first, name: 'a'.repeat(1025) }]),
  ).rejects.toThrow('name');
  await expect(
    createCatalog(
      root,
      Array.from({ length: 4097 }, (_, index) => ({
        id: index.toString(16).padStart(32, '0'),
        name: 'a'.repeat(1024),
      })),
    ),
  ).rejects.toThrow('metadata');
  expect(await fs.readdir(root)).toEqual(['helper']);
});

test.each([
  ' space',
  '`shell`',
  '|pipe',
  '%ROM%',
  "'quote",
  '\n',
  '日本語',
  '/..',
  '//child',
])('rejects unsafe or noncanonical root suffix %j', async (suffix) => {
  await expect(createCatalog(`${root}${suffix}`, [])).rejects.toThrow('ASCII');
  expect(await fs.readdir(root)).toEqual(['helper']);
});

test.each([0o755, 0o750, 0o770, 0o1700])(
  'rejects root mode %s',
  async (mode) => {
    await fs.chmod(root, mode);
    await expect(createCatalog(root, [])).rejects.toThrow('private');
    expect(await fs.readdir(root)).toEqual(['helper']);
  },
);

test('rejects a root owned by another UID', async () => {
  const actual = await fs.lstat(root);
  // Changing real ownership requires root privileges; substitute only OS metadata.
  const unowned = Object.assign(Object.create(actual), { uid: actual.uid + 1 });
  jest.spyOn(fs, 'lstat').mockResolvedValueOnce(unowned);
  await expect(createCatalog(root, [])).rejects.toThrow('owned');
  expect(await fs.readdir(root)).toEqual(['helper']);
});

test('refuses root and ancestor symlinks', async () => {
  const child = path.join(root, 'child');
  const alias = path.join(root, 'alias');
  await fs.mkdir(child, { mode: 0o700 });
  await fs.writeFile(path.join(child, 'helper'), 'placeholder', {
    mode: 0o700,
  });
  await fs.symlink(child, alias);
  await expect(createCatalog(alias, [])).rejects.toThrow('canonical');
  await fs.mkdir(path.join(child, 'session'), { mode: 0o700 });
  await fs.writeFile(path.join(child, 'session/helper'), 'placeholder', {
    mode: 0o700,
  });
  await expect(createCatalog(path.join(alias, 'session'), [])).rejects.toThrow(
    'canonical',
  );
  await expect(
    fs.lstat(path.join(child, 'session/home')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
});

test.each(['home', 'roms'])(
  'refuses a preexisting %s symlink without writing to its target',
  async (name) => {
    const target = path.join(root, 'untouched');
    await fs.mkdir(target, { mode: 0o700 });
    await fs.writeFile(path.join(target, 'sentinel'), 'keep');
    await fs.symlink(target, path.join(root, name));
    await expect(
      createCatalog(root, [{ id: first, name: 'title' }]),
    ).rejects.toThrow('preserved');
    expect(await fs.readdir(target)).toEqual(['sentinel']);
    expect(await fs.readFile(path.join(target, 'sentinel'), 'utf8')).toBe(
      'keep',
    );
    expect(await fs.lstat(path.join(root, name))).toEqual(
      expect.objectContaining({ size: target.length }),
    );
  },
);

test('refuses a directory changed to a symlink during construction', async () => {
  const target = path.join(root, 'untouched');
  await fs.mkdir(target, { mode: 0o700 });
  const mkdir = fs.mkdir.bind(fs);
  jest.spyOn(fs, 'mkdir').mockImplementation(async (directory, options) => {
    const result = await mkdir(directory, options);
    if (String(directory).endsWith('/custom_systems')) {
      await fs.rmdir(directory);
      await fs.symlink(target, directory);
    }
    return result;
  });
  await expect(createCatalog(root, [])).rejects.toThrow('boundary');
  expect(await fs.readdir(target)).toEqual([]);
});

test.each([0o600, 0o722])(
  'refuses unsupported helper mode %s',
  async (mode) => {
    await fs.chmod(path.join(root, 'helper'), mode);
    await expect(createCatalog(root, [])).rejects.toThrow('executable');
  },
);

test('rejects special privilege bits advertised by helper metadata', async () => {
  const rootStat = await fs.lstat(root);
  const helperStat = await fs.lstat(path.join(root, 'helper'));
  // macOS clears setuid on this temporary file; exercise the OS metadata check.
  const privileged = Object.assign(Object.create(helperStat), {
    mode: helperStat.mode + 0o4000,
  });
  jest
    .spyOn(fs, 'lstat')
    .mockResolvedValueOnce(rootStat)
    .mockResolvedValueOnce(privileged);
  await expect(createCatalog(root, [])).rejects.toThrow('executable');
  expect(await fs.readdir(root)).toEqual(['helper']);
});

test('refuses missing, symlinked, directory and hard-linked helpers', async () => {
  const helper = path.join(root, 'helper');
  await fs.unlink(helper);
  await expect(createCatalog(root, [])).rejects.toMatchObject({
    code: 'ENOENT',
  });
  const other = path.join(root, 'other-helper');
  await fs.writeFile(other, 'placeholder', { mode: 0o700 });
  await fs.symlink(other, helper);
  await expect(createCatalog(root, [])).rejects.toThrow('executable');
  await fs.unlink(helper);
  await fs.mkdir(helper, { mode: 0o700 });
  await expect(createCatalog(root, [])).rejects.toThrow('executable');
  await fs.rmdir(helper);
  await fs.link(other, helper);
  await expect(createCatalog(root, [])).rejects.toThrow('executable');
  expect(await fs.readdir(root)).toEqual(['helper', 'other-helper']);
});

test('refuses an existing profile or a second catalog without overwriting', async () => {
  const catalog = await createCatalog(root, [
    { id: first, name: 'keep title' },
  ]);
  const before = await fs.readFile(catalog.gamelistPath);
  const helper = await fs.readFile(catalog.helperPath);
  await expect(
    createCatalog(root, [{ id: second, name: 'replacement' }]),
  ).rejects.toThrow('preserved');
  expect(await fs.readFile(catalog.gamelistPath)).toEqual(before);
  expect(await fs.readFile(catalog.helperPath)).toEqual(helper);
  expect(await fs.readdir(catalog.romDirectory)).toEqual([`${first}.ewgame`]);
});

describe('multi-system catalog', () => {
  const psp = 'c'.repeat(32);

  it('writes one ES-DE system, marker folder and gamelist per system', async () => {
    const catalog = await createSystemsCatalog(root, [
      {
        id: 'gc',
        fullname: 'Nintendo GameCube',
        label: 'Dolphin',
        entries: [{ id: first, name: 'Cube' }],
      },
      {
        id: 'psp',
        fullname: 'Sony PlayStation Portable',
        label: 'PPSSPP',
        entries: [{ id: psp, name: 'Pocket & <Go>' }],
      },
    ]);
    const systems = parseXML(
      await fs.readFile(catalog.systemsPath, 'utf8'),
      true,
    );
    expect(
      Array.from(systems.querySelectorAll('system > name')).map(
        (node) => node.textContent,
      ),
    ).toEqual(['gc', 'psp']);
    expect(
      systems.querySelector('system:nth-of-type(2) > fullname')?.textContent,
    ).toBe('Sony PlayStation Portable');
    // Both systems use the same fixed helper command; no filename ever appears in it.
    expect(
      new Set(
        Array.from(systems.querySelectorAll('command')).map(
          (node) => node.textContent,
        ),
      ).size,
    ).toBe(1);
    expect(catalog.systems.psp.markers[psp]).toBe(
      path.join(root, 'roms', 'psp', `${psp}.ewgame`),
    );
    expect(
      await fs.readFile(catalog.systems.psp.gamelistPath, 'utf8'),
    ).toContain('<name>Pocket &amp; &lt;Go&gt;</name>');
    expect(catalog.markers).toEqual({
      [first]: path.join(root, 'roms', 'gc', `${first}.ewgame`),
    });
  });

  it('rejects an opaque id reused across systems', async () => {
    await expect(
      createSystemsCatalog(root, [
        {
          id: 'gc',
          fullname: 'GC',
          label: 'Dolphin',
          entries: [{ id: first, name: 'a' }],
        },
        {
          id: 'psp',
          fullname: 'PSP',
          label: 'PPSSPP',
          entries: [{ id: first, name: 'b' }],
        },
      ]),
    ).rejects.toThrow('unique');
    await expect(fs.lstat(path.join(root, 'roms'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each(['../gc', 'GC', 'gc</name><x>', '', 'a'.repeat(17)])(
    'rejects system id %p before writing anything',
    async (id) => {
      await expect(
        createSystemsCatalog(root, [
          { id, fullname: 'x', label: 'x', entries: [] },
        ]),
      ).rejects.toThrow('valid systems');
      await expect(fs.lstat(path.join(root, 'home'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it('rejects duplicate systems', async () => {
    await expect(
      createSystemsCatalog(root, [
        { id: 'gc', fullname: 'a', label: 'a', entries: [] },
        { id: 'gc', fullname: 'b', label: 'b', entries: [] },
      ]),
    ).rejects.toThrow('valid systems');
  });
});
