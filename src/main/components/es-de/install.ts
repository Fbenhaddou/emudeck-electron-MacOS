/* eslint-disable no-bitwise -- POSIX permission checks are bit masks. */
import fs from 'fs/promises';
import path from 'path';
import { downloadPinned } from '../dolphin/download';
import type { PinnedArtifact } from '../dolphin/download';
import {
  checkBundleLinks,
  detachStage,
  runProcess,
  validateMount,
} from '../dolphin/install';
import type { ProcessRunner } from '../dolphin/install';

/**
 * ES-DE is installed from one reviewed, pinned release. Its bundle identifier is
 * the version string, so every update is a deliberate manifest change: new URL,
 * size, hash and designated requirement, reviewed together.
 */
export const ESDE_RELEASE = Object.freeze({
  version: '3.5.0',
  artifact: Object.freeze({
    url: 'https://gitlab.com/es-de/emulationstation-de/-/package_files/357717468/download',
    bytes: 79383926,
    sha256: '060bd289fa17f8f07bac2eb688698047f7be79b80495983f08580b5f1a046e1e',
  }) as PinnedArtifact,
  bundleIdentifier: '3.5.0',
  teamIdentifier: 'K56UAA4SXL',
});

const BUNDLE = 'ES-DE.app';
const STAGE_PATTERN = /^\.esde-stage-[A-Za-z0-9]{6}$/;
const MARKER = '.emulation-workspace-esde-stage';

export interface InstalledFrontend {
  version: string;
  bundle: string;
  executable: string;
}

/* eslint-disable no-unused-vars -- Names document injected contracts. */
export interface EsdeInstallOptions {
  /** Shows the image's own license text; resolves true only if the user agrees. */
  acceptLicense: (text: string) => Promise<boolean>;
  run?: ProcessRunner;
  download?: typeof downloadPinned;
}
/* eslint-enable no-unused-vars */

function json(output: string): unknown {
  return JSON.parse(output);
}

/** The DMG's license agreement, read without mounting or accepting it. */
export async function readLicense(
  dmg: string,
  run: ProcessRunner = runProcess,
): Promise<string> {
  const resources = await run('/usr/bin/hdiutil', ['udifderez', '-xml', dmg]);
  if (Buffer.byteLength(resources) > 4 * 1024 * 1024)
    throw new Error('Disk image resources are too large');
  const data = json(
    await run(
      '/usr/bin/plutil',
      ['-convert', 'json', '-o', '-', '-'],
      resources,
    ),
  ) as Record<string, Array<{ Name?: unknown; Data?: unknown }>>;
  const entry = (data?.TEXT || []).find((item) => item.Name === 'English');
  if (!entry || typeof entry.Data !== 'string')
    throw new Error('The ES-DE license agreement could not be read');
  const bytes = Buffer.from(entry.Data, 'base64');
  if (!bytes.length || bytes.length > 64 * 1024)
    throw new Error('The ES-DE license agreement could not be read');
  let text: string;
  try {
    text = new TextDecoder('macintosh', { fatal: true }).decode(
      Uint8Array.from(bytes),
    );
  } catch {
    text = bytes.toString('latin1');
  }
  return text.replace(/\r\n?/g, '\n').trim();
}

