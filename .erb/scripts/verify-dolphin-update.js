/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax, no-bitwise */
// Developer test: three real official installs in a newly owned private runtime.
// No emulator execution, existing runtime, user library or reset is permitted.
const assert = require('assert/strict');
const fs = require('fs/promises');
const { constants, createReadStream } = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { execFile } = require('child_process');

const repository = path.resolve(__dirname, '../..');
require('ts-node').register({
  project: path.join(repository, 'tsconfig.macos.json'),
  transpileOnly: true,
  compilerOptions: { module: 'CommonJS', moduleResolution: 'Node' },
});
const {
  ComponentManager,
} = require('../../src/main/macos/component-manager.ts');
const {
  selectLibrary,
  readLibrary,
} = require('../../src/main/macos/library.ts');
const libraryOperations = require('../../src/main/macos/dolphin-library.ts');
const { dolphin } = require('../../src/main/components/dolphin/index.ts');
const {
  downloadArtifact,
} = require('../../src/main/components/dolphin/download.ts');
const {
  installDolphin,
  verifyBundle,
  runProcess,
} = require('../../src/main/components/dolphin/install.ts');

const releases = Object.freeze({
  old: Object.freeze({
    version: '2606a',
    revision: 'c77bbaa0f372c3f72281602a8b087206706542cb',
    artifactURL:
      'https://dl.dolphin-emu.org/releases/2606a/dolphin-2606a-universal.dmg',
  }),
  next: Object.freeze({
    version: '2609',
    revision: 'f84df02055ab9610feec48e65648cac5a3c098fa',
    artifactURL:
      'https://dl.dolphin-emu.org/releases/2609/dolphin-2609-universal.dmg',
  }),
});
const commandAllowlist = new Set([
  '/usr/bin/plutil',
  '/usr/bin/sw_vers',
  '/usr/bin/lipo',
  '/usr/bin/codesign',
  '/usr/sbin/spctl',
  '/usr/bin/hdiutil',
  '/usr/bin/ditto',
]);
const scope = 'real official Dolphin update and synthetic byte preservation';
const deadline = Date.now() + 30 * 60 * 1000;
let runtime;
let runtimeIdentity;
let installation;
let evidence;
let evidenceHandle;
let selected = releases.old;
let phase = 'initialization';
let injectFailure = false;
let tamperedBundle;
let tamperCount = 0;
let spawnAttempts = 0;
let downloadCount = 0;
let signatureFailureObserved = false;
let signatureFailureEvidence;
let tamperedResource;
const downloads = [];
const commands = [];
const stages = [];
const checks = [];

function budget(minimum = 0) {
  assert.ok(Date.now() + minimum < deadline, 'Developer test deadline reached');
}

async function assertRuntime() {
  const stat = await fs.lstat(runtime);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  assert.equal(await fs.realpath(runtime), runtime);
  assert.equal(stat.uid, process.getuid());
  assert.equal(stat.mode & 0o777, 0o700);
  assert.equal(stat.dev, runtimeIdentity.dev);
  assert.equal(stat.ino, runtimeIdentity.ino);
}

async function fingerprint(file) {
  const before = await fs.lstat(file);
  assert.ok(before.isFile() && !before.isSymbolicLink());
  assert.ok(before.size <= 512 * 1024 * 1024);
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file, {
    flags: constants.O_RDONLY | constants.O_NOFOLLOW,
  })) {
    bytes += chunk.length;
    assert.ok(bytes <= before.size);
    hash.update(chunk);
  }
  const after = await fs.lstat(file);
  assert.equal(after.dev, before.dev);
  assert.equal(after.ino, before.ino);
  assert.equal(after.size, before.size);
  assert.equal(bytes, before.size);
  return { bytes, sha256: hash.digest('hex') };
}

