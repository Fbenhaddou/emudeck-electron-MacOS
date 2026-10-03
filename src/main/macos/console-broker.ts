/* eslint import/prefer-default-export: "off" -- Explicit broker capability export. */
import fs from 'fs/promises';
import type { BigIntStats } from 'fs';
import net from 'net';
import path from 'path';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const failure = `${JSON.stringify({ ok: false, error: 'launch-failed' })}\n`;
const requestMember =
  '(?:"schema"\\s*:\\s*1|"id"\\s*:\\s*"[a-f0-9]{32}"|"proof"\\s*:\\s*"[a-f0-9]{64}")';
const requestFrame = new RegExp(
  `^\\s*\\{\\s*${requestMember}\\s*,\\s*${requestMember}\\s*,\\s*${requestMember}\\s*\\}\\s*$`,
);

function sameIdentity(current: BigIntStats, expected: BigIntStats): boolean {
  return current.dev === expected.dev && current.ino === expected.ino;
}

function hasMode(stat: BigIntStats, mode: bigint): boolean {
  // eslint-disable-next-line no-bitwise -- Exact private POSIX permissions.
  return (stat.mode & 0o777n) === mode;
}

async function statIfPresent(file: string): Promise<BigIntStats | null> {
  return fs
    .lstat(file, { bigint: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
}

/** A client half-closes its write side after one frame, then awaits the child reply. */
export async function startConsoleBroker(
  sessionRoot: string,
  allowedIDs: ReadonlySet<string>,
  launch: (
    id: string,
  ) => Promise<{ code: number | null; signal: string | null }>,
): Promise<{ close(): Promise<void> }> {
  const socketPath = path.join(sessionRoot, 's');
  if (
    !/^\/[A-Za-z0-9/._-]+$/.test(sessionRoot) ||
    path.resolve(sessionRoot) !== sessionRoot ||
    Buffer.byteLength(socketPath) > 100
  )
    throw new Error('Unsupported console session location');
  const owner = BigInt(process.getuid!());
  const rootStat = await fs.lstat(sessionRoot, { bigint: true });
  async function assertRoot(): Promise<void> {
    const current = await fs.lstat(sessionRoot, { bigint: true });
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      current.uid !== owner ||
      !hasMode(current, 0o700n) ||
      !sameIdentity(current, rootStat) ||
      (await fs.realpath(sessionRoot)) !== sessionRoot
    )
      throw new Error('Console session ownership changed');
  }
  await assertRoot();
  const ids = new Set(allowedIDs);
  if (ids.size > 100000 || [...ids].some((id) => !/^[a-f0-9]{32}$/.test(id)))
    throw new Error('Unsupported console launch identifiers');
  if (await statIfPresent(socketPath))
    throw new Error('Console socket location is occupied');

  const keyPath = path.join(sessionRoot, 'key');
  const key = Uint8Array.from(randomBytes(32));
  const keyText = Buffer.from(key).toString('hex');
  let keyStat: BigIntStats | null = null;
  let keyComplete = false;
  let socketStat: BigIntStats | null = null;
  const connections = new Set<net.Socket>();
  let active = false;
  let ready = false;
  let closing = false;
  let closed = false;
  let closingPromise: Promise<void> | null = null;

  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    if (!ready || closing || closed || connections.size >= 2) {
      socket.destroy();
      return;
    }
    connections.add(socket);
    const challenge = randomBytes(32).toString('hex');
    let frame = Buffer.alloc(0);
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const respond = (message: string) => {
      if (!socket.destroyed) socket.end(message, () => socket.destroy());
    };
    const reject = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      respond(failure);
    };
    timer = setTimeout(reject, 5000);
    socket.on('error', () => {
      finished = true;
      clearTimeout(timer);
      socket.destroy();
    });
    socket.once('close', () => {
      clearTimeout(timer);
      connections.delete(socket);
    });
    socket.write(`${JSON.stringify({ schema: 1, challenge })}\n`);
    socket.on('data', (chunk: Buffer) => {
      if (finished) return;
      if (frame.length + chunk.length > 4096) {
        reject();
        return;
      }
      frame = Buffer.concat([Uint8Array.from(frame), Uint8Array.from(chunk)]);
      const newline = frame.indexOf(10);
      if (newline >= 0 && newline !== frame.length - 1) reject();
    });
    socket.once('end', () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      void (async () => {
        let claimed = false;
        try {
          if (
            closing ||
            closed ||
            active ||
            frame.length === 0 ||
            frame[frame.length - 1] !== 10
          )
            throw new Error('Invalid launch request');
          const text = frame.subarray(0, -1).toString('utf8');
          if (!requestFrame.test(text))
            throw new Error('Invalid launch request');
          const request = JSON.parse(text);
          if (
            Object.keys(request).sort().join(',') !== 'id,proof,schema' ||
            request.schema !== 1 ||
            !ids.has(request.id)
          )
            throw new Error('Invalid launch request');
          const proof = createHmac('sha256', key)
            .update(`${challenge}\n${request.id}`)
            .digest();
          if (
            !timingSafeEqual(
              Uint8Array.from(proof),
              Uint8Array.from(Buffer.from(request.proof, 'hex')),
            )
          )
            throw new Error('Invalid launch request');
          // Claim before invoking any async callback. Disconnect never releases it.
          active = true;
          claimed = true;
          const result = await launch(request.id);
          if (
            !result ||
            Object.keys(result).sort().join(',') !== 'code,signal' ||
            (result.code !== null &&
              (!Number.isSafeInteger(result.code) ||
                result.code < 0 ||
                result.code > 255)) ||
            (result.signal !== null &&
              (typeof result.signal !== 'string' ||
                !/^SIG[A-Z0-9]{1,24}$/.test(result.signal)))
          )
            throw new Error('Invalid launch result');
          respond(`${JSON.stringify({ ok: true, ...result })}\n`);
        } catch {
          respond(failure);
        } finally {
          if (claimed) active = false;
        }
      })();
    });
  });
  // Startup errors have a rejecting listener below; later errors must not crash main.
  server.on('error', () => undefined);

  async function removeKey(): Promise<void> {
    if (!keyStat) return;
    await assertRoot();
    const current = await statIfPresent(keyPath);
    if (
      current &&
      current.isFile() &&
      !current.isSymbolicLink() &&
      sameIdentity(current, keyStat) &&
      current.uid === owner &&
      hasMode(current, 0o600n) &&
      // A failed creation still owns its original partial file. Once published,
      // preserve in-place edits as well as replacement files during cleanup.
      (!keyComplete ||
        (current.size === 64n &&
          (await fs.readFile(keyPath, 'utf8')) === keyText))
    )
      await fs.unlink(keyPath);
  }
  async function close(): Promise<void> {
    if (active) throw new Error('A console game is still active');
    if (closed) return Promise.resolve();
    if (closingPromise) return closingPromise;
    closing = true;
    closingPromise = (async () => {
      try {
        await assertRoot();
        if (server.listening) {
          const current = await statIfPresent(socketPath);
          if (
            !socketStat ||
            !current ||
            !current.isSocket() ||
            !sameIdentity(current, socketStat) ||
            current.uid !== owner ||
            !hasMode(current, 0o600n)
          )
            throw new Error('Console socket ownership changed');
          // Node close unlinks the bind path itself. Refuse a changed path first;
          // do not move or delete unknown replacement files to force closure.
          connections.forEach((socket) => socket.destroy());
          await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          });
        }
        await removeKey();
        closed = true;
        key.fill(0);
      } finally {
        closing = false;
        closingPromise = null;
      }
    })();
    return closingPromise;
  }

  try {
    const handle = await fs.open(keyPath, 'wx', 0o600);
    try {
      keyStat = await handle.stat({ bigint: true });
      await handle.chmod(0o600);
      await handle.writeFile(keyText);
      await handle.sync();
      keyComplete = true;
    } finally {
      await handle.close();
    }
    await assertRoot();
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once('error', onError);
      server.listen(socketPath, () => {
        server.removeListener('error', onError);
        resolve();
      });
    });
    const created = await fs.lstat(socketPath, { bigint: true });
    if (!created.isSocket() || created.uid !== owner)
      throw new Error('Console socket ownership changed');
    socketStat = created;
    await fs.chmod(socketPath, 0o600);
    await assertRoot();
    ready = true;
    return { close };
  } catch (error) {
    await close();
    throw error;
  }
}
