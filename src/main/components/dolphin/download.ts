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

/* eslint-disable no-unused-vars -- Names document the URL trust policy. */
interface RequestPolicy {
  /** Every requested URL, including the first, must pass. */
  trusted: (url: string) => boolean;
  /** A redirect target must also pass this identity check. */
  redirect: (next: string) => boolean;
  timeout: number;
}
/* eslint-enable no-unused-vars */

const releasePolicy: RequestPolicy = {
  trusted: (url) => url === RELEASE_API,
  redirect: (next) => next === RELEASE_API,
  timeout: 120000,
};

function artifactPolicy(url: string): RequestPolicy {
  return {
    trusted: (current) => Boolean(artifactURL(current)),
    redirect: (next) => next === url,
    // Official DMGs can take several minutes on a slow connection.
    timeout: 600000,
  };
}

async function consume(
  url: string,
  limit: number,
  receive: (chunk: Buffer) => Promise<void>,
  request: Transport,
  policy: RequestPolicy,
): Promise<number> {
  const controller = new AbortController();
  // Keep an absolute deadline and byte limit for every transfer.
  const timer = setTimeout(() => controller.abort(), policy.timeout);
  let response: ResponseStream | undefined;
  let current = url;
  try {
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      if (!policy.trusted(current)) throw new Error('Untrusted request URL');
      // eslint-disable-next-line no-await-in-loop -- Redirects depend on the previous response.
      response = await request(current, controller.signal);
      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
        const { location } = response.headers;
        response.destroy();
        if (!location || redirects === 3)
          throw new Error('Invalid or excessive redirects');
        const next = new URL(location, current).href;
        if (!policy.redirect(next))
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
    releasePolicy,
  );
  return selectRelease(
    JSON.parse(
      Buffer.concat(chunks.map((chunk) => Uint8Array.from(chunk))).toString(
        'utf8',
      ),
    ),
  );
}

async function writeDownload(
  url: string,
  limit: number,
  destination: string,
  request: Transport,
  policy: RequestPolicy,
): Promise<{ sha256: string; bytes: number }> {
  const handle = await fs.open(destination, 'wx', 0o600);
  const hash = createHash('sha256');
  let complete = false;
  try {
    const bytes = await consume(
      url,
      limit,
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
      policy,
    );
    await handle.sync();
    complete = true;
    return { bytes, sha256: hash.digest('hex') };
  } finally {
    await handle.close();
    if (!complete) await fs.unlink(destination);
  }
}

/** SHA-256 is an audit fingerprint, not publisher authentication. Never overwrite files. */
export async function downloadArtifact(
  release: DolphinRelease,
  destination: string,
  request: Transport = transport,
): Promise<{ sha256: string; bytes: number }> {
  artifactURL(release.artifactURL, release.version);
  return writeDownload(
    release.artifactURL,
    512 * 1024 * 1024,
    destination,
    request,
    artifactPolicy(release.artifactURL),
  );
}

export interface PinnedArtifact {
  url: string;
  bytes: number;
  sha256: string;
}

/**
 * A reviewed, pinned artifact: exact HTTPS URL with no redirects, exact length
 * and exact SHA-256. A mismatch removes the file. Publisher signature and
 * Gatekeeper checks still follow; the hash only pins the reviewed bytes.
 */
export async function downloadPinned(
  artifact: PinnedArtifact,
  destination: string,
  request: Transport = transport,
): Promise<{ sha256: string; bytes: number }> {
  const url = new URL(artifact.url);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.href !== artifact.url ||
    !Number.isSafeInteger(artifact.bytes) ||
    artifact.bytes <= 0 ||
    !/^[a-f0-9]{64}$/.test(artifact.sha256)
  )
    throw new Error('Invalid pinned artifact');
  const result = await writeDownload(
    artifact.url,
    artifact.bytes,
    destination,
    request,
    {
      trusted: (current) => current === artifact.url,
      redirect: () => false,
      timeout: 600000,
    },
  );
  if (result.bytes !== artifact.bytes || result.sha256 !== artifact.sha256) {
    await fs.unlink(destination);
    throw new Error('Downloaded file does not match the reviewed release');
  }
  return result;
}