async function inventory(root, allowLinks = false) {
  await assertRuntime();
  assert.ok(root.startsWith(`${runtime}/`));
  assert.equal(await fs.realpath(root), root);
  const result = [];
  const pending = [''];
  let totalBytes = 0;
  while (pending.length) {
    budget();
    const relative = pending.pop();
    const directory = path.join(root, relative);
    const names = (await fs.readdir(directory)).sort();
    for (const name of names) {
      assert.ok(result.length < 10000, 'Inventory entry limit exceeded');
      const entry = path.join(relative, name);
      const file = path.join(root, entry);
      const stat = await fs.lstat(file);
      const base = { path: entry, mode: stat.mode & 0o777 };
      if (stat.isDirectory()) {
        assert.equal(await fs.realpath(file), file);
        result.push({ ...base, kind: 'directory' });
        pending.push(entry);
      } else if (stat.isSymbolicLink()) {
        assert.ok(allowLinks, 'Synthetic library must contain no symlinks');
        const target = await fs.readlink(file);
        assert.ok(target.length <= 4096);
        result.push({ ...base, kind: 'symlink', target });
      } else {
        assert.ok(stat.isFile(), 'Unsupported inventory entry');
        totalBytes += stat.size;
        assert.ok(totalBytes <= 2 * 1024 ** 3, 'Inventory byte limit exceeded');
        result.push({ ...base, kind: 'file', ...(await fingerprint(file)) });
      }
    }
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

function inventoryFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function writeEvidence(change = {}) {
  await assertRuntime();
  const stat = await fs.lstat(evidence);
  const opened = await evidenceHandle.stat();
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
  assert.equal(stat.dev, opened.dev);
  assert.equal(stat.ino, opened.ino);
  assert.equal(stat.mode & 0o777, 0o600);
  const output = `${JSON.stringify(
    {
      schema: 1,
      scope,
      ready: false,
      phase,
      updatedAt: new Date().toISOString(),
      releases,
      checks,
      downloads,
      commands,
      failureInjection: {
        tamperCount,
        signatureFailureObserved,
        diagnostic: signatureFailureEvidence,
        tamperedResource,
        relativeResource: 'Contents/Resources/qt.conf',
        policy: 'only the newly owned 2609 staging copy is modified',
      },
      spawnAttempts,
      unverified: [
        'emulator execution and rendering',
        'gameplay-created memory-card saves',
        'cross-version save or savestate compatibility',
        'physical controller',
        'Mac reboot',
        'product rollback or repair',
      ],
      ...change,
    },
    null,
    2,
  )}\n`;
  assert.ok(Buffer.byteLength(output) <= 256 * 1024);
  await evidenceHandle.truncate(0);
  const bytes = Buffer.from(output);
  let offset = 0;
  while (offset < bytes.length) {
    const written = await evidenceHandle.write(
      bytes,
      offset,
      bytes.length - offset,
      offset,
    );
    assert.ok(written.bytesWritten > 0, 'Evidence write made no progress');
    offset += written.bytesWritten;
  }
  await evidenceHandle.sync();
}

async function mark(name, details = {}) {
  checks.push({ name, ...details });
  assert.ok(checks.length <= 32);
  console.log(`PASS: ${name}`);
  await writeEvidence();
}

async function corruptOwnedCopy(source, destination) {
  await assertRuntime();
  const stage = path.dirname(destination);
  assert.equal(path.dirname(stage), installation);
  assert.match(path.basename(stage), /^\.dolphin-stage-[A-Za-z0-9]{6}$/);
  assert.equal(source, path.join(stage, 'mount', 'Dolphin.app'));
  assert.equal(destination, path.join(stage, 'Dolphin.app'));
  const stat = await fs.lstat(stage);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  assert.equal(stat.uid, process.getuid());
  assert.equal(stat.mode & 0o777, 0o700);
  assert.equal(await fs.realpath(stage), stage);
  const marker = path.join(stage, '.dolphin-install.json');
  const markerStat = await fs.lstat(marker);
  assert.ok(markerStat.isFile() && !markerStat.isSymbolicLink());
  assert.ok(markerStat.size <= 16384);
  const journal = JSON.parse(await fs.readFile(marker, 'utf8'));
  assert.equal(journal.format, 'emulation-workspace-dolphin-install');
  assert.equal(journal.schemaVersion, 1);
  assert.equal(journal.stagingDirectory, path.basename(stage));
  assert.deepEqual(journal.release, releases.next);
  assert.equal(await fs.realpath(destination), destination);
  const resource = path.join(destination, 'Contents/Resources/qt.conf');
  const sourceResource = path.join(source, 'Contents/Resources/qt.conf');
  const sourceBefore = await fingerprint(sourceResource);
  assert.equal(sourceBefore.bytes, 0);
  const before = await fs.lstat(resource);
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1);
  assert.equal(before.uid, process.getuid());
  assert.equal(before.size, 0);
  assert.equal(await fs.realpath(resource), resource);
  const handle = await fs.open(
    resource,
    constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW,
  );
  try {
    const opened = await handle.stat();
    assert.equal(opened.dev, before.dev);
    assert.equal(opened.ino, before.ino);
    await handle.writeFile('Developer-only staged signature failure.\n');
    await handle.sync();
  } finally {
    await handle.close();
  }
  assert.deepEqual(await fingerprint(sourceResource), sourceBefore);
  tamperedResource = await fingerprint(resource);
  assert.equal(
    tamperedResource.bytes,
    Buffer.byteLength('Developer-only staged signature failure.\n'),
  );
  tamperedBundle = destination;
  tamperCount += 1;
  assert.equal(tamperCount, 1);
  console.log('Injected a seal failure in the owned 2609 staging copy.');
}

async function runner(executable, args, input) {
  assert.ok(commandAllowlist.has(executable), 'Unexpected native command');
  await assertRuntime();
  const cleanup =
    (executable === '/usr/bin/hdiutil' &&
      ['info', 'detach'].includes(args[0])) ||
    (executable === '/usr/bin/plutil' && input !== undefined);
  // Cleanup may finish after the experiment deadline; never interrupt detach.
  if (!cleanup) budget();
  assert.ok(commands.length < 192, 'Native command count limit exceeded');
  const entry = {
    phase,
    executable: path.basename(executable),
    action: args[0],
    success: false,
  };
  commands.push(entry);
  if (executable === '/usr/bin/hdiutil' && args[0] === 'detach') {
    await assert.rejects(
      fs.lstat(path.join(installation, selected.version, 'receipt.json')),
      { code: 'ENOENT' },
      'The new receipt must remain unpublished before detachment',
    );
    entry.receiptAbsentBeforeDetach = true;
  }
  let output;
  try {
    output = await runProcess(executable, args, input);
    entry.success = true;
  } catch (error) {
    if (
      injectFailure &&
      tamperedBundle &&
      executable === '/usr/bin/codesign' &&
      args.join('\0') ===
        ['--verify', '--deep', '--strict', tamperedBundle].join('\0')
    ) {
      signatureFailureObserved = true;
      signatureFailureEvidence = await new Promise((resolve) => {
        execFile(
          '/usr/bin/codesign',
          ['--verify', '--deep', '--strict', '--verbose=4', tamperedBundle],
          { timeout: 120000, maxBuffer: 65536, shell: false },
          (failure, stdout, stderr) => {
            resolve({
              code: failure?.code || 0,
              killed: Boolean(failure?.killed),
              signal: failure?.signal || null,
              diagnostic: `${stdout}${stderr}`.slice(-8192),
            });
          },
        );
      });
      // codesign may report only its resource-seal summary. Its exact owned
      // bundle, actual failed exit and our sole modified resource are recorded.
      assert.equal(typeof signatureFailureEvidence.code, 'number');
      assert.notEqual(signatureFailureEvidence.code, 0);
      assert.equal(signatureFailureEvidence.killed, false);
      assert.equal(signatureFailureEvidence.signal, null);
    }
    throw error;
  }
  if (executable === '/usr/bin/ditto' && injectFailure)
    await corruptOwnedCopy(args[0], args[1]);
  return output;
}

async function downloader(release, destination) {
  budget(600000);
  await assertRuntime();
  assert.deepEqual(release, selected);
  downloadCount += 1;
  assert.ok(downloadCount <= 3, 'Only three official downloads are permitted');
  console.log(`Downloading official Dolphin ${release.version} (${phase}).`);
  const audit = await downloadArtifact(release, destination);
  downloads.push({ phase, ...release, ...audit });
  return audit;
}

async function noOwnedMounts() {
  const plist = await runner('/usr/bin/hdiutil', ['info', '-plist']);
  const data = JSON.parse(
    await runner(
      '/usr/bin/plutil',
      ['-convert', 'json', '-o', '-', '-'],
      plist,
    ),
  );
  assert.ok(Array.isArray(data.images) && data.images.length <= 512);
  for (const image of data.images) {
    assert.equal(typeof image['image-path'], 'string');
    assert.ok(Array.isArray(image['system-entities']));
    assert.ok(image['system-entities'].length <= 128);
    assert.ok(!image['image-path'].startsWith(`${runtime}/`));
    for (const entity of image['system-entities']) {
      const mount = entity['mount-point'];
      if (mount !== undefined) {
        assert.equal(typeof mount, 'string');
        assert.ok(!mount.startsWith(`${runtime}/`));
      }
    }
  }
  assert.deepEqual(
    (await fs.readdir(installation)).sort(),
    stages.slice().sort(),
  );
}

async function signatureDescription(bundle) {
  budget();
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/codesign',
      ['--display', '--verbose=4', bundle],
      { timeout: 120000, maxBuffer: 65536, shell: false },
      (error, stdout, stderr) => {
        if (error) reject(new Error('Cannot inspect the actual Developer ID'));
        else resolve(`${stdout}${stderr}`);
      },
    );
  });
}

