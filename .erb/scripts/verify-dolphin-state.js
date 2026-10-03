/* eslint-disable no-console */
// Private native state inspection. Never point this at a user's library.
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { createHash } = require('crypto');
const { spawn } = require('child_process');
const repository = path.resolve(__dirname, '../..');
require('ts-node').register({
  project: path.join(repository, 'tsconfig.macos.json'),
  transpileOnly: true,
  compilerOptions: { module: 'CommonJS', moduleResolution: 'Node' },
});
const { ComponentManager } = require('../../src/main/macos/component-manager');
const { readLibrary } = require('../../src/main/macos/library');
const libraryOperations = require('../../src/main/macos/dolphin-library');
const {
  discoverRelease,
} = require('../../src/main/components/dolphin/download');
const {
  installDolphin,
  verifyBundle,
} = require('../../src/main/components/dolphin/install');

function argument(name) {
  const index = process.argv.indexOf(name);
  assert.ok(index >= 0 && process.argv[index + 1], `Required ${name}`);
  return process.argv[index + 1];
}

async function privateRuntime(value) {
  assert.ok(path.isAbsolute(value));
  const canonical = await fs.realpath(value);
  const relative = path.relative(await fs.realpath(os.tmpdir()), canonical);
  assert.match(relative, /^emulation-dolphin-runtime-[A-Za-z0-9]{6}$/);
  const stat = await fs.lstat(canonical);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  assert.equal(stat.uid, process.getuid());
  assert.equal(stat.mode & 0o777, 0o700);
  return canonical;
}

async function fingerprint(file, maximum) {
  const stat = await fs.lstat(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
  assert.ok(stat.size > 0 && stat.size <= maximum);
  assert.equal(await fs.realpath(file), file);
  return {
    bytes: stat.size,
    sha256: createHash('sha256')
      .update(await fs.readFile(file))
      .digest('hex'),
  };
}

async function run() {
  assert.equal(process.platform, 'darwin');
  assert.equal(process.arch, 'arm64');
  const runtime = await privateRuntime(argument('--runtime'));
  const installation = await fs.realpath(argument('--dolphin-install'));
  await privateRuntime(path.resolve(installation, '../..'));
  assert.equal(path.basename(installation), 'dolphin');
  assert.equal(path.basename(path.dirname(installation)), 'components');
  const evidence = path.join(runtime, 'state-reopen-report.json');
  // Reserve evidence before any launch/configuration mutation. A retained report
  // makes a completed or interrupted runtime deliberately non-reusable.
  const evidenceHandle = await fs.open(evidence, 'wx', 0o600);
  try {
    await evidenceHandle.writeFile(
      `${JSON.stringify({ ready: false, scope: 'state restoration pending' })}\n`,
    );
    await evidenceHandle.sync();
    const reportPath = path.join(runtime, 'report.json');
    const reportStat = await fs.lstat(reportPath);
    assert.ok(
      reportStat.isFile() &&
        !reportStat.isSymbolicLink() &&
        reportStat.size <= 16384,
    );
    const previous = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.equal(previous.version, '2609');
    assert.equal(
      previous.fixtureFingerprint,
      '6b273803b960113565f0b0ff8f0109a9e58e17b1fae34a262957e8fc6f4cec70',
    );
    assert.equal(previous.verification, 'codesign-and-gatekeeper');
    assert.ok(Array.isArray(previous.emulatorCreatedStatesPreserved));
    assert.equal(previous.emulatorCreatedStatesPreserved.length, 1);
    const recorded = previous.emulatorCreatedStatesPreserved[0];
    assert.equal(path.basename(recorded.name), recorded.name);
    assert.match(recorded.name, /\.s01$/);
    const statePath = path.join(runtime, 'state/library.json');
    const library = path.join(runtime, 'ألعاب GameCube Library');
    const assertLibrary = async (expected) => {
      const saved = await readLibrary(statePath);
      assert.ok(saved && saved.available && saved.path === expected);
    };
    await assertLibrary(library);
    const directories =
      require('../../src/main/components/dolphin').dolphin.paths(library);
    const game = path.join(
      directories.roms,
      '240p 1.20 alignment test derivative.dol',
    );
    assert.equal(
      (await fingerprint(game, 2 * 1024 * 1024)).sha256,
      previous.fixtureFingerprint,
    );
    const state = path.join(directories.states, recorded.name);
    const before = await fingerprint(state, 128 * 1024 * 1024);
    assert.deepEqual(before, {
      bytes: recorded.bytes,
      sha256: recorded.sha256,
    });
    let selectedVersion;
    const manager = new ComponentManager(
      installation,
      () => undefined,
      {
        discoverRelease,
        installDolphin,
        verifyBundle,
        ...libraryOperations,
        spawn: (executable, args, options) => {
          assert.equal(
            executable,
            path.join(
              installation,
              selectedVersion,
              'Dolphin.app/Contents/MacOS/Dolphin',
            ),
            'The spawned executable must match the inspected version',
          );
          return spawn(
            executable,
            [
              ...args.filter((value) => value !== '--batch'),
              '-C',
              'Dolphin.Display.RenderToMain=True',
              '-C',
              'Dolphin.Display.Fullscreen=False',
            ],
            options,
          );
        },
      },
      undefined,
      assertLibrary,
    );
    selectedVersion = (await manager.status()).version;
    assert.equal(
      selectedVersion,
      previous.version,
      'Installed version changed',
    );
    console.log('Reopening the same private ROM after settings reset.');
    console.log(
      'Use Emulation → Load State → Load State from Slot → Slot 1; inspect the native Loaded State result, then quit normally.',
    );
    console.log(
      'This wait never signals the emulator. Close the game normally to finish.',
    );
    const exit = await manager.launchAndWait(library, game);
    assert.deepEqual(
      exit,
      { code: 0, signal: null },
      'Normal emulator exit required',
    );
    assert.deepEqual(await fingerprint(state, 128 * 1024 * 1024), before);
    const reset = await manager.reset(library);
    assert.deepEqual(await fingerprint(state, 128 * 1024 * 1024), before);
    const result = {
      scope:
        'same private ROM and emulator-created state after configuration reset',
      ready: true,
      version: selectedVersion,
      exit,
      state: { name: recorded.name, ...before },
      unchangedAfterNormalExitAndSecondReset: true,
      settingsBackedUp: Boolean(reset.backupPath),
      unverified: [
        'native load result (separate computer-use observation required)',
        'gameplay-created memory-card save',
        'physical controller',
        'Mac reboot',
      ],
    };
    await evidenceHandle.truncate(0);
    await evidenceHandle.write(
      `${JSON.stringify(result, null, 2)}\n`,
      0,
      'utf8',
    );
    await evidenceHandle.sync();
    console.log(`State persistence boundary passed: ${evidence}`);
  } finally {
    await evidenceHandle.close();
  }
}

run().catch((error) => {
  console.error(error.message);
  // Preserve a running game, original preferences and all state files.
  process.exitCode = 1;
});
