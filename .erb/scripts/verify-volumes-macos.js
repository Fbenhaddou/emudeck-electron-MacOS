// Real external-drive evidence for library identity, with throwaway disk
// images only: never touches an existing drive. Creates exFAT and APFS images
// in a fresh temporary folder, mounts them without showing them in Finder
// (-nobrowse), and checks with the real `diskutil` probe that:
//  - a library re-plugged under another name ("<name> 1") is found again;
//  - a different drive with the same name and folder is never accepted;
//  - an unplugged drive reads as unavailable and keeps its saved location;
//  - a renamed APFS volume is found again.
// Every image is detached and the temporary folder removed at the end.
const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const repository = path.resolve(__dirname, '../..');
require('ts-node').register({
  project: path.join(repository, 'tsconfig.macos.json'),
  transpileOnly: true,
  compilerOptions: { module: 'CommonJS', moduleResolution: 'Node' },
});
const { readLibrary, selectLibrary } = require('../../src/main/macos/library.ts');
const { takeSnapshot, restoreSnapshot, listSnapshots } = require('../../src/main/macos/snapshots.ts');
const { checkLibrary, moveToSystem } = require('../../src/main/macos/library-health.ts');
const { dolphin } = require('../../src/main/components/dolphin/index.ts');
const { ppsspp } = require('../../src/main/components/ppsspp/index.ts');

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 60000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${command} ${args[0]}: ${stderr || error.message}`));
      else resolve(stdout);
    });
  });
}

async function attach(image) {
  const out = await run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-plist', image]);
  const points = [...out.matchAll(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/g)];
  assert.ok(points.length, 'image mounted');
  return points[points.length - 1][1];
}

async function main() {
  // Optional --parent <dir>: where the fresh work folder is created (default: the system temporary folder).
  const flag = process.argv.indexOf('--parent');
  const parent = flag > 0 ? path.resolve(process.argv[flag + 1]) : os.tmpdir();
  const work = await fs.realpath(await fs.mkdtemp(path.join(parent, 'ew-volumes-')));
  const mounted = new Set();
  const report = [];
  const step = (name, ok) => {
    report.push({ step: name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
    assert.ok(ok, name);
  };
  const mount = async (image) => {
    const point = await attach(image);
    mounted.add(point);
    return point;
  };
  const detach = async (point) => {
    await run('/usr/bin/hdiutil', ['detach', '-quiet', point]);
    mounted.delete(point);
  };
  try {
    for (const filesystem of ['ExFAT', 'APFS']) {
      const name = `EWVerify${filesystem}`; // Volume name for created images.
      const library = path.join(work, `${filesystem}.dmg`);
      const other = path.join(work, `${filesystem}-other.dmg`);
      // --images <dir>: copies of prepared images (<FS>.dmg, <FS>-other.dmg
      // with the same volume name); the originals are never attached.
      const imagesFlag = process.argv.indexOf('--images');
      if (imagesFlag > 0) {
        const source = path.resolve(process.argv[imagesFlag + 1]);
        await fs.copyFile(path.join(source, `${filesystem}.dmg`), library);
        await fs
          .copyFile(path.join(source, `${filesystem}-other.dmg`), other)
          .catch(() => undefined);
      } else
        for (const image of [library, other])
          await run('/usr/bin/hdiutil', ['create', '-size', '40m', '-fs', filesystem, '-volname', name, '-ov', image]);
      const hasImpostor = await fs.lstat(other).then(() => true, () => false);
      const statePath = path.join(work, `${filesystem}-state`, 'library.json');

      let point = await mount(library);
      await fs.mkdir(path.join(point, 'Game Library', 'roms', 'gc'), { recursive: true });
      await fs.writeFile(path.join(point, 'Game Library', 'roms', 'gc', 'marker.txt'), 'mine');
      await selectLibrary(statePath, path.join(point, 'Game Library'));
      const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
      step(`${filesystem}: recorded by volume UUID`, /^[0-9A-F-]{36}$/.test(state.volume?.uuid || ''));

      await detach(point);
      const unplugged = await readLibrary(statePath);
      step(`${filesystem}: unplugged reads unavailable, location kept`, !unplugged.available && unplugged.path === state.path);

      // Another drive with the same name and folder takes the mount point first.
      let impostor = null;
      if (hasImpostor) {
        impostor = await mount(other);
        const uuid = (await run('/usr/sbin/diskutil', ['info', '-plist', impostor])).match(/<key>VolumeUUID<\/key>\s*<string>([^<]+)</)?.[1];
        if (uuid && uuid.toUpperCase() !== state.volume.uuid) {
          await fs.mkdir(path.join(impostor, 'Game Library'), { recursive: true });
          step(`${filesystem}: impostor took the original path`, impostor === point);
          const refused = await readLibrary(statePath);
          step(`${filesystem}: a different drive at the same path is refused`, !refused.available);
        } else {
          console.log(`SKIP ${filesystem}: the second image shares the volume UUID (a copy), so it is not an impostor`);
          await detach(impostor);
          impostor = null;
        }
      }

      point = await mount(library);
      if (impostor)
        step(`${filesystem}: re-plugged under another name (${path.basename(point)})`, point !== impostor);
      const found = await readLibrary(statePath);
      step(
        `${filesystem}: the same drive is found again`,
        found.available && found.path === path.join(point, 'Game Library'),
      );
      const marker = await fs.readFile(path.join(found.path, 'roms', 'gc', 'marker.txt'), 'utf8');
      step(`${filesystem}: it is really the library`, marker === 'mine');

      if (impostor) await detach(impostor);

      // Saves and library tools on this file system (exFAT: no clones, no hard
      // links, synthetic inodes). Synthetic bytes only.
      const lib = found.path;
      const gc = path.join(lib, 'emulators', 'dolphin', 'User', 'GC');
      const statesDir = path.join(lib, 'emulators', 'dolphin', 'User', 'StateSaves');
      await fs.mkdir(path.join(gc, 'USA'), { recursive: true });
      await fs.mkdir(statesDir, { recursive: true });
      await fs.writeFile(path.join(gc, 'MemoryCardA.USA.raw'), 'chapter 3');
      await fs.writeFile(path.join(gc, 'USA', 'IPL.bin'), 'ipl');
      const source = {
        emulator: 'dolphin',
        folders: { saves: gc, states: statesDir },
        exclude: ['saves/USA/IPL.bin'],
      };
      const snapshot = await takeSnapshot(lib, source, 'manual');
      step(`${filesystem}: save snapshot taken (copy, no clone needed)`, snapshot?.files === 1);
      await fs.writeFile(path.join(gc, 'MemoryCardA.USA.raw'), 'corrupted');
      const { before } = await restoreSnapshot(lib, source, snapshot.id);
      step(
        `${filesystem}: restore is byte-identical and keeps the replaced save`,
        (await fs.readFile(path.join(gc, 'MemoryCardA.USA.raw'), 'utf8')) === 'chapter 3' &&
          before?.files === 1 &&
          (await fs.readFile(path.join(gc, 'USA', 'IPL.bin'), 'utf8')) === 'ipl',
      );
      step(`${filesystem}: both backups listed`, (await listSnapshots(lib, 'dolphin')).length === 2);
      await fs.writeFile(path.join(lib, 'roms', 'gc', 'Pocket.cso'), 'psp');
      await fs.mkdir(path.join(lib, 'roms', 'psp'), { recursive: true });
      await fs.writeFile(path.join(lib, 'roms', 'psp', 'Pocket.cso'), 'already here');
      const health = await checkLibrary(lib, [dolphin, ppsspp]);
      step(`${filesystem}: library check finds the misplaced game`, health.issues.some((issue) => issue.kind === 'wrong-system'));
      await fs.rm(path.join(lib, 'roms', 'psp', 'Pocket.cso'));
      await fs.writeFile(path.join(lib, 'roms', 'psp', 'Other.cso'), 'other');
      const moved = await moveToSystem(lib, 'roms/gc/Pocket.cso', ppsspp).then(
        () => true,
        (error) => error.message,
      );
      step(`${filesystem}: misplaced game moved (${moved === true ? 'ok' : moved})`, moved === true);
      await fs.writeFile(path.join(lib, 'roms', 'gc', 'Other.cso'), 'misplaced copy');
      const refusedMove = await moveToSystem(lib, 'roms/gc/Other.cso', ppsspp).then(() => false, () => true);
      step(
        `${filesystem}: a move never overwrites`,
        refusedMove && (await fs.readFile(path.join(lib, 'roms', 'psp', 'Other.cso'), 'utf8')) === 'other',
      );

      if (filesystem === 'APFS') {
        await run('/usr/sbin/diskutil', ['rename', point, 'EWRenamedLibrary']);
        mounted.delete(point);
        const renamed = '/Volumes/EWRenamedLibrary';
        mounted.add(renamed);
        const afterRename = await readLibrary(statePath);
        step('APFS: a renamed volume is found again', afterRename.available && afterRename.path === path.join(renamed, 'Game Library'));
        point = renamed;
      }
      await detach(point);
    }
  } finally {
    for (const point of mounted) await run('/usr/bin/hdiutil', ['detach', '-force', '-quiet', point]).catch(() => undefined);
    await fs.rm(work, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ passed: report.length, report }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