async function inspect(release) {
  const directory = path.join(installation, release.version);
  const bundle = path.join(directory, 'Dolphin.app');
  assert.equal(await fs.realpath(bundle), bundle);
  await verifyBundle(bundle, runner, release);
  const receipt = JSON.parse(
    await fs.readFile(path.join(directory, 'receipt.json'), 'utf8'),
  );
  assert.deepEqual(
    {
      version: receipt.version,
      revision: receipt.revision,
      artifactURL: receipt.artifactURL,
    },
    release,
  );
  assert.equal(receipt.bundlePath, bundle);
  assert.equal(receipt.verification, 'codesign-and-gatekeeper');
  assert.ok(
    downloads.some(
      (entry) =>
        entry.sha256 === receipt.sha256 &&
        entry.bytes === receipt.bytes &&
        entry.version === release.version,
    ),
  );
  const info = JSON.parse(
    await runner('/usr/bin/plutil', [
      '-convert',
      'json',
      '-o',
      '-',
      path.join(bundle, 'Contents/Info.plist'),
    ]),
  );
  const architectures = (
    await runner('/usr/bin/lipo', [
      '-archs',
      path.join(bundle, 'Contents/MacOS/Dolphin'),
    ])
  )
    .trim()
    .split(/\s+/);
  assert.ok(architectures.includes('arm64'));
  const signature = await signatureDescription(bundle);
  const team = /^TeamIdentifier=(.*)$/m.exec(signature)?.[1];
  const authorities = [...signature.matchAll(/^Authority=(.*)$/gm)].map(
    (match) => match[1],
  );
  assert.equal(team, '97835T4369');
  assert.ok(
    authorities.some((authority) =>
      authority.startsWith('Developer ID Application:'),
    ),
  );
  return {
    ...release,
    bytes: receipt.bytes,
    sha256: receipt.sha256,
    bundleIdentifier: info.CFBundleIdentifier,
    executable: info.CFBundleExecutable,
    minimumOS: info.LSMinimumSystemVersion,
    architectures,
    team,
    authorities,
    verification: receipt.verification,
  };
}

