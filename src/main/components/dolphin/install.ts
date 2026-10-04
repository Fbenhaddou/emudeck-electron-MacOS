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
  // eslint-disable-next-line default-param-last -- Keep existing injected-runner callers compatible.
  run: ProcessRunner = runProcess,
  expected?: { version: string; revision?: string },
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
    !info ||
    typeof info !== 'object' ||
    Array.isArray(info) ||
    info.CFBundleIdentifier !== 'org.dolphin-emu.dolphin' ||
    info.CFBundleExecutable !== 'Dolphin'
  )
    throw new Error('Unexpected Dolphin bundle identity');
  if (expected && info.CFBundleShortVersionString !== expected.version)
    throw new Error('Dolphin bundle version differs from the selected release');
  if (
    expected?.revision !== undefined &&
    info.CFBundleLongVersionString !== expected.revision
  )
    throw new Error(
      'Dolphin bundle revision differs from the selected release',
    );
  const numericVersion = (value: unknown): number[] => {
    if (
      typeof value !== 'string' ||
      value.length > 32 ||
      !/^\d+\.\d+(?:\.\d+)?$/.test(value)
    )
      throw new Error('Cannot verify the required macOS version');
    const parts = value.split('.').map(Number);
    if (parts.some((part) => !Number.isSafeInteger(part)))
      throw new Error('Cannot verify the required macOS version');
    return parts;
  };
  const minimum = numericVersion(info.LSMinimumSystemVersion);
  const systemVersion = await run('/usr/bin/sw_vers', ['-productVersion']);
  if (Buffer.byteLength(systemVersion) > 64)
    throw new Error('Cannot verify the current macOS version');
  const current = numericVersion(systemVersion.trim());
  const difference = [0, 1, 2].find(
    (index) => (current[index] || 0) !== (minimum[index] || 0),
  );
  if (
    difference !== undefined &&
    (current[difference] || 0) < (minimum[difference] || 0)
  )
    throw new Error(
      `Dolphin requires macOS ${info.LSMinimumSystemVersion} or later`,
    );
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
  if (Buffer.byteLength(plistJSON) > 1024 * 1024)
    throw new Error('Mounted image response is too large');
  const data = JSON.parse(plistJSON);
  if (
    !data ||
    !Array.isArray(data['system-entities']) ||
    data['system-entities'].length > 128
  )
    throw new Error('Invalid mounted image response');
  const mounts = data['system-entities'].filter(
    (entry: Record<string, unknown>) => entry && entry['mount-point'],
  );
  if (mounts.length !== 1 || mounts[0]['mount-point'] !== mountPoint)
    throw new Error('Image mounted outside its owned location');
}

export async function checkBundleLinks(bundle: string): Promise<void> {
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

const journalName = '.dolphin-install.json';
const activeRoots = new Set<string>();
interface InstallJournal {
  format: 'emulation-workspace-dolphin-install';
  schemaVersion: 1;
  release: DolphinRelease;
  stagingDirectory: string;
}

async function exists(file: string): Promise<boolean> {
  return fs.lstat(file).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );
}

