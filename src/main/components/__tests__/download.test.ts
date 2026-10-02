/** @jest-environment node */
/* eslint import/extensions: ["error", "ignorePackages", { "ts": "never" }] */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  artifactURL,
  selectRelease,
  downloadArtifact,
  discoverRelease,
  ResponseStream,
  Transport,
} from '../dolphin/download';
import {
  installDolphin,
  validateMount,
  verifyBundle,
  ProcessRunner,
} from '../dolphin/install';

const url =
  'https://dl.dolphin-emu.org/releases/2609/dolphin-2609-universal.dmg';
const metadata = {
  shortrev: '2609',
  hash: 'a'.repeat(40),
  artifacts: [{ system: 'macOS (ARM/Intel Universal)', url }],
};
const bundleMetadata = {
  CFBundleIdentifier: 'org.dolphin-emu.dolphin',
  CFBundleExecutable: 'Dolphin',
  CFBundleShortVersionString: metadata.shortrev,
  CFBundleLongVersionString: metadata.hash,
  CFBundleVersion: '2609.0',
  LSMinimumSystemVersion: '11.0.0',
};
function response(
  body: string,
  statusCode = 200,
  headers = {},
): ResponseStream {
  return {
    statusCode,
    headers,
    destroy: jest.fn(),
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(body);
    },
  };
}
test('selects the exact official native release and keeps revision separate', () => {
  expect(selectRelease(metadata)).toEqual({
    version: '2609',
    revision: 'a'.repeat(40),
    artifactURL: url,
  });
});
test.each([
  url.replace('https:', 'http:'),
  url.replace('dl.dolphin-emu.org', 'dl.dolphin-emu.org.evil.test'),
  url.replace('/2609/', '/2606/'),
  `${url}?x=1`,
  `${url}#x`,
  url.replace('https://', 'https://user@'),
  url.replace('universal', 'x64'),
  url.replace('/releases/', '/releases/../releases/'),
])('rejects artifact URL %s', (value) => {
  expect(() => artifactURL(value)).toThrow();
});
test('rejects duplicated or mismatched artifacts', () => {
  expect(() =>
    selectRelease({
      ...metadata,
      artifacts: [...metadata.artifacts, ...metadata.artifacts],
    }),
  ).toThrow();
  expect(() => selectRelease({ ...metadata, shortrev: '2606' })).toThrow();
});
test('reads bounded release metadata through injected transport', async () => {
  expect(
    await discoverRelease(async () => response(JSON.stringify(metadata))),
  ).toEqual(selectRelease(metadata));
  await expect(
    discoverRelease(async () => response('x'.repeat(1024 * 1024 + 1))),
  ).rejects.toThrow('size limit');
});
test('rejects malicious redirect before requesting its destination', async () => {
  const request = jest.fn(async () =>
    response('', 302, { location: 'https://evil.test/file' }),
  );
  await expect(discoverRelease(request)).rejects.toThrow('redirect');
  expect(request).toHaveBeenCalledTimes(1);
});
test('download audit, truncation cleanup and overwrite protection', async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'dolphin-download-test-'),
  );
  const target = path.join(root, 'artifact.dmg');
  try {
    const request: Transport = async () =>
      response('hello', 200, { 'content-length': '5' });
    const result = await downloadArtifact(
      selectRelease(metadata),
      target,
      request,
    );
    expect(result).toEqual({
      bytes: 5,
      sha256:
        '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    });
    await expect(
      downloadArtifact(selectRelease(metadata), target, request),
    ).rejects.toThrow();
    expect(await fs.readFile(target, 'utf8')).toBe('hello');
    const broken = path.join(root, 'broken.dmg');
    await expect(
      downloadArtifact(selectRelease(metadata), broken, async () =>
        response('short', 200, { 'content-length': '99' }),
      ),
    ).rejects.toThrow('Truncated');
    await expect(fs.stat(broken)).rejects.toThrow();
  } finally {
    await fs.rm(root, { recursive: true });
  }
});
test('mount metadata cannot redirect installation outside private mount', () => {
  expect(() =>
    validateMount(
      JSON.stringify({ 'system-entities': [{ 'mount-point': '/tmp/owned' }] }),
      '/tmp/owned',
    ),
  ).not.toThrow();
  expect(() =>
    validateMount(
      JSON.stringify({
        'system-entities': [{ 'mount-point': '/Volumes/Other' }],
      }),
      '/tmp/owned',
    ),
  ).toThrow();
});
test('bundle verification checks host OS, native architecture, publisher and Gatekeeper', async () => {
  const commands: string[] = [];
  const run: ProcessRunner = async (binary) => {
    commands.push(binary);
    if (binary.endsWith('plutil')) return JSON.stringify(bundleMetadata);
    if (binary.endsWith('sw_vers')) return '27.0\n';
    if (binary.endsWith('lipo')) return 'x86_64 arm64';
    return '';
  };
  await verifyBundle('/tmp/Dolphin.app', run, selectRelease(metadata));
  expect(commands).toEqual([
    '/usr/bin/plutil',
    '/usr/bin/sw_vers',
    '/usr/bin/lipo',
    '/usr/bin/codesign',
    '/usr/bin/codesign',
    '/usr/sbin/spctl',
  ]);
  await expect(
    verifyBundle('/tmp/Dolphin.app', async (binary, args) => {
      if (binary.endsWith('spctl')) throw new Error('Gatekeeper rejected');
      return run(binary, args);
    }),
  ).rejects.toThrow('Gatekeeper');
  await expect(
    verifyBundle('/tmp/Dolphin.app', async () => '{}'),
  ).rejects.toThrow('identity');
});