async function run() {
  assert.equal(process.platform, 'darwin', 'Native macOS required');
  assert.equal(process.arch, 'arm64', 'Native Apple Silicon Node required');
  assert.equal(
    process.argv.length,
    2,
    'This test takes no runtime or library arguments',
  );
  runtime = await fs.realpath(
    await fs.mkdtemp('/private/tmp/emulation-dolphin-update-'),
  );
  runtimeIdentity = await fs.lstat(runtime);
  await assertRuntime();
  evidence = path.join(runtime, 'update-report.json');
  evidenceHandle = await fs.open(evidence, 'wx', 0o600);
  try {
    await writeEvidence();
    console.log(`New private update runtime: ${runtime}`);
    installation = path.join(runtime, 'components/dolphin');
    await fs.mkdir(installation, { recursive: true, mode: 0o700 });
    const library = path.join(runtime, 'ألعاب GameCube Library');
    const state = path.join(runtime, 'state/library.json');
    await fs.mkdir(library, { mode: 0o700 });
    await selectLibrary(state, library);
    await libraryOperations.prepareDolphinLibrary(library);
    const directories = dolphin.paths(library);
    await fs.appendFile(
      path.join(directories.configuration, 'Dolphin.ini'),
      '[Interface]\nConfirmStop = True\nThemeName = Synthetic preservation fixture\n',
    );
    const rom = Buffer.alloc(260);
    rom.writeUInt32BE(256, 0);
    rom.writeUInt32BE(0x80003100, 0x48);
    rom.writeUInt32BE(4, 0x90);
    rom.writeUInt32BE(0x80003100, 0xe0);
    rom.writeUInt32BE(0x48000000, 256);
    for (const [file, bytes] of [
      [
        path.join(directories.configuration, 'unknown-settings.ini'),
        '[Synthetic]\nPreserve = True\n',
      ],
      [path.join(directories.configuration, 'empty-settings.ini'), ''],
      [path.join(directories.roms, 'authored-never-executed.dol'), rom],
      [
        path.join(directories.saves, 'synthetic-card-sentinel.bin'),
        Buffer.from('Synthetic GC bytes; never a game-created save.\0'),
      ],
      [
        path.join(directories.states, 'synthetic-state-sentinel.bin'),
        Buffer.from(
          'Synthetic state bytes; never an emulator-created state.\0',
        ),
      ],
      [
        path.join(library, 'unknown-user-file.txt'),
        'Private synthetic preservation fixture.\n',
      ],
    ])
      await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
    const beforeLibrary = await inventory(library);
    const beforeState = await fingerprint(state);
    const assertLibrary = async () => {
      assert.deepEqual(await readLibrary(state), {
        path: library,
        available: true,
      });
      assert.deepEqual(await inventory(library), beforeLibrary);
      assert.deepEqual(await fingerprint(state), beforeState);
    };
    const dependencies = {
      discoverRelease: async () => selected,
      installDolphin: (release, root) =>
        installDolphin(release, root, runner, downloader),
      verifyBundle: (...args) => verifyBundle(args[0], runner, args[2]),
      ...libraryOperations,
      spawn: () => {
        spawnAttempts += 1;
        throw new Error('Emulator execution is forbidden in this update test');
      },
    };
    const manager = () =>
      new ComponentManager(
        installation,
        () => undefined,
        dependencies,
        undefined,
        assertLibrary,
      );
    let current = manager();
    phase = 'old-official-install';
    await writeEvidence();
    await current.install();
    stages.push(releases.old.version);
    const oldTrust = await inspect(releases.old);
    await noOwnedMounts();
    await assertLibrary();
    const beforeOld = await inventory(
      path.join(installation, releases.old.version),
      true,
    );
    current = manager();
    assert.deepEqual(await current.status(), {
      version: releases.old.version,
      operation: 'idle',
    });
    await mark('old official install, trust and fresh-manager selection', {
      artifact: oldTrust,
    });
    selected = releases.next;
    phase = 'new-staging-signature-refusal';
    injectFailure = true;
    await writeEvidence();
    await assert.rejects(
      current.install(),
      /Verification command failed: codesign/,
    );
    assert.equal(tamperCount, 1);
    assert.equal(signatureFailureObserved, true);
    assert.equal(current.isBusy, false);
    assert.deepEqual(await current.status(), {
      version: releases.old.version,
      operation: 'idle',
    });
    await noOwnedMounts();
    await assertLibrary();
    assert.deepEqual(
      await inventory(path.join(installation, releases.old.version), true),
      beforeOld,
    );
    await inspect(releases.old);
    await mark(
      'real staged signature rejection preserves prior install and library, releases lock and detaches',
    );
    injectFailure = false;
    phase = 'new-official-retry';
    await writeEvidence();
    await current.install();
    stages.push(releases.next.version);
    const nextTrust = await inspect(releases.next);
    await noOwnedMounts();
    await assertLibrary();
    assert.deepEqual(
      await inventory(path.join(installation, releases.old.version), true),
      beforeOld,
    );
    current = manager();
    assert.deepEqual(await current.status(), {
      version: releases.next.version,
      operation: 'idle',
    });
    await mark('untampered official retry and fresh-manager selection', {
      artifact: nextTrust,
    });
    phase = 'same-version-reverification';
    const beforeDownloadCount = downloadCount;
    await current.install();
    assert.equal(downloadCount, beforeDownloadCount);
    await inspect(releases.old);
    await inspect(releases.next);
    await libraryOperations.prepareDolphinLibrary(library);
    await assertLibrary();
    await noOwnedMounts();
    assert.deepEqual(
      await inventory(path.join(installation, releases.old.version), true),
      beforeOld,
    );
    assert.equal(spawnAttempts, 0);
    assert.equal(downloadCount, 3);
    await mark(
      'same-version verification, both trusted bundles and all original bytes retained',
    );
    phase = 'complete';
    await writeEvidence({
      ready: true,
      selectedVersion: (await current.status()).version,
      preservation: {
        libraryEntries: beforeLibrary.length,
        libraryInventorySHA256: inventoryFingerprint(beforeLibrary),
        libraryPreferences: beforeState,
        oldInstallEntries: beforeOld.length,
        oldInstallInventorySHA256: inventoryFingerprint(beforeOld),
        unchanged: true,
      },
    });
    console.log(`Update/preservation boundary passed: ${evidence}`);
    console.log(
      'No emulator was executed. Gameplay saves, compatibility and rollback remain unverified.',
    );
  } catch (error) {
    await writeEvidence({ error: String(error.message).slice(0, 1000) }).catch(
      () => undefined,
    );
    throw error;
  } finally {
    await evidenceHandle.close();
  }
}

run().catch((error) => {
  console.error(`Update experiment failed in ${phase}: ${error.message}`);
  if (runtime) console.error(`Private evidence retained: ${runtime}`);
  // Existing installer owns mounted-stage recovery; never recursively clean a
  // runtime here or force-detach another image after an installer failure.
  process.exitCode = 1;
});