async function writeJournal(directory: string, journal: InstallJournal) {
  const handle = await fs.open(path.join(directory, journalName), 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(journal)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** A marker authorizes only this exact private transaction, never an unknown directory. */
async function readJournal(
  directory: string,
  release?: DolphinRelease,
): Promise<InstallJournal | null> {
  try {
    const directoryStat = await fs.lstat(directory);
    const stat = await fs.lstat(path.join(directory, journalName));
    if (
      !directoryStat.isDirectory() ||
      directoryStat.isSymbolicLink() ||
      directoryStat.uid !== process.getuid?.() ||
      // eslint-disable-next-line no-bitwise -- Recovery requires private directories.
      (directoryStat.mode & 0o022) !== 0 ||
      (await fs.realpath(directory)) !== directory ||
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 16384
    )
      return null;
    const value = JSON.parse(
      await fs.readFile(path.join(directory, journalName), 'utf8'),
    );
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(',') !==
        'format,release,schemaVersion,stagingDirectory' ||
      value.format !== 'emulation-workspace-dolphin-install' ||
      value.schemaVersion !== 1 ||
      typeof value.stagingDirectory !== 'string' ||
      !/^\.dolphin-stage-[A-Za-z0-9]{6}$/.test(value.stagingDirectory) ||
      !value.release ||
      typeof value.release !== 'object' ||
      Array.isArray(value.release) ||
      Object.keys(value.release).sort().join(',') !==
        'artifactURL,revision,version' ||
      typeof value.release.version !== 'string' ||
      !/^\d{4}[a-z]?$/.test(value.release.version) ||
      typeof value.release.revision !== 'string' ||
      !/^[a-f0-9]{40}$/.test(value.release.revision) ||
      typeof value.release.artifactURL !== 'string'
    )
      return null;
    try {
      artifactURL(value.release.artifactURL, value.release.version);
    } catch {
      return null;
    }
    if (
      release &&
      (value.release.version !== release.version ||
        value.release.revision !== release.revision ||
        value.release.artifactURL !== release.artifactURL)
    )
      return null;
    return value as InstallJournal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

interface MountedImage {
  imagePath: string;
  mounts: string[];
  device: string | null;
}
async function mountedImages(run: ProcessRunner): Promise<MountedImage[]> {
  const plist = await run('/usr/bin/hdiutil', ['info', '-plist']);
  if (Buffer.byteLength(plist) > 1024 * 1024)
    throw new Error('Mounted image inventory is too large');
  const json = await run(
    '/usr/bin/plutil',
    ['-convert', 'json', '-o', '-', '-'],
    plist,
  );
  if (Buffer.byteLength(json) > 1024 * 1024)
    throw new Error('Mounted image inventory is too large');
  const data = JSON.parse(json);
  if (!data || !Array.isArray(data.images) || data.images.length > 512)
    throw new Error('Invalid mounted image inventory');
  return data.images.map((image: Record<string, unknown>) => {
    const entities = image && image['system-entities'];
    const imagePath = image && image['image-path'];
    if (
      !Array.isArray(entities) ||
      entities.length > 128 ||
      typeof imagePath !== 'string' ||
      !path.isAbsolute(imagePath) ||
      imagePath.includes('\0')
    )
      throw new Error('Invalid mounted image inventory');
    const mounts: string[] = [];
    let device: string | null = null;
    entities.forEach((entry: Record<string, unknown>) => {
      const candidate = entry && entry['dev-entry'];
      if (typeof candidate === 'string' && /^\/dev\/disk\d+$/.test(candidate))
        device = candidate;
      const mount = entry && entry['mount-point'];
      if (mount === undefined) return;
      if (
        typeof mount !== 'string' ||
        !path.isAbsolute(mount) ||
        mount.includes('\0')
      )
        throw new Error('Invalid mounted image inventory');
      mounts.push(mount);
    });
    return { imagePath, mounts, device };
  });
}

/** Query after failed attach as well: an attach error does not prove there is no mount. */
export async function detachStage(
  staged: string,
  run: ProcessRunner,
): Promise<void> {
  const expected = path.join(staged, 'mount');
  const ownedImage = path.join(staged, 'download.dmg');
  const inside = (mount: string) =>
    mount === staged || mount.startsWith(`${staged}/`);
  const relevant = (image: MountedImage) =>
    inside(image.imagePath) || image.mounts.some(inside);
  const images = (await mountedImages(run)).filter(relevant);
  if (
    images.length > 1 ||
    images.some(
      (image) =>
        image.imagePath !== ownedImage ||
        image.mounts.length > 1 ||
        image.mounts.some((mount) => mount !== expected),
    )
  )
    throw new Error('Unexpected mount inside installation staging');
  if (images.length) {
    // A failed attach may leave an attached device without a mounted filesystem.
    const target = images[0].mounts[0] || images[0].device;
    if (!target) throw new Error('Cannot identify owned image for detachment');
    await run('/usr/bin/hdiutil', ['detach', target]);
    if ((await mountedImages(run)).some(relevant))
      throw new Error('Installation image is still mounted');
  }
}

async function recoverTransactions(
  root: string,
  release: DolphinRelease,
  run: ProcessRunner,
): Promise<void> {
  const destination = path.join(root, release.version);
  const reserved = await exists(destination);
  const reservation = reserved ? await readJournal(destination, release) : null;
  if (
    reserved &&
    (!reservation || (await exists(path.join(destination, 'receipt.json'))))
  )
    throw new Error('Existing installation directory is preserved');
  if (
    reserved &&
    (await fs.readdir(destination)).some(
      (name) =>
        ![journalName, 'Dolphin.app', '.receipt.json.tmp'].includes(name),
    )
  )
    throw new Error('Unknown installation files are preserved');
  const entries = await fs.readdir(root);
  if (entries.length > 1024) throw new Error('Too many installation entries');
  // Only complete owned markers authorize recovery; unrelated staging is preserved.
  // eslint-disable-next-line no-restricted-syntax -- Each recovery must finish detachment before cleanup.
  for (const name of entries.filter((entry) =>
    /^\.dolphin-stage-[A-Za-z0-9]{6}$/.test(entry),
  )) {
    const staged = path.join(root, name);
    // Stage ownership comes from its own official release journal. Discovery may
    // have advanced since the interrupted download or attach took place.
    // eslint-disable-next-line no-await-in-loop -- Validate each marker before its transaction.
    const journal = await readJournal(staged);
    if (journal?.stagingDirectory === name) {
      // eslint-disable-next-line no-await-in-loop -- Preserve files which this transaction never created.
      const files = await fs.readdir(staged);
      if (
        files.some(
          (file) =>
            ![journalName, 'download.dmg', 'mount', 'Dolphin.app'].includes(
              file,
            ),
        )
      )
        throw new Error('Unknown staging files are preserved');
      // eslint-disable-next-line no-await-in-loop -- Never recurse into a possibly mounted image.
      await detachStage(staged, run);
      // eslint-disable-next-line no-await-in-loop -- The owned image has been proved unmounted.
      await fs.rm(staged, { recursive: true });
    }
  }
  if (reservation) await fs.rm(destination, { recursive: true });
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
  if (activeRoots.has(root)) throw new Error('Installation is already active');
  activeRoots.add(root);
  const destination = path.join(root, release.version);
  let staged: string | undefined;
  let mountAttempted = false;
  let destinationOwned = false;
  let installed = false;
  try {
    await recoverTransactions(root, release, run);
    staged = await fs.mkdtemp(path.join(root, '.dolphin-stage-'));
    const journal: InstallJournal = {
      format: 'emulation-workspace-dolphin-install',
      schemaVersion: 1,
      release,
      stagingDirectory: path.basename(staged),
    };
    await writeJournal(staged, journal);
    const dmg = path.join(staged, 'download.dmg');
    const audit = await download(release, dmg);
    const mountPoint = path.join(staged, 'mount');
    await fs.mkdir(mountPoint, { mode: 0o700 });
    // A failed attach can still leave a mount; require detach before removing staging.
    mountAttempted = true;
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
    await verifyBundle(source, run, release);
    const stagedBundle = path.join(staged, 'Dolphin.app');
    await run('/usr/bin/ditto', [source, stagedBundle]);
    await checkBundleLinks(stagedBundle);
    await verifyBundle(stagedBundle, run, release);
    await detachStage(staged, run);
    mountAttempted = false;
    // Reserve only after verified copy and successful detach. The narrow crash
    // window between mkdir and marker intentionally leaves an unmarked directory
    // for manual recovery; unknown directories are never guessed to be ours.
    await fs.mkdir(destination, { mode: 0o700 });
    // This live call owns its successful exclusive mkdir even if the marker
    // cannot be opened, written or synced. Prior unmarked directories still fail
    // closed in recovery, where that ownership cannot be established.
    destinationOwned = true;
    await writeJournal(destination, journal);
    const bundlePath = path.join(destination, 'Dolphin.app');
    await fs.rename(stagedBundle, bundlePath);
    const receipt: InstallReceipt = {
      ...release,
      ...audit,
      bundlePath,
      verification: 'codesign-and-gatekeeper',
    };
    // Publish a fully written receipt atomically. A crash during writing leaves
    // only the journaled temporary file, which recovery can safely discard.
    const receiptTemporary = path.join(destination, '.receipt.json.tmp');
    const receiptHandle = await fs.open(receiptTemporary, 'wx', 0o600);
    try {
      await receiptHandle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`);
      await receiptHandle.sync();
    } finally {
      await receiptHandle.close();
    }
    await fs.rename(receiptTemporary, path.join(destination, 'receipt.json'));
    installed = true;
    await fs.unlink(path.join(destination, journalName));
    return receipt;
  } finally {
    try {
      // Destination cleanup is independent of mounted-staging cleanup.
      if (destinationOwned && !installed)
        await fs.rm(destination, { recursive: true });
      if (staged) {
        if (mountAttempted) await detachStage(staged, run);
        await fs.rm(staged, { recursive: true });
      }
    } finally {
      activeRoots.delete(root);
    }
  }
}