function bundleRunner(
  overrides: Record<string, unknown> = {},
  architecture = 'x86_64 arm64',
  systemVersion = '27.0\n',
): ProcessRunner {
  return async (binary) => {
    if (binary.endsWith('plutil'))
      return JSON.stringify({ ...bundleMetadata, ...overrides });
    if (binary.endsWith('sw_vers')) return systemVersion;
    if (binary.endsWith('lipo')) return architecture;
    return '';
  };
}

test.each([
  [{ CFBundleShortVersionString: '2608' }, 'version'],
  [{ CFBundleShortVersionString: undefined }, 'version'],
  [{ CFBundleLongVersionString: 'b'.repeat(40) }, 'revision'],
  [{ CFBundleLongVersionString: undefined }, 'revision'],
])(
  'rejects a trusted publisher bundle with mismatched release metadata %j',
  async (overrides, message) => {
    await expect(
      verifyBundle(
        '/tmp/Dolphin.app',
        bundleRunner(overrides),
        selectRelease(metadata),
      ),
    ).rejects.toThrow(message);
  },
);

test('an installed version can be checked without requiring a source revision', async () => {
  await expect(
    verifyBundle(
      '/tmp/Dolphin.app',
      bundleRunner({ CFBundleLongVersionString: undefined }),
      { version: '2609' },
    ),
  ).resolves.toBeUndefined();
});

test('rejects a signed Intel-only bundle', async () => {
  await expect(
    verifyBundle('/tmp/Dolphin.app', bundleRunner({}, 'x86_64'), {
      version: '2609',
    }),
  ).rejects.toThrow('Apple Silicon');
});

test.each([
  ['11.0', '11.0.0\n'],
  ['11.0.0', '11.0\n'],
  ['11.0.1', '12.0\n'],
  ['26.9.9', '27.0\n'],
])('accepts required macOS %s on host %s', async (minimum, current) => {
  await expect(
    verifyBundle(
      '/tmp/Dolphin.app',
      bundleRunner({ LSMinimumSystemVersion: minimum }, 'arm64', current),
    ),
  ).resolves.toBeUndefined();
});

test.each([
  ['11.0.1', '11.0\n'],
  ['27.1', '27.0.9\n'],
  ['28.0', '27.9\n'],
])('rejects required macOS %s on older host %s', async (minimum, current) => {
  await expect(
    verifyBundle(
      '/tmp/Dolphin.app',
      bundleRunner({ LSMinimumSystemVersion: minimum }, 'arm64', current),
    ),
  ).rejects.toThrow(`requires macOS ${minimum}`);
});

test.each([
  undefined,
  11,
  '',
  '11',
  '11.0-beta',
  '11.0.0.1',
  '11.0\n',
  '999999999999999999.0',
])('rejects malformed bundle minimum OS %j', async (minimum) => {
  await expect(
    verifyBundle(
      '/tmp/Dolphin.app',
      bundleRunner({ LSMinimumSystemVersion: minimum }),
    ),
  ).rejects.toThrow('Cannot verify');
});

