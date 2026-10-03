/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax */
// Developer integration test. Never called by renderer IPC or shipped as an installer.
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
  // Root ERB ts-node settings force CommonJS; pair it with Node resolution.
  // Strict source typechecking remains the separate typecheck:macos gate.
  compilerOptions: { module: 'CommonJS', moduleResolution: 'Node' },
});
const { ComponentManager } = require('../../src/main/macos/component-manager');
const { selectLibrary, readLibrary } = require('../../src/main/macos/library');
const {
  prepareDolphinLibrary,
  resetDolphinConfiguration,
  validateGame,
} = require('../../src/main/macos/dolphin-library');
const {
  discoverRelease,
} = require('../../src/main/components/dolphin/download');
const {
  installDolphin,
  verifyBundle,
} = require('../../src/main/components/dolphin/install');
const { dolphin } = require('../../src/main/components/dolphin');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let child;
let directory;
let processLog = '';

async function run() {
  assert.equal(process.platform, 'darwin', 'This test requires native macOS');
  assert.equal(
    process.arch,
    'arm64',
    'This test requires native Apple Silicon Node',
  );
  const fixtureFlag = process.argv.indexOf('--fixture');
  const alignFixture = process.argv.includes('--align-fixture');
  const holdFlag = process.argv.indexOf('--hold');
  const reuseFlag = process.argv.indexOf('--reuse-install');
  const controllerFlag = process.argv.indexOf('--controller-device');
  const nativeMenus = process.argv.includes('--native-menus');
  const holdSeconds = holdFlag < 0 ? 6 : Number(process.argv[holdFlag + 1]);
  assert.ok(
    Number.isInteger(holdSeconds) && holdSeconds >= 1 && holdSeconds <= 600,
  );
  directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'emulation-dolphin-runtime-')),
  );
  const library = path.join(directory, 'ألعاب GameCube Library');
  let installation = path.join(directory, 'components', 'dolphin');
  if (reuseFlag >= 0) {
    const candidate = process.argv[reuseFlag + 1];
    assert.ok(candidate && path.isAbsolute(candidate));
    const canonical = await fs.realpath(candidate);
    const relative = path.relative(await fs.realpath(os.tmpdir()), canonical);
    assert.match(
      relative,
      /^emulation-dolphin-runtime-[A-Za-z0-9]{6}\/components\/dolphin$/,
    );
    installation = canonical;
  }
  const state = path.join(directory, 'state', 'library.json');
  await fs.mkdir(library);
  await fs.mkdir(installation, { recursive: true, mode: 0o700 });
  await selectLibrary(state, library);
  let exits = 0;
  const manager = new ComponentManager(
    installation,
    () => {
      exits += 1;
    },
    {
      discoverRelease,
      installDolphin,
      verifyBundle,
      prepareDolphinLibrary,
      resetDolphinConfiguration,
      validateGame,
      spawn: (executable, args, options) => {
        // Test-only native menus expose actual save-state/configuration actions.
        // Product/frontend launches retain the adapter's normal batch lifecycle.
        const testArgs = nativeMenus
          ? [
              ...args.filter((value) => value !== '--batch'),
              '-C',
              'Dolphin.Display.RenderToMain=True',
              '-C',
              'Dolphin.Display.Fullscreen=False',
            ]
          : args;
        child = spawn(executable, testArgs, {
          ...options,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const append = (chunk) => {
          processLog = (processLog + chunk.toString()).slice(-16000);
        };
        child.stdout.on('data', append);
        child.stderr.on('data', append);
        return child;
      },
    },
  );
  console.log(`Isolated runtime directory: ${directory}`);
  await manager.install();
  const version = (await manager.status()).version;
  assert.ok(version, 'Official Dolphin installation did not activate');
  const receipt = JSON.parse(
    await fs.readFile(path.join(installation, version, 'receipt.json'), 'utf8'),
  );
  assert.equal(receipt.verification, 'codesign-and-gatekeeper');
  assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
  assert.ok(receipt.bytes > 0);
  await prepareDolphinLibrary(library);
  const directories = dolphin.paths(library);
  if (controllerFlag >= 0) {
    const device = process.argv[controllerFlag + 1];
    assert.match(
      device || '',
      /^SDL\/\d{1,3}\/[A-Za-z0-9 ()_.-]{1,100}$/,
      'Use the exact device observed in Dolphin, not a guessed device name',
    );
    // Isolated developer profile, never a preset applied to an existing user.
    await fs.writeFile(
      path.join(directories.configuration, 'GCPadNew.ini'),
      `[GCPad1]\nDevice = ${device}\nButtons/A = \`Button S\`\nButtons/B = \`Button E\`\nButtons/X = \`Button N\`\nButtons/Y = \`Button W\`\nButtons/Z = \`Shoulder R\`\nButtons/Start = \`Start\`\nD-Pad/Up = \`Pad N\`\nD-Pad/Down = \`Pad S\`\nD-Pad/Left = \`Pad W\`\nD-Pad/Right = \`Pad E\`\nMain Stick/Up = \`Left Y-\`\nMain Stick/Down = \`Left Y+\`\nMain Stick/Left = \`Left X-\`\nMain Stick/Right = \`Left X+\`\nC-Stick/Up = \`Right Y-\`\nC-Stick/Down = \`Right Y+\`\nC-Stick/Left = \`Right X-\`\nC-Stick/Right = \`Right X+\`\n`,
      { flag: 'wx', mode: 0o600 },
    );
  }
  const game = path.join(
    directories.roms,
    alignFixture
      ? '240p 1.20 alignment test derivative.dol'
      : 'Legal homebrew smoke.dol',
  );
  let fixture;
  let fixtureName;
  if (fixtureFlag >= 0) {
    const source = process.argv[fixtureFlag + 1];
    assert.ok(
      source && path.isAbsolute(source),
      'Pass a verified, documented homebrew DOL path',
    );
    const stat = await fs.lstat(source);
    assert.ok(
      stat.isFile() && !stat.isSymbolicLink() && stat.size <= 4 * 1024 * 1024,
    );
    fixture = await fs.readFile(source);
    // Exact official release/license provenance: docs/research/homebrew-fixtures.md.
    const fixtures = new Map([
      [
        '1da85a35f494c8a491a16267be1c43097ad85e5fb5d2c9624a9f7504e8815b98',
        {
          bytes: 3800640,
          name: 'GCMM 1.5.2 (GPLv3, source-containing official release)',
        },
      ],
      [
        'ff44d090fde3239b624abac78ac17d29a9f1ac6b113474091fc4024b623205d3',
        {
          bytes: 1723724,
          name: '240p Test Suite GameCube 1.20 (official author release)',
        },
      ],
    ]);
    const verified = fixtures.get(
      createHash('sha256').update(fixture).digest('hex'),
    );
    assert.ok(
      verified && stat.size === verified.bytes,
      'Fixture must match an exact researched official release',
    );
    fixtureName = verified.name;
    assert.ok(
      verified.bytes !== 1723724 || alignFixture,
      'Dolphin 2609 rejects the original 240p 1.20 DOL alignment; use the documented --align-fixture test derivative',
    );
    if (alignFixture) {
      assert.equal(
        verified.bytes,
        1723724,
        'Only the documented 240p test derivative is supported',
      );
      // Dolphin 2609 rounds DOL section lengths to 32 bytes. This developer-only
      // derivative pads the exact official fixture; the source remains unchanged.
      fixture = Buffer.concat([fixture, Buffer.alloc(20)]);
      fixtureName += ' — local derivative with 20 trailing zero bytes';
    }
  } else {
    assert.equal(
      alignFixture,
      false,
      'Alignment requires the exact documented fixture',
    );
    // Original public-domain test: one PowerPC branch-to-self instruction.
    // DOL header: text offset/address/size and entry point; no copyrighted content.
    fixture = Buffer.alloc(0x104);
    fixture.writeUInt32BE(0x100, 0x00);
    fixture.writeUInt32BE(0x80003100, 0x48);
    fixture.writeUInt32BE(4, 0x90);
    fixture.writeUInt32BE(0x80003100, 0xe0);
    fixture.writeUInt32BE(0x48000000, 0x100);
    fixtureName = 'Authored PowerPC branch-loop test (no graphical gameplay)';
  }
  await fs.writeFile(game, fixture, { flag: 'wx', mode: 0o600 });
  // These sentinel files verify preservation only, not actual gameplay saves.
  const save = path.join(directories.saves, 'preservation-sentinel.bin');
  const saveState = path.join(directories.states, 'preservation-sentinel.bin');
  const sentinel = Buffer.from(
    'Synthetic preservation evidence — never a gameplay claim.',
  );
  await fs.writeFile(save, sentinel, { flag: 'wx' });
  await fs.writeFile(saveState, sentinel, { flag: 'wx' });
  await manager.launch(library, game);
  await delay(1500);
  assert.equal(child.exitCode, null, 'Emulator exited during startup');
  const restarted = new ComponentManager(installation, () => undefined);
  assert.equal(
    (await restarted.status()).operation,
    'running',
    'Restarted manager lost the surviving emulator',
  );
  await assert.rejects(restarted.reset(library), /still active/);
  console.log(
    `Dolphin ${version} running ${fixtureName}. Bundle: ${path.join(installation, version, 'Dolphin.app')}`,
  );
  console.log(
    `Native inspection window: ${holdSeconds}s. Quit this isolated Dolphin with Command-Q to exercise normal exit.`,
  );
  const deadline = Date.now() + holdSeconds * 1000;
  while (
    Date.now() < deadline &&
    child.exitCode === null &&
    child.signalCode === null
  )
    await delay(250);
  const nativeExit = child.exitCode !== null || child.signalCode !== null;
  if (!nativeExit) {
    child.kill('SIGTERM');
    // Dolphin's first signal asks it to stop; its second signal performs test
    // cleanup. This applies only to this disposable fixture process.
    await delay(1000);
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGTERM');
  }
  const exitDeadline = Date.now() + 10000;
  while (manager.isBusy && Date.now() < exitDeadline) await delay(100);
  assert.equal(
    manager.isBusy,
    false,
    'Process exit did not release operation ownership',
  );
  assert.equal(exits, 1, 'Exit callback did not run exactly once');
  assert.equal((await restarted.status()).operation, 'idle');
  const previousSettings = await fs.readFile(
    path.join(directories.configuration, 'Dolphin.ini'),
  );
  const actualStates = [];
  const stateNames = await fs.readdir(directories.states);
  assert.ok(stateNames.length <= 128, 'Unexpected state inventory size');
  for (const name of stateNames.filter((entry) => /\.s\d{2}$/.test(entry))) {
    const location = path.join(directories.states, name);
    const stat = await fs.lstat(location);
    assert.ok(
      stat.isFile() && !stat.isSymbolicLink() && stat.size <= 128 * 1024 * 1024,
      'Unexpected emulator state file',
    );
    const bytes = await fs.readFile(location);
    actualStates.push({
      name,
      bytes: stat.size,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  const reset = await manager.reset(library);
  assert.deepEqual(
    await fs.readFile(path.join(reset.backupPath, 'Dolphin.ini')),
    previousSettings,
  );
  assert.deepEqual(await fs.readFile(save), sentinel);
  assert.deepEqual(await fs.readFile(saveState), sentinel);
  assert.deepEqual(await fs.readFile(game), fixture);
  for (const savedState of actualStates) {
    assert.equal(
      createHash('sha256')
        .update(
          await fs.readFile(path.join(directories.states, savedState.name)),
        )
        .digest('hex'),
      savedState.sha256,
      'Emulator-created save state changed during configuration reset',
    );
  }
  assert.equal((await readLibrary(state)).available, true);
  assert.equal(
    (await new ComponentManager(installation, () => undefined).status())
      .version,
    version,
  );
  await fs.writeFile(
    path.join(directory, 'process.log'),
    processLog.split(os.homedir()).join('<home>'),
  );
  const report = {
    ready: true,
    architecture: process.arch,
    version,
    officialArtifact: receipt.artifactURL,
    artifactFingerprint: receipt.sha256,
    verification: receipt.verification,
    scope:
      'process lifecycle and preservation; frame/input require separate inspection',
    fixture: fixtureName,
    fixtureFingerprint: createHash('sha256').update(fixture).digest('hex'),
    processStayedAlive: true,
    restartDetectsRunningGame: true,
    resetRefusedWhileRunning: true,
    exitMethod: nativeExit ? 'native-inspection' : 'SIGTERM-test-cleanup',
    exitCode: child.exitCode,
    exitSignal: child.signalCode,
    syntheticSaveAndStatePreserved: true,
    nativeMenusTestMode: nativeMenus,
    emulatorCreatedStatesPreserved: actualStates,
    settingsBackedUp: true,
    romPreserved: true,
    restartPreservesLibraryAndVersion: true,
    unverified: [
      'homebrew graphical output (requires separate native inspection)',
      'gameplay-created saves',
      'ES-DE',
      'physical controllers',
      'external drive remount',
      'fresh-user/reboot',
      'VoiceOver',
    ],
  };
  await fs.writeFile(
    path.join(directory, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    `Dolphin process-lifecycle verification passed. Report: ${path.join(directory, 'report.json')}`,
  );
  // Keep artifacts for inspection; this is a private temp test installation.
}

run().catch(async (error) => {
  if (child && child.exitCode === null && child.signalCode === null)
    child.kill('SIGTERM');
  if (directory) {
    await fs.writeFile(
      path.join(directory, 'failure.log'),
      `${String(error)}\n${processLog}`.split(os.homedir()).join('<home>'),
    );
  }
  console.error(error.message);
  if (directory) console.error(`Evidence retained: ${directory}`);
  process.exitCode = 1;
});
