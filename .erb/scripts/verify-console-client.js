/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax */
// Developer test: native IPC only. No frontend, game, emulator or download runs.
const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');
const net = require('net');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const {
  createHash,
  randomBytes,
  createHmac,
  timingSafeEqual,
} = require('crypto');

const repository = path.resolve(__dirname, '../..');
require('ts-node').register({
  project: path.join(repository, 'tsconfig.macos.json'),
  transpileOnly: true,
  compilerOptions: { module: 'CommonJS', moduleResolution: 'Node' },
});
const {
  startConsoleBroker,
} = require('../../src/main/macos/console-broker.ts');
const { createCatalog } = require('../../src/main/components/es-de/catalog.ts');

const execute = promisify(execFile);
const roots = new Map();
const children = new Set();
const servers = new Set();
const replies = new Set();
const results = [];
let broker;
let releaseLaunch;
let stage = 'initialize';

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
async function bounded(promise, label, ms = 8000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function passed(name) {
  results.push({ name, passed: true });
}

async function session(helper, entries) {
  const root = await fs.realpath(
    await fs.mkdtemp('/private/tmp/console-client-'),
  );
  await fs.chmod(root, 0o700);
  roots.set(root, await fs.lstat(root));
  await fs.copyFile(helper, path.join(root, 'helper'));
  await fs.chmod(path.join(root, 'helper'), 0o700);
  return createCatalog(root, entries);
}
function client(
  catalog,
  args = [
    '--session',
    catalog.root,
    '--game',
    Object.values(catalog.markers)[0],
  ],
) {
  const child = spawn(catalog.helperPath, args, {
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout = (stdout + chunk.toString()).slice(-4096);
  });
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-4096);
  });
  const result = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      children.delete(child);
      resolve({ code, signal, stdout, stderr });
    });
  });
  return { child, result };
}
async function rejected(catalog, name, args, callbackCount) {
  stage = name;
  const before = callbackCount();
  const result = await bounded(client(catalog, args).result, name);
  assert.equal(result.code, 1, 'Invalid native request must fail');
  assert.equal(result.signal, null);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    'Managed game launch is unavailable. Return to Emulation Workspace.\n',
  );
  assert.equal(
    callbackCount(),
    before,
    'Invalid request invoked launch authority',
  );
  passed(name);
}

async function invalidServerReply(
  helper,
  gameID,
  name,
  challengeChange,
  completionChange,
) {
  stage = name;
  const catalog = await session(helper, [
    { id: gameID, name: 'Protocol fixture' },
  ]);
  const key = randomBytes(32);
  await fs.writeFile(path.join(catalog.root, 'key'), key.toString('hex'), {
    flag: 'wx',
    mode: 0o600,
  });
  const nonce = randomBytes(32).toString('hex');
  let verifiedRequest = false;
  let invalidRequest = false;
  const sockets = new Set();
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.once('close', () => sockets.delete(socket));
    socket.write(
      `${JSON.stringify({ schema: 1, challenge: nonce, ...challengeChange })}\n`,
    );
    let frame = '';
    socket.on('data', (chunk) => {
      frame += chunk.toString();
      if (Buffer.byteLength(frame) > 4096) {
        invalidRequest = true;
        socket.destroy();
      }
    });
    socket.once('end', () => {
      if (!frame) {
        socket.destroy();
        return;
      }
      try {
        assert.ok(
          frame.endsWith('\n') && frame.indexOf('\n') === frame.length - 1,
        );
        const request = JSON.parse(frame);
        assert.deepEqual(Object.keys(request).sort(), [
          'id',
          'proof',
          'schema',
        ]);
        assert.equal(request.schema, 1);
        assert.equal(request.id, gameID);
        const expected = createHmac('sha256', key)
          .update(`${nonce}\n${gameID}`)
          .digest();
        assert.ok(timingSafeEqual(expected, Buffer.from(request.proof, 'hex')));
        verifiedRequest = true;
        socket.end(
          `${JSON.stringify({ ok: true, code: 7, signal: null, ...completionChange })}\n`,
        );
      } catch {
        invalidRequest = true;
        socket.destroy();
      }
    });
  });
  servers.add(server);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(path.join(catalog.root, 's'), resolve);
    });
    await fs.chmod(path.join(catalog.root, 's'), 0o600);
    const result = await bounded(client(catalog).result, name);
    assert.equal(result.code, 1, 'Malformed native server frame was accepted');
    assert.equal(result.signal, null);
    assert.equal(result.stdout, '');
    assert.equal(
      invalidRequest,
      false,
      'Native client sent a malformed request',
    );
    assert.equal(
      result.stderr,
      'Managed game launch is unavailable. Return to Emulation Workspace.\n',
    );
    assert.equal(
      verifiedRequest,
      !challengeChange,
      'Unexpected native request phase',
    );
    passed(name);
  } finally {
    sockets.forEach((socket) => socket.destroy());
    await new Promise((resolve) => {
      server.close(resolve);
    });
    servers.delete(server);
    key.fill(0);
  }
}

