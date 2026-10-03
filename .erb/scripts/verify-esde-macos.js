/* eslint-disable no-console */
// Private developer integration. No emulator/frontend binary is bundled or published.
const fs = require('fs/promises');
const { constants } = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert/strict');
const { createHash, randomBytes } = require('crypto');
const { execFileSync, spawn } = require('child_process');

const repository = path.resolve(__dirname, '../..');
require('ts-node').register({
  project: path.join(repository, 'tsconfig.macos.json'),
  transpileOnly: true,
  compilerOptions: { module: 'CommonJS', moduleResolution: 'Node' },
});
const { createCatalog } = require('../../src/main/components/es-de/catalog');
const { startConsoleBroker } = require('../../src/main/macos/console-broker');
const { ComponentManager } = require('../../src/main/macos/component-manager');
const { readLibrary, selectLibrary } = require('../../src/main/macos/library');
const {
  prepareDolphinLibrary,
} = require('../../src/main/macos/dolphin-library');
const { dolphin } = require('../../src/main/components/dolphin');

let root;
let frontend;
let broker;
let mountedDevice;
let activeGame;
let rootIdentity;
let dmgPath;
let mountPoint;
let attachAttempted = false;
let log = Buffer.alloc(0);
let launches = 0;
const outcomes = [];
const launchFailures = [];
const evidenceHandles = new Map();
let evidenceQueue = Promise.resolve();
let evidenceError;
let evidenceTimer;
let lifetimeTimer;
let frontendEnded;
let frontendExit;
let stopping = false;
let stopPromise;
let observeStartup;
const startup = new Promise((resolve) => {
  observeStartup = resolve;
});
const observation = {
  ready: false,
  spawned: false,
  startupObserved: false,
  boundaryPassed: false,
  experiment:
    'VSync disabled (--vsync 0) with --debug on this Mac; not a production default',
  startupEvidence:
    'Pinned ES-DE 3.5.0 Application startup time log milestone; not input, rendering or focus readiness',
  stopReason: null,
};
const LOG_LIMIT = 32768;

const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function deadline(promise, seconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), seconds * 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function secondsArgument(name, fallback, maximum) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(argument(name));
  assert.ok(
    Number.isSafeInteger(value) && value >= 1 && value <= maximum,
    `${name} must be an integer between 1 and ${maximum}`,
  );
  return value;
}

function sameIdentity(current, expected) {
  return current.dev === expected.dev && current.ino === expected.ino;
}

async function assertRoot() {
  const current = await fs.lstat(root);
  assert.ok(
    current.isDirectory() &&
      !current.isSymbolicLink() &&
      current.uid === process.getuid() &&
      (current.mode & 0o7777) === 0o700 &&
      sameIdentity(current, rootIdentity) &&
      (await fs.realpath(root)) === root,
    'Private runtime ownership changed; evidence and cleanup refused',
  );
}

function sanitize(text) {
  return text.split(os.homedir()).join('<home>');
}

function report() {
  return {
    ...observation,
    scope: 'experimental developer-only frontend launch boundary',
    nativeArchitecture: 'arm64',
    esdeVersion: '3.5.0',
    publisher: 'K56UAA4SXL',
    officialArtifactFingerprint:
      '060bd289fa17f8f07bac2eb688698047f7be79b80495983f08580b5f1a046e1e',
    launches,
    outcomes,
    launchFailures,
    frontendExit: frontendExit || null,
    managedGameActive: Boolean(activeGame),
    evidenceError: evidenceError || null,
    unverified: [
      'physical controller input',
      'controller-only exit',
      'focus restoration',
      'gameplay-created saves',
      'production frontend installation',
      'persistent metadata',
      'clean-user/reboot',
    ],
  };
}

