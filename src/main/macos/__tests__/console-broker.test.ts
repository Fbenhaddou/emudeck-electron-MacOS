/** @jest-environment node */
import fs from 'fs/promises';
import net from 'net';
import path from 'path';
import { createHmac } from 'crypto';
import { startConsoleBroker } from '../console-broker';

const id = 'a'.repeat(32);
const otherID = 'b'.repeat(32);
const failed = { ok: false, error: 'launch-failed' };
const waitForEvents = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
type ChildResult = { code: number | null; signal: string | null };
interface Client {
  socket: net.Socket;
  challenge: string;
  readLine(): Promise<string>;
}

describe('authenticated console launch broker over actual local sockets', () => {
  let root: string;
  let broker: Awaited<ReturnType<typeof startConsoleBroker>> | null;
  let launch: jest.Mock<Promise<ChildResult>, [string]>;
  let clients: Set<net.Socket>;
  let complete: ((result: ChildResult) => void) | undefined;

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp('/private/tmp/console-broker-'));
    await fs.chmod(root, 0o700);
    broker = null;
    clients = new Set();
    complete = undefined;
    launch = jest.fn<Promise<ChildResult>, [string]>().mockResolvedValue({
      code: 0,
      signal: null,
    });
  });
  afterEach(async () => {
    clients.forEach((socket) => socket.destroy());
    complete?.({ code: 0, signal: null });
    await waitForEvents();
    try {
      await broker?.close();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  async function start(ids = new Set([id])) {
    broker = await startConsoleBroker(root, ids, launch);
    return broker;
  }
  async function openClient(): Promise<Client> {
    const socket = net.createConnection({
      path: path.join(root, 's'),
      allowHalfOpen: true,
    });
    clients.add(socket);
    let buffer = '';
    const lines: string[] = [];
    const readers: Array<{
      resolve: (line: string) => void;
      reject: (error: Error) => void;
    }> = [];
    socket.on('error', () => socket.destroy());
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const reader = readers.shift();
        if (reader) reader.resolve(line);
        else lines.push(line);
        newline = buffer.indexOf('\n');
      }
    });
    socket.once('close', () => {
      clients.delete(socket);
      readers.splice(0).forEach((reader) => reader.reject(new Error('Closed')));
    });
    const readLine = () => {
      const line = lines.shift();
      if (line !== undefined) return Promise.resolve(line);
      if (socket.destroyed) return Promise.reject(new Error('Closed'));
      return new Promise<string>((resolve, reject) => {
        readers.push({ resolve, reject });
      });
    };
    const challenge = JSON.parse(await readLine());
    expect(Object.keys(challenge).sort()).toEqual(['challenge', 'schema']);
    expect(challenge.schema).toBe(1);
    expect(challenge.challenge).toMatch(/^[a-f0-9]{64}$/);
    return { socket, challenge: challenge.challenge, readLine };
  }
  async function signed(client: Client, requestedID = id) {
    const key = Buffer.from(
      await fs.readFile(path.join(root, 'key'), 'utf8'),
      'hex',
    );
    return {
      schema: 1,
      id: requestedID,
      proof: createHmac('sha256', Uint8Array.from(key))
        .update(`${client.challenge}\n${requestedID}`)
        .digest('hex'),
    };
  }
  async function request(client: Client, frame: string): Promise<unknown> {
    client.socket.end(frame);
    return JSON.parse(await client.readLine());
  }

  it('creates private key/socket and returns the exact child exit result', async () => {
    await start();
    const key = await fs.readFile(path.join(root, 'key'), 'utf8');
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect((await fs.stat(path.join(root, 'key'))).mode.toString(8)).toMatch(
      /600$/,
    );
    expect((await fs.stat(path.join(root, 's'))).mode.toString(8)).toMatch(
      /600$/,
    );
    const client = await openClient();
    launch.mockResolvedValueOnce({ code: null, signal: 'SIGTERM' });
    expect(
      await request(client, `${JSON.stringify(await signed(client))}\n`),
    ).toEqual({
      ok: true,
      code: null,
      signal: 'SIGTERM',
    });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledWith(id);
    await broker!.close();
    expect(await fs.readdir(root)).toEqual([]);
    await expect(broker!.close()).resolves.toBeUndefined();
  });

  it('rejects a wrong proof and does not expose callback errors or invoke launch', async () => {
    await start();
    const client = await openClient();
    const payload = { ...(await signed(client)), proof: '0'.repeat(64) };
    expect(await request(client, `${JSON.stringify(payload)}\n`)).toEqual(
      failed,
    );
    expect(launch).not.toHaveBeenCalled();
  });

  it('uses a fresh challenge per connection and rejects replaying an earlier proof', async () => {
    await start();
    const first = await openClient();
    const payload = await signed(first);
    first.socket.destroy();
    await waitForEvents();
    const second = await openClient();
    expect(second.challenge).not.toBe(first.challenge);
    expect(await request(second, `${JSON.stringify(payload)}\n`)).toEqual(
      failed,
    );
    expect(launch).not.toHaveBeenCalled();
  });

  it.each([
    { path: '/private/game.iso' },
    { command: '/bin/sh' },
    { args: ['--exec', 'game.iso'] },
    { schema: 2 },
    { id: '../game.iso' },
    { id: 'A'.repeat(32) },
    { proof: '0'.repeat(63) },
  ])('rejects malformed or extra request authority: %j', async (changes) => {
    await start();
    const client = await openClient();
    const payload = { ...(await signed(client)), ...changes };
    expect(await request(client, `${JSON.stringify(payload)}\n`)).toEqual(
      failed,
    );
    expect(launch).not.toHaveBeenCalled();
  });

  it('rejects unknown IDs even with a valid session HMAC', async () => {
    await start();
    const client = await openClient();
    expect(
      await request(
        client,
        `${JSON.stringify(await signed(client, otherID))}\n`,
      ),
    ).toEqual(failed);
    expect(launch).not.toHaveBeenCalled();
  });

  it('snapshots allowed IDs rather than adopting later set mutations', async () => {
    const ids = new Set([id]);
    await start(ids);
    ids.delete(id);
    ids.add(otherID);
    const first = await openClient();
    expect(
      await request(first, `${JSON.stringify(await signed(first))}\n`),
    ).toEqual({
      ok: true,
      code: 0,
      signal: null,
    });
    const second = await openClient();
    expect(
      await request(
        second,
        `${JSON.stringify(await signed(second, otherID))}\n`,
      ),
    ).toEqual(failed);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it.each(['oversized', 'trailing', 'missing-newline', 'duplicate-key'])(
    'rejects invalid frame boundaries: %s',
    async (kind) => {
      await start();
      const client = await openClient();
      const frame = JSON.stringify(await signed(client));
      const invalid = {
        oversized: `${' '.repeat(4096)}${frame}\n`,
        trailing: `${frame}\n${frame}\n`,
        'missing-newline': frame,
        'duplicate-key': frame.replace('"schema":1', '"schema":1,"schema":1'),
      }[kind];
      expect(await request(client, invalid!)).toEqual(failed);
      expect(launch).not.toHaveBeenCalled();
    },
  );

  it('waits for write-side EOF so fragmented trailing bytes never start a game', async () => {
    await start();
    const client = await openClient();
    client.socket.write(`${JSON.stringify(await signed(client))}\n`);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
    expect(launch).not.toHaveBeenCalled();
    expect(await request(client, 'trailing bytes')).toEqual(failed);
    expect(launch).not.toHaveBeenCalled();
  });

  it('keeps the pipe and shared launch lock until the exact child completes', async () => {
    let launched!: () => void;
    const started = new Promise<void>((resolve) => {
      launched = resolve;
    });
    launch.mockImplementationOnce(
      () =>
        new Promise<ChildResult>((resolve) => {
          complete = resolve;
          launched();
        }),
    );
    await start();
    const first = await openClient();
    first.socket.end(`${JSON.stringify(await signed(first))}\n`);
    await started;
    let answered = false;
    const reply = first.readLine().then((line) => {
      answered = true;
      return JSON.parse(line);
    });
    await expect(broker!.close()).rejects.toThrow('still active');
    const second = await openClient();
    expect(
      await request(second, `${JSON.stringify(await signed(second))}\n`),
    ).toEqual(failed);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(answered).toBe(false);
    complete!({ code: 7, signal: null });
    expect(await reply).toEqual({ ok: true, code: 7, signal: null });
  });

  it('retains the child lock after client disconnect and accepts a new game only after completion', async () => {
    let launched!: () => void;
    const started = new Promise<void>((resolve) => {
      launched = resolve;
    });
    launch.mockImplementationOnce(
      () =>
        new Promise<ChildResult>((resolve) => {
          complete = resolve;
          launched();
        }),
    );
    await start();
    const first = await openClient();
    first.socket.end(`${JSON.stringify(await signed(first))}\n`);
    await started;
    first.socket.destroy();
    await waitForEvents();
    await expect(broker!.close()).rejects.toThrow('still active');
    const second = await openClient();
    expect(
      await request(second, `${JSON.stringify(await signed(second))}\n`),
    ).toEqual(failed);
    expect(launch).toHaveBeenCalledTimes(1);
    complete!({ code: 0, signal: null });
    await waitForEvents();
    const third = await openClient();
    expect(
      await request(third, `${JSON.stringify(await signed(third))}\n`),
    ).toEqual({
      ok: true,
      code: 0,
      signal: null,
    });
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it('reports callback failures generically and releases the lock', async () => {
    launch.mockRejectedValueOnce(new Error('/Users/private/game.iso secret'));
    await start();
    const first = await openClient();
    expect(
      await request(first, `${JSON.stringify(await signed(first))}\n`),
    ).toEqual(failed);
    const second = await openClient();
    expect(
      await request(second, `${JSON.stringify(await signed(second))}\n`),
    ).toEqual({
      ok: true,
      code: 0,
      signal: null,
    });
  });

  it('caps open handshake connections and times out stalled clients without launching', async () => {
    await start();
    const first = await openClient();
    const second = await openClient();
    const extra = net.createConnection(path.join(root, 's'));
    clients.add(extra);
    let received = '';
    extra.on('error', () => undefined);
    extra.on('data', (chunk: Buffer) => {
      received += chunk.toString();
    });
    await new Promise<void>((resolve) => {
      extra.once('close', resolve);
    });
    expect(received).toBe('');
    expect(JSON.parse(await first.readLine())).toEqual(failed);
    expect(JSON.parse(await second.readLine())).toEqual(failed);
    expect(launch).not.toHaveBeenCalled();
    const replacement = await openClient();
    expect(
      await request(
        replacement,
        `${JSON.stringify(await signed(replacement))}\n`,
      ),
    ).toEqual({
      ok: true,
      code: 0,
      signal: null,
    });
  }, 10000);

  it('refuses close when the socket is replaced and preserves unrelated bytes', async () => {
    await start();
    const socketPath = path.join(root, 's');
    const held = path.join(root, 'original-socket');
    await fs.rename(socketPath, held);
    await fs.writeFile(socketPath, 'precious unrelated file');
    try {
      await expect(broker!.close()).rejects.toThrow('ownership changed');
      expect(await fs.readFile(socketPath, 'utf8')).toBe(
        'precious unrelated file',
      );
      expect(await fs.readFile(path.join(root, 'key'), 'utf8')).toMatch(
        /^[a-f0-9]{64}$/,
      );
    } finally {
      // Both replacement and original belong to this fixture; restore for safe close.
      await fs.unlink(socketPath);
      await fs.rename(held, socketPath);
    }
    await expect(broker!.close()).resolves.toBeUndefined();
  });

  it('preserves a replaced key while closing its unchanged owned socket', async () => {
    await start();
    const keyPath = path.join(root, 'key');
    await fs.rename(keyPath, path.join(root, 'original-key'));
    await fs.writeFile(keyPath, 'unrelated private preference');
    await broker!.close();
    expect(await fs.readFile(keyPath, 'utf8')).toBe(
      'unrelated private preference',
    );
    await expect(fs.stat(path.join(root, 's'))).rejects.toThrow();
  });

  it('refuses close through a replaced session directory', async () => {
    await start();
    const original = `${root}-original`;
    await fs.rename(root, original);
    await fs.mkdir(root, { mode: 0o700 });
    await fs.writeFile(path.join(root, 's'), 'replacement directory bytes');
    try {
      await expect(broker!.close()).rejects.toThrow('ownership changed');
      expect(await fs.readFile(path.join(root, 's'), 'utf8')).toBe(
        'replacement directory bytes',
      );
    } finally {
      await fs.rm(root, { recursive: true });
      await fs.rename(original, root);
    }
    await broker!.close();
  });

  it('refuses existing key/socket files without replacing them', async () => {
    const key = path.join(root, 'key');
    await fs.writeFile(key, 'preexisting key data');
    await expect(start()).rejects.toThrow();
    expect(await fs.readFile(key, 'utf8')).toBe('preexisting key data');
    await fs.unlink(key);
    const socket = path.join(root, 's');
    await fs.writeFile(socket, 'preexisting socket data');
    await expect(start()).rejects.toThrow('occupied');
    expect(await fs.readFile(socket, 'utf8')).toBe('preexisting socket data');
    await expect(fs.stat(key)).rejects.toThrow();
  });

  it('cleans its own partial key after a failed creation so a later start can retry', async () => {
    const open = fs.open.bind(fs);
    let writeSpy: jest.SpyInstance | undefined;
    const openSpy = jest
      .spyOn(fs, 'open')
      .mockImplementation(async (...args) => {
        const handle = await open(...args);
        const write = handle.writeFile.bind(handle);
        writeSpy = jest
          .spyOn(handle, 'writeFile')
          .mockImplementationOnce(async () => {
            await write('partial key');
            throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
          });
        return handle;
      });
    try {
      await expect(start()).rejects.toThrow('disk full');
    } finally {
      openSpy.mockRestore();
      writeSpy?.mockRestore();
    }
    expect(await fs.readdir(root)).toEqual([]);
    await start();
    const client = await openClient();
    expect(
      await request(client, `${JSON.stringify(await signed(client))}\n`),
    ).toEqual({
      ok: true,
      code: 0,
      signal: null,
    });
  });

  it('rejects nonprivate, redirected and unsupported session locations and malformed ID authority', async () => {
    await fs.chmod(root, 0o755);
    await expect(start()).rejects.toThrow('ownership');
    await fs.chmod(root, 0o700);
    const alias = `${root}-alias`;
    await fs.symlink(root, alias);
    try {
      await expect(
        startConsoleBroker(alias, new Set([id]), launch),
      ).rejects.toThrow('ownership');
    } finally {
      await fs.unlink(alias);
    }
    await expect(
      startConsoleBroker(`${root}/../bad`, new Set([id]), launch),
    ).rejects.toThrow('location');
    await expect(
      startConsoleBroker(`${root}%`, new Set([id]), launch),
    ).rejects.toThrow('location');
    await expect(
      startConsoleBroker(`${root};touch`, new Set([id]), launch),
    ).rejects.toThrow('location');
    await expect(
      startConsoleBroker(
        `/private/tmp/${'a'.repeat(100)}`,
        new Set([id]),
        launch,
      ),
    ).rejects.toThrow('location');
    await expect(start(new Set(['../game.iso']))).rejects.toThrow(
      'identifiers',
    );
    expect(await fs.readdir(root)).toEqual([]);
    expect(launch).not.toHaveBeenCalled();
  });
});