/** Identity, native architecture, every signature seal, publisher and Gatekeeper. */
export async function verifyFrontend(
  bundle: string,
  run: ProcessRunner = runProcess,
): Promise<void> {
  const info = json(
    await run('/usr/bin/plutil', [
      '-convert',
      'json',
      '-o',
      '-',
      path.join(bundle, 'Contents', 'Info.plist'),
    ]),
  ) as Record<string, unknown>;
  if (
    !info ||
    info.CFBundleIdentifier !== ESDE_RELEASE.bundleIdentifier ||
    info.CFBundleExecutable !== 'ES-DE' ||
    info.CFBundleShortVersionString !== ESDE_RELEASE.version
  )
    throw new Error('Unexpected ES-DE bundle identity');
  const architectures = (
    await run('/usr/bin/lipo', [
      '-archs',
      path.join(bundle, 'Contents', 'MacOS', 'ES-DE'),
    ])
  )
    .trim()
    .split(/\s+/);
  if (!architectures.includes('arm64'))
    throw new Error('ES-DE has no native Apple Silicon executable');
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
  await run('/usr/bin/codesign', [
    '--verify',
    '--strict',
    '-R',
    `=anchor apple generic and identifier "${ESDE_RELEASE.bundleIdentifier}" and certificate leaf[subject.OU] = "${ESDE_RELEASE.teamIdentifier}"`,
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

async function ownedRoot(root: string): Promise<string> {
  const stat = await fs.lstat(root);
  if (
    !path.isAbsolute(root) ||
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o022) !== 0 ||
    (await fs.realpath(root)) !== root
  )
    throw new Error('Install root must be an owned private real directory');
  return root;
}

function frontendAt(root: string): InstalledFrontend {
  const bundle = path.join(root, ESDE_RELEASE.version, BUNDLE);
  return Object.freeze({
    version: ESDE_RELEASE.version,
    bundle,
    executable: path.join(bundle, 'Contents', 'MacOS', 'ES-DE'),
  });
}

/** Returns the verified managed installation, or null if absent or incomplete. */
export async function installedFrontend(
  root: string,
  run: ProcessRunner = runProcess,
): Promise<InstalledFrontend | null> {
  const owned = await ownedRoot(root);
  const frontend = frontendAt(owned);
  try {
    const receipt = json(
      await fs.readFile(
        path.join(path.dirname(frontend.bundle), 'receipt.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    if (
      receipt.version !== ESDE_RELEASE.version ||
      receipt.sha256 !== ESDE_RELEASE.artifact.sha256 ||
      (await fs.realpath(frontend.bundle)) !== frontend.bundle
    )
      return null;
  } catch {
    return null;
  }
  await verifyFrontend(frontend.bundle, run);
  return frontend;
}

/** Remove only stages this installer marked; detach their images first. */
async function recoverStages(root: string, run: ProcessRunner) {
  const names = (await fs.readdir(root)).filter((name) =>
    STAGE_PATTERN.test(name),
  );
  // eslint-disable-next-line no-restricted-syntax -- Detach each before removal.
  for (const name of names) {
    const staged = path.join(root, name);
    // eslint-disable-next-line no-await-in-loop
    const marked = await fs
      .lstat(path.join(staged, MARKER))
      .then((stat) => stat.isFile() && !stat.isSymbolicLink())
      .catch(() => false);
    if (marked) {
      // eslint-disable-next-line no-await-in-loop -- Never recurse into a mounted image.
      await detachStage(staged, run);
      // eslint-disable-next-line no-await-in-loop
      await fs.rm(staged, { recursive: true });
    }
  }
}

export async function installFrontend(
  installRoot: string,
  options: EsdeInstallOptions,
): Promise<InstalledFrontend> {
  if (process.platform !== 'darwin')
    throw new Error('Installation requires macOS');
  const run = options.run || runProcess;
  const download = options.download || downloadPinned;
  const root = await ownedRoot(installRoot);
  const existing = await installedFrontend(root, run).catch(() => null);
  if (existing) return existing;
  await recoverStages(root, run);
  const frontend = frontendAt(root);
  const destination = path.dirname(frontend.bundle);
  // Never replace an unknown or partial directory; it is preserved for review.
  if (
    await fs.lstat(destination).then(
      () => true,
      () => false,
    )
  )
    throw new Error('An incomplete ES-DE installation is preserved');
  const staged = await fs.mkdtemp(path.join(root, '.esde-stage-'));
  let mountAttempted = false;
  let installed = false;
  try {
    await fs.writeFile(path.join(staged, MARKER), '', {
      flag: 'wx',
      mode: 0o600,
    });
    const dmg = path.join(staged, 'download.dmg');
    const audit = await download(ESDE_RELEASE.artifact, dmg);
    // The terms are shown to the user before the image is mounted; no answer
    // is ever given on their behalf.
    if (!(await options.acceptLicense(await readLicense(dmg, run))))
      throw new Error(
        'ES-DE was not installed because its license was declined',
      );
    const mount = path.join(staged, 'mount');
    await fs.mkdir(mount, { mode: 0o700 });
    mountAttempted = true;
    const output = await run(
      '/usr/bin/hdiutil',
      [
        'attach',
        '-readonly',
        '-nobrowse',
        '-noautoopen',
        '-mountpoint',
        mount,
        '-plist',
        dmg,
      ],
      'Y\n',
    );
    const start = output.indexOf('<?xml');
    if (start < 0) throw new Error('Disk image could not be mounted');
    validateMount(
      await run(
        '/usr/bin/plutil',
        ['-convert', 'json', '-o', '-', '-'],
        output.slice(start),
      ),
      mount,
    );
    const source = path.join(mount, BUNDLE);
    await checkBundleLinks(source);
    await verifyFrontend(source, run);
    const copy = path.join(staged, BUNDLE);
    await run('/usr/bin/ditto', [source, copy]);
    await checkBundleLinks(copy);
    await verifyFrontend(copy, run);
    await detachStage(staged, run);
    mountAttempted = false;
    await fs.mkdir(destination, { mode: 0o700 });
    await fs.rename(copy, frontend.bundle);
    const receipt = path.join(destination, '.receipt.json.tmp');
    await fs.writeFile(
      receipt,
      `${JSON.stringify({ version: ESDE_RELEASE.version, ...audit, licenseAccepted: true }, null, 2)}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    await fs.rename(receipt, path.join(destination, 'receipt.json'));
    installed = true;
    return frontend;
  } finally {
    if (mountAttempted)
      mountAttempted = await detachStage(staged, run).then(
        () => false,
        () => true,
      );
    // Only remove staging once its image is known to be detached.
    if (!mountAttempted) await fs.rm(staged, { recursive: true, force: true });
    if (!installed)
      await fs
        .rm(destination, { recursive: true, force: true })
        .catch(() => undefined);
  }
}