async function writeEvidence(name, text) {
  await assertRoot();
  const location = path.join(root, name);
  let owned = evidenceHandles.get(name);
  if (!owned) {
    const handle = await fs.open(location, 'wx+', 0o600);
    owned = { handle, identity: await handle.stat() };
    evidenceHandles.set(name, owned);
  }
  const current = await fs.lstat(location);
  assert.ok(
    current.isFile() &&
      !current.isSymbolicLink() &&
      current.uid === process.getuid() &&
      current.nlink === 1 &&
      sameIdentity(current, owned.identity),
    'Evidence file was replaced; preserved',
  );
  const bytes = Buffer.from(sanitize(text));
  assert.ok(bytes.length <= 65536, 'Evidence exceeds bounded report size');
  let position = 0;
  while (position < bytes.length) {
    const written = await owned.handle.write(
      bytes,
      position,
      bytes.length - position,
      position,
    );
    assert.ok(written.bytesWritten > 0, 'Evidence write made no progress');
    position += written.bytesWritten;
  }
  await owned.handle.truncate(bytes.length);
  await owned.handle.sync();
}

async function nativeLogTail() {
  await assertRoot();
  const location = path.join(root, 'home/ES-DE/logs/es_log.txt');
  let handle;
  try {
    if ((await fs.realpath(location)) !== location)
      throw new Error('Native log path changed');
    handle = await fs.open(location, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    assert.ok(
      stat.isFile() && stat.uid === process.getuid() && stat.nlink === 1,
      'Native log is not an owned regular file',
    );
    const bytes = Buffer.alloc(Math.min(stat.size, LOG_LIMIT));
    const read = await handle.read(
      bytes,
      0,
      bytes.length,
      Math.max(0, stat.size - bytes.length),
    );
    return bytes.subarray(0, read.bytesRead).toString('utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  } finally {
    await handle?.close();
  }
}

function persistEvidence() {
  if (!rootIdentity) return Promise.resolve();
  evidenceQueue = evidenceQueue
    .then(async () => {
      await writeEvidence('frontend.log', log.toString('utf8'));
      await writeEvidence('native-log-tail.log', await nativeLogTail());
      await writeEvidence(
        'report.json',
        `${JSON.stringify(report(), null, 2)}\n`,
      );
    })
    .catch((error) => {
      if (!evidenceError)
        console.error('Bounded evidence write failed; cleanup will still run.');
      evidenceError = error.code || 'evidence-unavailable';
    });
  return evidenceQueue;
}

function appendLog(chunk) {
  log = Buffer.concat([log, chunk]).subarray(-LOG_LIMIT);
  // This exact milestone is emitted immediately before the main application loop
  // in the pinned v3.5.0 es-app/src/main.cpp:1264. --debug mirrors it to stderr.
  if (
    !observation.startupObserved &&
    /Info:\s+Application startup time: \d+ ms(?:\r?\n|$)/.test(
      log.toString('utf8'),
    )
  ) {
    observation.startupObserved = true;
    observeStartup();
    console.log(
      'ES-DE startup log milestone observed; rendering, input and focus remain unverified.',
    );
    persistEvidence();
  }
}

async function stopFrontend(reason) {
  if (stopPromise) return stopPromise;
  stopping = true;
  observation.stopReason = reason;
  console.error(reason);
  stopPromise = (async () => {
    await persistEvidence();
    // A timeout may stop only this frontend, and only while no game is active.
    // The callback/broker retain their lock through the exact managed child exit.
    if (activeGame) {
      console.error(
        'Waiting for the managed game to exit normally; its lock remains held.',
      );
      await activeGame.catch(() => undefined);
    }
    if (
      frontend &&
      frontend.exitCode === null &&
      frontend.signalCode === null
    ) {
      frontend.kill('SIGTERM');
      try {
        await deadline(frontendEnded, 3, 'Frontend did not stop');
      } catch {
        assert.equal(Boolean(activeGame), false, 'Managed game still active');
        frontend.kill('SIGKILL');
        await deadline(frontendEnded, 3, 'Tracked frontend did not terminate');
      }
    }
  })();
  return stopPromise;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  assert.ok(index >= 0 && process.argv[index + 1], `Required ${name}`);
  return process.argv[index + 1];
}

function command(executable, args, input) {
  return execFileSync(executable, args, {
    input,
    timeout: 60000,
    maxBuffer: 2 * 1024 * 1024,
    encoding: 'utf8',
  });
}

function plist(output) {
  const start = output.indexOf('<?xml');
  assert.ok(start >= 0, 'Expected native property list');
  return JSON.parse(
    command(
      '/usr/bin/plutil',
      ['-convert', 'json', '-o', '-', '--', '-'],
      output.slice(start),
    ),
  );
}

async function verifyFrontend(bundle) {
  const metadata = JSON.parse(
    command('/usr/bin/plutil', [
      '-convert',
      'json',
      '-o',
      '-',
      path.join(bundle, 'Contents/Info.plist'),
    ]),
  );
  assert.equal(metadata.CFBundleIdentifier, '3.5.0');
  assert.equal(metadata.CFBundleShortVersionString, '3.5.0');
  assert.equal(metadata.CFBundleExecutable, 'ES-DE');
  assert.equal(metadata.LSMinimumSystemVersion, '11.0.0');
  assert.equal(
    command('/usr/bin/lipo', [
      '-archs',
      path.join(bundle, 'Contents/MacOS/ES-DE'),
    ]).trim(),
    'arm64',
  );
  command('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
  command('/usr/bin/codesign', [
    '--verify',
    '--strict',
    '-R',
    '=anchor apple generic and identifier "3.5.0" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "K56UAA4SXL"',
    bundle,
  ]);
  command('/usr/sbin/spctl', ['--assess', '--type', 'execute', bundle]);
}

async function detach() {
  if (!attachAttempted) return;
  await assertRoot();
  const inventory = plist(command('/usr/bin/hdiutil', ['info', '-plist']));
  assert.ok(
    Array.isArray(inventory.images) && inventory.images.length <= 256,
    'Unsupported mount inventory; preserved for inspection',
  );
  const entities = inventory.images
    .flatMap((image) => {
      assert.ok(
        Array.isArray(image['system-entities']) &&
          image['system-entities'].length <= 256,
        'Unsupported image inventory; preserved for inspection',
      );
      return image['system-entities'].map((entity) => ({
        ...entity,
        imagePath: image['image-path'],
      }));
    })
    .filter((entity) => entity['mount-point'] === mountPoint);
  if (!entities.length) {
    mountedDevice = null;
    attachAttempted = false;
    return;
  }
  assert.ok(
    entities.length === 1 &&
      entities[0].imagePath === dmgPath &&
      /^\/dev\/disk\d+s\d+$/.test(entities[0]['dev-entry']) &&
      (!mountedDevice || entities[0]['dev-entry'] === mountedDevice),
    'Mount ownership changed; preserved for inspection',
  );
  // A timed-out attach or malformed plist can still have mounted the image.
  // Fresh inventory identifies only this exact private mount and canonical DMG.
  mountedDevice = entities[0]['dev-entry'];
  command('/usr/bin/hdiutil', ['detach', mountedDevice]);
  mountedDevice = null;
  attachAttempted = false;
}

async function run() {
  assert.equal(process.platform, 'darwin');
  assert.equal(process.arch, 'arm64');
  const startupSeconds = secondsArgument('--startup-timeout', 45, 300);
  const sessionSeconds = secondsArgument('--session-timeout', 600, 1800);
  assert.ok(
    sessionSeconds >= startupSeconds,
    'Session timeout must cover startup observation',
  );
  observation.startupDeadlineSeconds = startupSeconds;
  observation.frontendDeadlineSeconds = sessionSeconds;
  const dmg = argument('--dmg');
  const fixturePath = argument('--fixture');
  assert.ok(path.isAbsolute(dmg) && path.isAbsolute(fixturePath));
  const dmgStat = await fs.lstat(dmg);
  assert.ok(
    dmgStat.isFile() && !dmgStat.isSymbolicLink() && dmgStat.size === 79383926,
  );
  assert.equal(
    createHash('sha256')
      .update(await fs.readFile(dmg))
      .digest('hex'),
    '060bd289fa17f8f07bac2eb688698047f7be79b80495983f08580b5f1a046e1e',
  );
  dmgPath = await fs.realpath(dmg);
  assert.ok(
    sameIdentity(await fs.lstat(dmgPath), dmgStat),
    'Verified image changed',
  );
  const fixtureStat = await fs.lstat(fixturePath);
  assert.ok(
    fixtureStat.isFile() &&
      !fixtureStat.isSymbolicLink() &&
      fixtureStat.size === 1723744,
  );
  const fixture = await fs.readFile(fixturePath);
  assert.equal(
    createHash('sha256').update(fixture).digest('hex'),
    '6b273803b960113565f0b0ff8f0109a9e58e17b1fae34a262957e8fc6f4cec70',
  );
  const installation = await fs.realpath(argument('--dolphin-install'));
  assert.match(
    path.relative(await fs.realpath(os.tmpdir()), installation),
    /^emulation-dolphin-runtime-[A-Za-z0-9]{6}\/components\/dolphin$/,
  );
  root = await fs.realpath(await fs.mkdtemp('/private/tmp/ew-console-'));
  await fs.chmod(root, 0o700);
  rootIdentity = await fs.lstat(root);
  console.log(`Private frontend runtime: ${root}`);
  await persistEvidence();
  evidenceTimer = setInterval(() => {
    persistEvidence();
  }, 1000);
  await fs.copyFile(
    path.join(repository, 'release/native/console-launcher'),
    path.join(root, 'helper'),
  );
  await fs.chmod(path.join(root, 'helper'), 0o500);
  const helperBytes = await fs.readFile(path.join(root, 'helper'));
  assert.deepEqual(
    helperBytes,
    await fs.readFile(path.join(repository, 'release/native/console-launcher')),
  );
  observation.helperFingerprint = createHash('sha256')
    .update(helperBytes)
    .digest('hex');
  const id = randomBytes(16).toString('hex');
  const catalog = await createCatalog(root, [
    {
      id,
      name: '240p Test Suite — original Unicode / `backtick` | & %ROM% name',
    },
  ]);
  const library = path.join(root, 'ألعاب GameCube Library');
  await fs.mkdir(library, { mode: 0o700 });
  const state = path.join(root, 'library.json');
  await selectLibrary(state, library);
  await prepareDolphinLibrary(library);
  const directories = dolphin.paths(library);
  const game = path.join(
    directories.roms,
    'اختبار `not-a-command` | & %ROM%.dol',
  );
  await fs.writeFile(game, fixture, { flag: 'wx', mode: 0o600 });
  const controllerIndex = process.argv.indexOf('--controller-device');
  if (controllerIndex >= 0) {
    const device = argument('--controller-device');
    assert.match(device, /^SDL\/\d{1,3}\/[A-Za-z0-9 ()_.-]{1,100}$/);
    await fs.writeFile(
      path.join(directories.configuration, 'GCPadNew.ini'),
      `[GCPad1]\nDevice = ${device}\nButtons/A = \`Button S\`\nButtons/B = \`Button E\`\nButtons/X = \`Button N\`\nButtons/Y = \`Button W\`\nButtons/Z = \`Shoulder R\`\nButtons/Start = \`Start\`\nD-Pad/Up = \`Pad N\`\nD-Pad/Down = \`Pad S\`\nD-Pad/Left = \`Pad W\`\nD-Pad/Right = \`Pad E\`\nMain Stick/Up = \`Left Y-\`\nMain Stick/Down = \`Left Y+\`\nMain Stick/Left = \`Left X-\`\nMain Stick/Right = \`Left X+\`\nC-Stick/Up = \`Right Y-\`\nC-Stick/Down = \`Right Y+\`\nC-Stick/Left = \`Right X-\`\nC-Stick/Right = \`Right X+\`\nTriggers/L = \`Trigger L\`\nTriggers/R = \`Trigger R\`\nTriggers/L-Analog = \`Trigger L\`\nTriggers/R-Analog = \`Trigger R\`\n`,
      { flag: 'wx', mode: 0o600 },
    );
    // Explicit physical-test configuration belongs only to this new private
    // library. It never changes the product's confirmation or hotkey defaults.
    await fs.writeFile(
      path.join(directories.configuration, 'Hotkeys.ini'),
      `[Hotkeys]\nDevice = ${device}\nGeneral/Exit = hold(\`Back\` & \`Start\`, 1.5)\nGeneral/Stop =\n`,
      { flag: 'wx', mode: 0o600 },
    );
    const config = path.join(directories.configuration, 'Dolphin.ini');
    const configStat = await fs.lstat(config);
    assert.ok(configStat.isFile() && !configStat.isSymbolicLink());
    assert.equal(
      await fs.readFile(config, 'utf8'),
      '[Core]\nGFXBackend = Metal\n[Analytics]\nEnabled = False\nPermissionAsked = True\n',
      'Expected the freshly created private Dolphin defaults',
    );
    const configHandle = await fs.open(
      config,
      constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW,
    );
    try {
      assert.ok(sameIdentity(await configHandle.stat(), configStat));
      await configHandle.writeFile('[Interface]\nConfirmStop = False\n');
      await configHandle.sync();
    } finally {
      await configHandle.close();
    }
    await fs.mkdir(path.join(catalog.home, 'ES-DE/settings'), { mode: 0o700 });
    await fs.writeFile(
      path.join(catalog.home, 'ES-DE/settings/es_settings.xml'),
      '<?xml version="1.0" encoding="UTF-8"?>\n<string name="InputControllerType" value="ps5"/>\n<bool name="DebugSkipInputLogging" value="false"/>\n',
      { flag: 'wx', mode: 0o600 },
    );
    observation.physicalTestConfiguration = {
      controllerDevice: device,
      exitExpression: 'hold(`Back` & `Start`, 1.5)',
      stopExpression: '',
      confirmationDisabled: true,
      measured: false,
      scope:
        'Explicit disposable physical-test profile; no physical press inferred',
    };
  }
  const manager = new ComponentManager(
    installation,
    () => undefined,
    undefined,
    undefined,
    async (expected) => {
      const saved = await readLibrary(state);
      assert.ok(saved.available && saved.path === expected, 'Library changed');
    },
  );
  await manager.install();
  mountPoint = path.join(root, 'mount');
  await assertRoot();
  await fs.mkdir(mountPoint, { mode: 0o700 });
  assert.ok(
    sameIdentity(await fs.lstat(dmgPath), dmgStat),
    'Verified image changed before attachment',
  );
  // The exact MIT DMG license was reviewed in docs/research/es-de-artifact.md.
  attachAttempted = true;
  const attached = plist(
    command(
      '/usr/bin/hdiutil',
      [
        'attach',
        '-readonly',
        '-nobrowse',
        '-noautoopen',
        '-mountpoint',
        mountPoint,
        '-plist',
        dmgPath,
      ],
      'Y\n',
    ),
  );
  const volumes = attached['system-entities'].filter(
    (entry) => entry['mount-point'],
  );
  assert.equal(volumes.length, 1);
  assert.equal(volumes[0]['mount-point'], mountPoint);
  assert.match(volumes[0]['dev-entry'], /^\/dev\/disk\d+s\d+$/);
  mountedDevice = volumes[0]['dev-entry'];
  await verifyFrontend(path.join(mountPoint, 'ES-DE.app'));
  const bundle = path.join(root, 'ES-DE.app');
  await fs.cp(path.join(mountPoint, 'ES-DE.app'), bundle, {
    recursive: true,
    force: false,
    errorOnExist: true,
    dereference: false,
    verbatimSymlinks: true,
  });
  await detach();
  await verifyFrontend(bundle);
  broker = await startConsoleBroker(root, new Set([id]), async (requested) => {
    assert.equal(stopping, false, 'Frontend session is stopping');
    assert.equal(requested, id);
    assert.ok(launches < 100, 'Developer launch observation limit reached');
    launches += 1;
    console.log(
      'Frontend requested the known opaque marker; launching the original ROM argv.',
    );
    activeGame = manager.launchAndWait(library, game);
    try {
      const result = await activeGame;
      outcomes.push(result);
      return result;
    } catch (error) {
      const failure = sanitize(String(error.message || error)).slice(0, 2048);
      launchFailures.push(failure);
      console.error(`Private manager launch failed: ${failure}`);
      throw error;
    } finally {
      activeGame = null;
    }
  });
  assert.equal(stopping, false, 'Frontend session was interrupted');
  const executable = path.join(bundle, 'Contents/MacOS/ES-DE');
  frontend = spawn(
    executable,
    [
      '--home',
      catalog.home,
      '--resolution',
      '960',
      '640',
      '--fullscreen-padding',
      '0',
      '--no-splash',
      '--no-update-check',
      '--gamelist-only',
      '--vsync',
      '0',
      '--debug',
    ],
    {
      cwd: bundle,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: '/usr/bin:/bin',
        HOME: catalog.home,
        TMPDIR: os.tmpdir(),
        LANG: 'en_US.UTF-8',
        ESDE_APPDATA_DIR: path.join(catalog.home, 'ES-DE'),
      },
    },
  );
  frontend.stdout.on('data', appendLog);
  frontend.stderr.on('data', appendLog);
  frontend.once('spawn', () => {
    observation.spawned = true;
    persistEvidence();
  });
  frontendEnded = new Promise((resolve, reject) => {
    frontend.once('error', reject);
    frontend.once('close', (code, signal) => {
      frontendExit = { code, signal };
      resolve(frontendExit);
    });
  });
  lifetimeTimer = setTimeout(() => {
    stopFrontend('Frontend lifetime deadline reached').catch((error) => {
      observation.stopError = error.message;
      persistEvidence();
    });
  }, sessionSeconds * 1000);
  console.log(`Verified ES-DE 3.5.0 spawn requested. Bundle: ${bundle}`);
  console.log(observation.experiment);
  await deadline(
    Promise.race([
      startup,
      frontendEnded.then(() => {
        throw new Error('Frontend exited before startup observation');
      }),
    ]),
    startupSeconds,
    'Frontend startup observation deadline reached',
  );
  console.log(
    'Inspect the GameCube entry, launch it, quit Dolphin normally, then quit ES-DE. No physical-input or focus success is inferred.',
  );
  await frontendEnded;
  clearTimeout(lifetimeTimer);
  // Closing the frontend never kills a save-writing game or releases its lock.
  if (activeGame) {
    console.log(
      'Frontend exited while a game remains active; waiting for its normal exit.',
    );
    await activeGame;
  }
  await broker.close();
  broker = null;
  assert.deepEqual(await fs.readFile(game), fixture);
  observation.originalROMPreserved = true;
  assert.equal(
    observation.stopReason,
    null,
    'Observation session did not finish normally',
  );
  assert.ok(
    launches > 0,
    'No frontend-to-Dolphin launch observed; retained report is not a passing lifecycle',
  );
  assert.ok(
    outcomes.length === launches &&
      outcomes.every((result) => result.code === 0 && result.signal === null),
    'A managed emulator did not exit normally',
  );
  assert.deepEqual(frontendExit, { code: 0, signal: null });
  assert.equal(evidenceError, undefined, 'Evidence writing failed');
  observation.boundaryPassed = true;
  observation.ready = true;
  await persistEvidence();
  assert.equal(evidenceError, undefined, 'Final evidence writing failed');
  console.log(
    `Experimental ES-DE boundary passed. Report: ${path.join(root, 'report.json')}`,
  );
}

const signalHandlers = new Map(
  ['SIGINT', 'SIGTERM'].map((signal) => {
    const handler = () => {
      stopFrontend(`Developer session received ${signal}`).catch((error) => {
        observation.stopError = error.message;
        persistEvidence();
      });
    };
    process.on(signal, handler);
    return [signal, handler];
  }),
);

async function finish() {
  try {
    await run();
  } catch (error) {
    observation.ready = false;
    observation.boundaryPassed = false;
    observation.failure = error.message;
    console.error(error.message);
    if (rootIdentity) {
      try {
        await writeEvidence(
          'failure.log',
          `${String(error)}\n${log.toString('utf8')}`,
        );
      } catch {
        console.error(
          'Failure evidence could not be written; cleanup will still run.',
        );
      }
      console.error(`Evidence retained: ${root}`);
    }
    try {
      await stopFrontend(error.message);
    } catch (stopError) {
      console.error(`Tracked frontend needs review: ${stopError.message}`);
    }
    process.exitCode = 1;
  } finally {
    clearTimeout(lifetimeTimer);
    try {
      await detach();
    } catch (detachError) {
      console.error(`Owned mount needs review: ${detachError.message}`);
      process.exitCode = 1;
    }
    // Do not close or orphan a broker whose exact game callback remains active.
    if (activeGame) await activeGame.catch(() => undefined);
    try {
      await broker?.close();
    } catch (closeError) {
      console.error(`Owned broker needs review: ${closeError.message}`);
      process.exitCode = 1;
    }
    clearInterval(evidenceTimer);
    await persistEvidence();
    await Promise.allSettled(
      [...evidenceHandles.values()].map(({ handle }) => handle.close()),
    );
    signalHandlers.forEach((handler, signal) =>
      process.removeListener(signal, handler),
    );
  }
}

finish().catch(() => {
  console.error(
    'Developer verification cleanup failed; owned runtime retained.',
  );
  process.exitCode = 1;
});