test.each(['unknown', '27.0 beta\n', '2'.repeat(65)])(
  'fails closed on unsupported host version output %j',
  async (current) => {
    await expect(
      verifyBundle('/tmp/Dolphin.app', bundleRunner({}, 'arm64', current)),
    ).rejects.toThrow('Cannot verify');
  },
);

/* eslint-disable jest/no-conditional-expect -- Parameterized transaction exercises success and failure assertions separately. */
describe('transactional installation with injected tools', () => {
  test.each([false, true])(
    'preserves existing files and cleans failure (reject=%s)',
    async (rejectVerification) => {
      if (process.platform !== 'darwin') return;
      const root = await fs.realpath(
        await fs.mkdtemp(path.join(os.tmpdir(), 'dolphin-install-test-')),
      );
      let mountPoint = '';
      let detached = false;
      let mounted = false;
      const run: ProcessRunner = async (binary, args, input) => {
        if (binary.endsWith('hdiutil')) {
          if (args[0] === 'info') return '<inventory fixture/>';
          if (args[0] === 'detach') {
            detached = true;
            mounted = false;
            return '';
          }
          mountPoint = args[args.indexOf('-mountpoint') + 1];
          mounted = true;
          await fs.mkdir(path.join(mountPoint, 'Dolphin.app'));
          await fs.writeFile(
            path.join(mountPoint, 'Dolphin.app', 'data'),
            'fixture',
          );
          return '<plist fixture/>';
        }
        if (binary.endsWith('plutil')) {
          if (input === '<inventory fixture/>')
            return JSON.stringify({
              images: mounted
                ? [
                    {
                      'image-path': path.join(
                        path.dirname(mountPoint),
                        'download.dmg',
                      ),
                      'system-entities': [{ 'mount-point': mountPoint }],
                    },
                  ]
                : [],
            });
          if (input)
            return JSON.stringify({
              'system-entities': [{ 'mount-point': mountPoint }],
            });
          return JSON.stringify(bundleMetadata);
        }
        if (binary.endsWith('sw_vers')) return '27.0\n';
        if (binary.endsWith('lipo')) return 'x86_64 arm64';
        if (binary.endsWith('codesign')) {
          if (args.includes('--deep')) {
            expect(args).not.toContain('-R');
            expect(args).toContain('--strict');
          } else {
            expect(args).toContain('-R');
            expect(args[args.indexOf('-R') + 1]).toBe(
              '=anchor apple generic and identifier "org.dolphin-emu.dolphin" and certificate leaf[subject.OU] = "97835T4369"',
            );
          }
        }
        if (binary.endsWith('spctl') && rejectVerification)
          throw new Error('Not trusted');
        if (binary.endsWith('ditto'))
          await fs.cp(args[0], args[1], {
            recursive: true,
            errorOnExist: true,
            force: false,
          });
        return '';
      };
      const download = async () => ({ sha256: 'b'.repeat(64), bytes: 7 });
      try {
        await fs.writeFile(path.join(root, 'unrelated'), 'keep');
        if (rejectVerification) {
          await expect(
            installDolphin(selectRelease(metadata), root, run, download),
          ).rejects.toThrow('Not trusted');
          await expect(fs.stat(path.join(root, '2609'))).rejects.toThrow();
        } else {
          const receipt = await installDolphin(
            selectRelease(metadata),
            root,
            run,
            download,
          );
          expect(
            await fs.readFile(path.join(receipt.bundlePath, 'data'), 'utf8'),
          ).toBe('fixture');
          await expect(
            installDolphin(selectRelease(metadata), root, run, download),
          ).rejects.toThrow();
          expect(
            await fs.readFile(path.join(receipt.bundlePath, 'data'), 'utf8'),
          ).toBe('fixture');
        }
        expect(detached).toBe(true);
        expect(await fs.readFile(path.join(root, 'unrelated'), 'utf8')).toBe(
          'keep',
        );
        expect(
          (await fs.readdir(root)).some((name) =>
            name.startsWith('.dolphin-stage-'),
          ),
        ).toBe(false);
      } finally {
        await fs.rm(root, { recursive: true });
      }
    },
  );
});
