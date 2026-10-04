/** @jest-environment node */
import { createHash } from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { downloadPinned } from '../dolphin/download';
import type { ResponseStream, Transport } from '../dolphin/download';

const body = 'reviewed release bytes';
const artifact = {
  url: 'https://gitlab.com/es-de/emulationstation-de/-/package_files/1/download',
  bytes: Buffer.byteLength(body),
  sha256: createHash('sha256').update(body).digest('hex'),
};
function response(
  text: string,
  statusCode = 200,
  headers = {},
): ResponseStream {
  return {
    statusCode,
    headers,
    destroy: jest.fn(),
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(text);
    },
  };
}

describe('downloadPinned', () => {
  let directory: string;
  let destination: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pinned-'));
    destination = path.join(directory, 'download.dmg');
  });
  afterEach(() => fs.rm(directory, { recursive: true, force: true }));

  it('accepts exactly the reviewed bytes from exactly the reviewed URL', async () => {
    const request: Transport = jest.fn(async () => response(body));
    await expect(
      downloadPinned(artifact, destination, request),
    ).resolves.toEqual({
      bytes: artifact.bytes,
      sha256: artifact.sha256,
    });
    expect(request).toHaveBeenCalledWith(artifact.url, expect.anything());
    expect(await fs.readFile(destination, 'utf8')).toBe(body);
  });

  it.each([
    ['different content of the same length', body.replace('r', 'R')],
    ['shorter content', body.slice(1)],
  ])('removes the file on %s', async (_label, text) => {
    await expect(
      downloadPinned(artifact, destination, async () => response(text)),
    ).rejects.toThrow();
    await expect(fs.lstat(destination)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('refuses content longer than the pinned size', async () => {
    await expect(
      downloadPinned(artifact, destination, async () => response(`${body}x`)),
    ).rejects.toThrow('size limit');
  });

  it('follows no redirect, even to the same host', async () => {
    await expect(
      downloadPinned(artifact, destination, async () =>
        response('', 302, { location: `${artifact.url}?mirror=1` }),
      ),
    ).rejects.toThrow('redirect');
  });

  it.each([
    { ...artifact, url: 'http://gitlab.com/x' },
    { ...artifact, url: 'https://user:pw@gitlab.com/x' },
    { ...artifact, sha256: 'abc' },
    { ...artifact, bytes: 0 },
  ])('rejects an invalid pin %#', async (pin) => {
    const request: Transport = jest.fn(async () => response(body));
    await expect(downloadPinned(pin, destination, request)).rejects.toThrow(
      'Invalid pinned artifact',
    );
    expect(request).not.toHaveBeenCalled();
  });
});
