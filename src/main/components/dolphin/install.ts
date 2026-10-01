/* eslint import/extensions: ["error", "ignorePackages", { "ts": "never" }] */
import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { absolutePath } from '../schema';
import { DolphinRelease, artifactURL, downloadArtifact } from './download';

/* eslint-disable no-unused-vars -- Names describe dependency injection contracts. */
export type ProcessRunner = (
  executable: string,
  args: readonly string[],
  input?: string,
) => Promise<string>;
/* eslint-enable no-unused-vars */
export const runProcess: ProcessRunner = (executable, args, input) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      executable,
      [...args],
      { timeout: 120000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error)
          reject(
            new Error(
              `Verification command failed: ${path.basename(executable)}`,
            ),
          );
        else resolve(stdout);
      },
    );
    if (input !== undefined) child.stdin?.end(input);
  });

/** Never execute the app to inspect its bundle metadata. */
export async function verifyBundle(
  bundle: string,
  run: ProcessRunner = runProcess,
): Promise<void> {
  const info = JSON.parse(
    await run('/usr/bin/plutil', [
      '-convert',
      'json',
      '-o',
      '-',
      path.join(bundle, 'Contents', 'Info.plist'),
    ]),
  );
  if (
    info.CFBundleIdentifier !== 'org.dolphin-emu.dolphin' ||
    info.CFBundleExecutable !== 'Dolphin'
  )
    throw new Error('Unexpected Dolphin bundle identity');
  const architectures = (
    await run('/usr/bin/lipo', [
      '-archs',
      path.join(bundle, 'Contents', 'MacOS', 'Dolphin'),
    ])
  )
    .trim()
    .split(/\s+/);
  if (!architectures.includes('arm64'))
    throw new Error('Dolphin has no native Apple Silicon executable');
  // Nested frameworks have their own identifiers; validate every seal first.
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
  // The leading '=' selects inline requirement syntax instead of a filename.
  await run('/usr/bin/codesign', [
    '--verify',
    '--strict',
    '-R',
    '=anchor apple generic and identifier "org.dolphin-emu.dolphin" and certificate leaf[subject.OU] = "97835T4369"',
    bundle,
  ]);
  await run('/usr/sbin/spctl', [
    '--assess',
    '--type',
    'execute',
    '--verbose=2',
    bundle,
  ]);
}

export function validateMount(plistJSON: string, mountPoint: string): void {
  const data = JSON.parse(plistJSON);
  if (!data || !Array.isArray(data['system-entities']))
    throw new Error('Invalid mounted image response');
  const mounts = data['system-entities'].filter(
    (entry: Record<string, unknown>) => entry && entry['mount-point'],
  );
  if (mounts.length !== 1 || mounts[0]['mount-point'] !== mountPoint)
    throw new Error('Image mounted outside its owned location');
}

async function checkBundleLinks(bundle: string): Promise<void> {
  const realBundle = await fs.realpath(bundle);
  if (realBundle !== bundle) throw new Error('Bundle root cannot be a symlink');
  let entries = 0;
  async function walk(directory: string): Promise<void> {
    const children = await fs.readdir(directory, { withFileTypes: true });
    // eslint-disable-next-line no-restricted-syntax -- Sequential bounded filesystem traversal.
    for (const child of children) {
      entries += 1;
      if (entries > 50000) throw new Error('Bundle contains too many files');
      const file = path.join(directory, child.name);
      if (child.isSymbolicLink()) {
        // eslint-disable-next-line no-await-in-loop -- Validate each link before copying any bundle.
        const resolved = await fs.realpath(file);
        if (!resolved.startsWith(`${bundle}/`))
          throw new Error('Bundle symlink escapes application');
      } else if (child.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop -- Bounded traversal avoids unbounded work queues.
        await walk(file);
      } else if (!child.isFile())
        throw new Error('Unsupported bundle file type');
    }
  }
  await walk(bundle);
}

export interface InstallReceipt {
  version: string;
  revision: string;
  artifactURL: string;
  sha256: string;
  bytes: number;
  bundlePath: string;
  verification: 'codesign-and-gatekeeper';
}

/** The caller supplies an existing private machine-local directory, never a library root. */
export async function installDolphin(
  release: DolphinRelease,
  installRoot: string,
  run: ProcessRunner = runProcess,
  download: typeof downloadArtifact = downloadArtifact,
): Promise<InstallReceipt> {
  if (process.platform !== 'darwin')
    throw new Error('Installation requires macOS');
  if (!/^\d{4}[a-z]?$/.test(release.version))
    throw new Error('Invalid release version');
  artifactURL(release.artifactURL, release.version);
  if (!/^[a-f0-9]{40}$/.test(release.revision))
    throw new Error('Invalid source revision');
  const root = absolutePath(installRoot);
  const stat = await fs.lstat(root);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    // eslint-disable-next-line no-bitwise -- POSIX permission mask.
    (stat.mode & 0o022) !== 0 ||
    (await fs.realpath(root)) !== root
  )
    throw new Error('Install root must be an owned private real directory');
  const destination = path.join(root, release.version);
  // Exclusive reservation: an existing installation or unknown directory is never replaced.
  await fs.mkdir(destination, { mode: 0o700 });
  let staged: string | undefined;
  let mounted = false;
  let installed = false;
  try {
    staged = await fs.mkdtemp(path.join(root, '.dolphin-stage-'));
    const dmg = path.join(staged, 'download.dmg');
    const audit = await download(release, dmg);
    const mountPoint = path.join(staged, 'mount');
    await fs.mkdir(mountPoint, { mode: 0o700 });
    // A failed attach can still leave a mount; require detach before removing staging.
    mounted = true;
    const plist = await run('/usr/bin/hdiutil', [
      'attach',
      '-readonly',
      '-nobrowse',
      '-noautoopen',
      '-mountpoint',
      mountPoint,
      '-plist',
      dmg,
    ]);
    validateMount(
      await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], plist),
      mountPoint,
    );
    const source = path.join(mountPoint, 'Dolphin.app');
    await checkBundleLinks(source);
    await verifyBundle(source, run);
    const bundlePath = path.join(destination, 'Dolphin.app');
    await run('/usr/bin/ditto', [source, bundlePath]);
    await checkBundleLinks(bundlePath);
    await verifyBundle(bundlePath, run);
    const receipt: InstallReceipt = {
      ...release,
      ...audit,
      bundlePath,
      verification: 'codesign-and-gatekeeper',
    };
    await fs.writeFile(
      path.join(destination, 'receipt.json'),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    installed = true;
    return receipt;
  } finally {
    // Never recurse into a possibly mounted image when detachment fails.
    if (mounted && staged) {
      await run('/usr/bin/hdiutil', ['detach', path.join(staged, 'mount')]);
      mounted = false;
    }
    if (staged && !mounted) await fs.rm(staged, { recursive: true });
    if (!installed) await fs.rm(destination, { recursive: true });
  }
}