async function run() {
  assert.equal(process.platform, 'darwin');
  assert.equal(process.arch, 'arm64');
  const helper = path.join(repository, 'release/native/console-launcher');
  const helperStat = await fs.lstat(helper);
  assert.ok(helperStat.isFile() && !helperStat.isSymbolicLink());
  assert.equal(helperStat.uid, process.getuid());
  assert.ok(
    helperStat.mtimeMs >=
      (await fs.stat(path.join(repository, 'src/native/ConsoleLauncher.swift')))
        .mtimeMs,
    'Rebuild the native launcher before verification',
  );
  assert.equal(
    (await execute('/usr/bin/lipo', ['-archs', helper])).stdout.trim(),
    'arm64',
  );
  const helperHash = createHash('sha256')
    .update(await fs.readFile(helper))
    .digest('hex');
  const gameID = randomBytes(16).toString('hex');
  const unknownID = randomBytes(16).toString('hex');
  const catalog = await session(helper, [
    { id: gameID, name: 'Private interoperability fixture' },
  ]);
  let callbackCount = 0;
  let launchStarted;
  const started = new Promise((resolve) => {
    launchStarted = resolve;
  });
  broker = await startConsoleBroker(
    catalog.root,
    new Set([gameID]),
    async (requestedID) => {
      assert.equal(
        requestedID,
        gameID,
        'Native launcher returned a different opaque ID',
      );
      callbackCount += 1;
      return new Promise((resolve) => {
        releaseLaunch = resolve;
        replies.add(resolve);
        launchStarted();
      });
    },
  );
  stage = 'held-child-lifetime';
  const first = client(catalog);
  await bounded(
    Promise.race([
      started,
      first.result.then(() => {
        throw new Error('Native client exited before launch');
      }),
    ]),
    stage,
  );
  await delay(5200);
  assert.equal(
    first.child.exitCode,
    null,
    'Native client ended before child completion',
  );
  assert.equal(first.child.signalCode, null);
  assert.equal(callbackCount, 1);
  await assert.rejects(broker.close(), /still active/);
  passed('held-client-survives-handshake-deadline');
  await rejected(
    catalog,
    'concurrent-client-refused',
    undefined,
    () => callbackCount,
  );
  releaseLaunch({ code: 7, signal: null });
  replies.delete(releaseLaunch);
  releaseLaunch = undefined;
  const firstResult = await bounded(first.result, 'exact-exit-result');
  assert.deepEqual(firstResult, {
    code: 7,
    signal: null,
    stdout: '',
    stderr: '',
  });
  assert.equal(callbackCount, 1);
  passed('exact-opaque-id-and-exit-seven-after-child-completion');

  stage = 'disconnect-retains-launch-authority';
  const disconnectedStarted = new Promise((resolve) => {
    launchStarted = resolve;
  });
  const disconnected = client(catalog);
  await bounded(
    Promise.race([
      disconnectedStarted,
      disconnected.result.then(() => {
        throw new Error('Native client exited before launch');
      }),
    ]),
    stage,
  );
  assert.equal(callbackCount, 2);
  disconnected.child.kill('SIGTERM');
  assert.equal((await bounded(disconnected.result, stage)).signal, 'SIGTERM');
  await assert.rejects(broker.close(), /still active/);
  await rejected(
    catalog,
    'disconnected-client-retains-single-flight',
    undefined,
    () => callbackCount,
  );
  releaseLaunch({ code: 0, signal: null });
  replies.delete(releaseLaunch);
  releaseLaunch = undefined;
  await delay(20);
  passed('disconnect-retains-launch-authority-until-child-completion');

  const unknownMarker = path.join(catalog.romDirectory, `${unknownID}.ewgame`);
  await fs.writeFile(unknownMarker, '', { flag: 'wx', mode: 0o600 });
  await rejected(
    catalog,
    'unknown-regular-marker-refused',
    ['--session', catalog.root, '--game', unknownMarker],
    () => callbackCount,
  );

  const marker = catalog.markers[gameID];
  const heldMarker = path.join(catalog.root, 'original-marker');
  await fs.rename(marker, heldMarker);
  await fs.symlink(heldMarker, marker);
  try {
    await rejected(
      catalog,
      'symlink-marker-refused',
      undefined,
      () => callbackCount,
    );
    assert.equal((await fs.stat(heldMarker)).size, 0);
  } finally {
    await fs.unlink(marker);
    await fs.rename(heldMarker, marker);
  }

  const alias = `${catalog.root}-alias`;
  await fs.symlink(catalog.root, alias);
  try {
    await rejected(
      catalog,
      'symlink-session-refused',
      [
        '--session',
        alias,
        '--game',
        path.join(alias, 'roms', 'gc', `${gameID}.ewgame`),
      ],
      () => callbackCount,
    );
  } finally {
    await fs.unlink(alias);
  }

  const keyPath = path.join(catalog.root, 'key');
  const originalKey = path.join(catalog.root, 'original-key');
  await fs.rename(keyPath, originalKey);
  const replacementKey = 'd'.repeat(64);
  await fs.writeFile(keyPath, replacementKey, { flag: 'wx', mode: 0o600 });
  try {
    await rejected(
      catalog,
      'replaced-key-refused',
      undefined,
      () => callbackCount,
    );
    assert.equal(await fs.readFile(keyPath, 'utf8'), replacementKey);
  } finally {
    await fs.unlink(keyPath);
    await fs.rename(originalKey, keyPath);
  }

  await rejected(
    catalog,
    'extra-arguments-refused',
    ['--session', catalog.root, '--game', marker, '--exec', '/bin/sh'],
    () => callbackCount,
  );
  await rejected(
    catalog,
    'wrong-argument-name-refused',
    ['--session', catalog.root, '--command', marker],
    () => callbackCount,
  );
  await rejected(
    catalog,
    'non-marker-path-refused',
    ['--session', catalog.root, '--game', catalog.helperPath],
    () => callbackCount,
  );
  stage = 'owned-socket-key-cleanup';
  await broker.close();
  broker = undefined;
  await assert.rejects(fs.lstat(path.join(catalog.root, 's')), {
    code: 'ENOENT',
  });
  await assert.rejects(fs.lstat(keyPath), { code: 'ENOENT' });
  assert.equal((await fs.lstat(marker)).size, 0);
  passed(stage);

  await invalidServerReply(helper, gameID, 'boolean-schema-refused', {
    schema: true,
  });
  await invalidServerReply(helper, gameID, 'fractional-schema-refused', {
    schema: 1.5,
  });
  await invalidServerReply(
    helper,
    gameID,
    'boolean-exitcode-refused',
    undefined,
    { code: true },
  );
  await invalidServerReply(
    helper,
    gameID,
    'fractional-exitcode-refused',
    undefined,
    { code: 7.5 },
  );
  await invalidServerReply(
    helper,
    gameID,
    'negative-exitcode-refused',
    undefined,
    { code: -1 },
  );
  await invalidServerReply(
    helper,
    gameID,
    'overflow-exitcode-refused',
    undefined,
    { code: 256 },
  );
  await invalidServerReply(helper, gameID, 'numeric-ok-refused', undefined, {
    ok: 1,
  });
  return {
    ok: true,
    architecture: 'arm64',
    helperSHA256: helperHash,
    checks: results,
  };
}

async function cleanup() {
  replies.forEach((resolve) => resolve({ code: 1, signal: null }));
  children.forEach((child) => child.kill('SIGTERM'));
  await delay(50);
  await broker?.close();
  servers.forEach((server) => server.close());
  for (const [root, identity] of roots) {
    const current = await fs.lstat(root);
    assert.ok(
      current.isDirectory() &&
        !current.isSymbolicLink() &&
        current.dev === identity.dev &&
        current.ino === identity.ino &&
        (await fs.realpath(root)) === root,
      'Disposable session ownership changed; cleanup refused',
    );
    await fs.rm(root, { recursive: true });
    roots.delete(root);
  }
}

run()
  .then(async (report) => {
    await cleanup();
    console.log(JSON.stringify(report, null, 2));
    return undefined;
  })
  .catch(async () => {
    try {
      await cleanup();
    } catch {
      /* Preserve any unknown replacement data. */
    }
    console.error(
      JSON.stringify({ ok: false, stage, error: 'verification-failed' }),
    );
    process.exitCode = 1;
  });
