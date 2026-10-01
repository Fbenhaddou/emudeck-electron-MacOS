/* eslint import/extensions: ["error", "ignorePackages", { "ts": "never" }] */
import https from 'https';
import { createHash } from 'crypto';
import fs from 'fs/promises';

export const RELEASE_API = 'https://dolphin-emu.org/update/latest/beta/';
export interface DolphinRelease {
  version: string;
  revision: string;
  artifactURL: string;
}

export function artifactURL(raw: string, version?: string): URL {
  const url = new URL(raw);
  const match = /^\/releases\/(\d{4}[a-z]?)\/dolphin-\1-universal\.dmg$/.exec(
    url.pathname,
  );
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'dl.dolphin-emu.org' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !match ||
    (version && match[1] !== version) ||
    url.href !== raw
  )
    throw new Error('Untrusted Dolphin artifact URL');
  return url;
}

export function selectRelease(input: unknown): DolphinRelease {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid release metadata');
  const data = input as Record<string, unknown>;
  if (
    typeof data.shortrev !== 'string' ||
    !/^\d{4}[a-z]?$/.test(data.shortrev) ||
    typeof data.hash !== 'string' ||
    !/^[a-f0-9]{40}$/.test(data.hash) ||
    !Array.isArray(data.artifacts) ||
    data.artifacts.length > 32
  )
    throw new Error('Invalid release metadata');
  const matches = data.artifacts.filter(
    (entry) =>
      entry &&
      typeof entry === 'object' &&
      entry.system === 'macOS (ARM/Intel Universal)',
  );
  if (matches.length !== 1 || typeof matches[0].url !== 'string')
    throw new Error('Expected one Universal macOS artifact');
  const url = artifactURL(matches[0].url, data.shortrev);
  return Object.freeze({
    version: data.shortrev,
    revision: data.hash,
    artifactURL: url.href,
  });
}

export interface ResponseStream extends AsyncIterable<Buffer> {
  statusCode?: number;
  headers: { location?: string; 'content-length'?: string };
  destroy: () => void;
}
/* eslint-disable no-unused-vars -- Interface parameters document injected transport. */
export type Transport = (
  url: string,
  signal: AbortSignal,
) => Promise<ResponseStream>;
/* eslint-enable no-unused-vars */

const transport: Transport = (url, signal) =>
  new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        signal,
        headers: {
          'User-Agent': 'Mac-Emulation-Development/1',
          'Accept-Encoding': 'identity',
        },
      },
      resolve,
    );
    request.on('error', reject);
  });

async function consume(
  url: string,
  limit: number,
  receive: (chunk: Buffer) => Promise<void>,
  request: Transport,
  api = false,
): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  let response: ResponseStream | undefined;
  let current = url;
  try {
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      if (api ? current !== RELEASE_API : !artifactURL(current))
        throw new Error('Untrusted request URL');
      // eslint-disable-next-line no-await-in-loop -- Redirects depend on the previous response.
      response = await request(current, controller.signal);
      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
        const { location } = response.headers;
        response.destroy();
        if (!location || redirects === 3)
          throw new Error('Invalid or excessive redirects');
        const next = new URL(location, current).href;
        if (api ? next !== RELEASE_API : next !== url)
          throw new Error('Artifact redirect changes trusted identity');
        current = next;
      } else break;
    }
    if (!response || response.statusCode !== 200)
      throw new Error('Download failed');
    const length = response.headers['content-length'];
    if (length && (!/^\d+$/.test(length) || Number(length) > limit))
      throw new Error('Download exceeds size limit');
    let bytes = 0;
    // eslint-disable-next-line no-restricted-syntax -- Streaming bounds memory and applies backpressure.
    for await (const chunk of response) {
      bytes += chunk.length;
      if (bytes > limit) throw new Error('Download exceeds size limit');
      // eslint-disable-next-line no-await-in-loop -- Backpressure bounds memory usage.
      await receive(chunk);
    }
    if (!bytes || (length && bytes !== Number(length)))
      throw new Error('Truncated or empty download');
    return bytes;
  } finally {
    clearTimeout(timer);
    response?.destroy();
  }
}

export async function discoverRelease(
  request: Transport = transport,
): Promise<DolphinRelease> {
  const chunks: Buffer[] = [];
  await consume(
    RELEASE_API,
    1024 * 1024,
    async (chunk) => {
      chunks.push(chunk);
    },
    request,
    true,
  );
  return selectRelease(
    JSON.parse(
      Buffer.concat(chunks.map((chunk) => Uint8Array.from(chunk))).toString(
        'utf8',
      ),
    ),
  );
}

/** SHA-256 is an audit fingerprint, not publisher authentication. Never overwrite files. */
export async function downloadArtifact(
  release: DolphinRelease,
  destination: string,
  request: Transport = transport,
): Promise<{ sha256: string; bytes: number }> {
  artifactURL(release.artifactURL, release.version);
  const handle = await fs.open(destination, 'wx', 0o600);
  const hash = createHash('sha256');
  let complete = false;
  try {
    const bytes = await consume(
      release.artifactURL,
      512 * 1024 * 1024,
      async (chunk) => {
        const bytesToWrite = Uint8Array.from(chunk);
        hash.update(bytesToWrite);
        let offset = 0;
        while (offset < chunk.length) {
          // eslint-disable-next-line no-await-in-loop -- Handle partial filesystem writes.
          const result = await handle.write(
            bytesToWrite,
            offset,
            chunk.length - offset,
          );
          if (!result.bytesWritten) throw new Error('Download write failed');
          offset += result.bytesWritten;
        }
      },
      request,
    );
    await handle.sync();
    complete = true;
    return { bytes, sha256: hash.digest('hex') };
  } finally {
    await handle.close();
    if (!complete) await fs.unlink(destination);
  }
}
