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
 * A third-party macOS app installed from one reviewed, pinned release: exact
 * download, publisher signature, native arm64 and Gatekeeper, owned versioned
 * folder, receipt, repair. Each component supplies only this data.
 */
export interface PinnedAppSpec {
  /** Short id for staging names, e.g. 'esde'. */
  id: string;
  displayName: string;
  version: string;
  artifact: PinnedArtifact;
  bundleName: string;
  /** Contents/MacOS executable name (CFBundleExecutable). */
  executable: string;
  bundleIdentifier: string;
  teamIdentifier: string;
  /** 'image': the DMG carries a license the user must accept before mounting. */
  license: 'image' | 'none';
}

export interface InstalledApp {
  version: string;
  bundle: string;
  executable: string;
}

export type AppHealth = 'missing' | 'installed' | 'damaged';

/* eslint-disable no-unused-vars -- Names document injected contracts. */
export interface PinnedInstallOptions {
  /** Shows the image's own license text; resolves true only if the user agrees. */
  acceptLicense?: (text: string) => Promise<boolean>;
  run?: ProcessRunner;
  download?: typeof downloadPinned;
}
/* eslint-enable no-unused-vars */

function json(output: string): unknown {
  return JSON.parse(output);
}

/** The DMG's license agreement, read without mounting or accepting it. */
export async function readImageLicense(
  dmg: string,
  run: ProcessRunner = runProcess,
): Promise<string> {
  const resources = await run('/usr/bin/hdiutil', ['udifderez', '-xml', dmg]);
  if (Buffer.byteLength(resources) > 4 * 1024 * 1024)
    throw new Error('Disk image resources are too large');
  // The resource list holds binary <data>, which JSON cannot represent; extract
  // only the English license entry, whose data plutil prints as base64.
  let encoded: string | null = null;
  // eslint-disable-next-line no-restricted-syntax -- Few bounded sequential lookups.
  for (let index = 0; index < 8 && encoded === null; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const name = await run(
      '/usr/bin/plutil',
      ['-extract', `TEXT.${index}.Name`, 'raw', '-o', '-', '-'],
      resources,
    ).catch(() => null);
    if (name === null) break;
    if (name.trim() === 'English')
      // eslint-disable-next-line no-await-in-loop
      encoded = await run(
        '/usr/bin/plutil',
        ['-extract', `TEXT.${index}.Data`, 'raw', '-o', '-', '-'],
        resources,
      );
  }
  if (!encoded || !/^[A-Za-z0-9+/=\s]+$/.test(encoded))
    throw new Error('The license agreement could not be read');
  const bytes = Buffer.from(encoded.replace(/\s/g, ''), 'base64');
  if (!bytes.length || bytes.length > 64 * 1024)
    throw new Error('The license agreement could not be read');
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

export function pinnedApp(spec: PinnedAppSpec) {
  const stagePattern = new RegExp(`^\\.${spec.id}-stage-[A-Za-z0-9]{6}$`);
  const marker = `.emulation-workspace-${spec.id}-stage`;

  /** Identity, native architecture, every signature seal, publisher and Gatekeeper. */
  async function verify(
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
      info.CFBundleIdentifier !== spec.bundleIdentifier ||
      info.CFBundleExecutable !== spec.executable ||
      info.CFBundleShortVersionString !== spec.version
    )
      throw new Error(`Unexpected ${spec.displayName} bundle identity`);
    const architectures = (
      await run('/usr/bin/lipo', [
        '-archs',
        path.join(bundle, 'Contents', 'MacOS', spec.executable),
      ])
    )
      .trim()
      .split(/\s+/);
    if (!architectures.includes('arm64'))
      throw new Error(
        `${spec.displayName} has no native Apple Silicon executable`,
      );
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
    await run('/usr/bin/codesign', [
      '--verify',
      '--strict',
      '-R',
      `=anchor apple generic and identifier "${spec.bundleIdentifier}" and certificate leaf[subject.OU] = "${spec.teamIdentifier}"`,
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

  function appAt(root: string): InstalledApp {
    const bundle = path.join(root, spec.version, spec.bundleName);
    return Object.freeze({
      version: spec.version,
      bundle,
      executable: path.join(bundle, 'Contents', 'MacOS', spec.executable),
    });
  }

  /** Cheap: the receipt's version. Never authorizes execution. */
  async function installedVersion(root: string): Promise<string | null> {
    const app = appAt(await ownedRoot(root));
    try {
      const receipt = json(
        await fs.readFile(
          path.join(path.dirname(app.bundle), 'receipt.json'),
          'utf8',
        ),
      ) as Record<string, unknown>;
      return receipt.version === spec.version &&
        receipt.sha256 === spec.artifact.sha256
        ? spec.version
        : null;
    } catch {
      return null;
    }
  }

  /** Cheap (no signature work): receipt plus the files a launch needs. */
  async function health(root: string): Promise<AppHealth> {
    if (!(await installedVersion(root))) return 'missing';
    const app = appAt(await ownedRoot(root));
    const regular = (file: string) =>
      fs.lstat(file).then(
        (stat) => stat.isFile() && !stat.isSymbolicLink(),
        () => false,
      );
    const intact =
      (await regular(path.join(app.bundle, 'Contents', 'Info.plist'))) &&
      (await regular(app.executable));
    return intact ? 'installed' : 'damaged';
  }

  /** The verified installation, or null if absent or incomplete. */
  async function installed(
    root: string,
    run: ProcessRunner = runProcess,
  ): Promise<InstalledApp | null> {
    const app = appAt(await ownedRoot(root));
    try {
      const receipt = json(
        await fs.readFile(
          path.join(path.dirname(app.bundle), 'receipt.json'),
          'utf8',
        ),
      ) as Record<string, unknown>;
      if (
        receipt.version !== spec.version ||
        receipt.sha256 !== spec.artifact.sha256 ||
        (await fs.realpath(app.bundle)) !== app.bundle
      )
        return null;
    } catch {
      return null;
    }
    await verify(app.bundle, run);
    return app;
  }

  /** Remove only stages this installer marked; detach their images first. */
  async function recoverStages(root: string, run: ProcessRunner) {
    const names = (await fs.readdir(root)).filter((name) =>
      stagePattern.test(name),
    );
    // eslint-disable-next-line no-restricted-syntax -- Detach each before removal.
    for (const name of names) {
      const staged = path.join(root, name);
      // eslint-disable-next-line no-await-in-loop
      const marked = await fs
        .lstat(path.join(staged, marker))
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

  async function install(
    installRoot: string,
    options: PinnedInstallOptions = {},
  ): Promise<InstalledApp> {
    if (process.platform !== 'darwin')
      throw new Error('Installation requires macOS');
    const run = options.run || runProcess;
    const download = options.download || downloadPinned;
    if (spec.license === 'image' && !options.acceptLicense)
      throw new Error(`${spec.displayName} requires license acceptance`);
    const root = await ownedRoot(installRoot);
    const existing = await installed(root, run).catch(() => null);
    if (existing) return existing;
    await recoverStages(root, run);
    const app = appAt(root);
    const destination = path.dirname(app.bundle);
    // Repair: a copy our own receipt identifies, but which no longer verifies, is
    // moved aside and replaced. Folders without our receipt are still preserved.
    let damaged: string | null = null;
    if (await installedVersion(root)) {
      damaged = path.join(root, `.${spec.id}-damaged-${Date.now()}`);
      await fs.rename(destination, damaged);
    }
    // Never replace an unknown or partial directory; it is preserved for review.
    if (
      await fs.lstat(destination).then(
        () => true,
        () => false,
      )
    )
      throw new Error(
        `An incomplete ${spec.displayName} installation is preserved`,
      );
    const staged = await fs.mkdtemp(path.join(root, `.${spec.id}-stage-`));
    let mountAttempted = false;
    let complete = false;
    try {
      await fs.writeFile(path.join(staged, marker), '', {
        flag: 'wx',
        mode: 0o600,
      });
      const dmg = path.join(staged, 'download.dmg');
      const audit = await download(spec.artifact, dmg);
      // The terms are shown before mounting; no answer is ever given for the user.
      if (
        spec.license === 'image' &&
        !(await options.acceptLicense!(await readImageLicense(dmg, run)))
      )
        throw new Error(
          `${spec.displayName} was not installed because its license was declined`,
        );
      const mount = path.join(staged, 'mount');
      await fs.mkdir(mount, { mode: 0o700 });
      mountAttempted = true;
      // Without a declared license no prompt is answered: an unexpected one fails.
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
        spec.license === 'image' ? 'Y\n' : '',
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
      const source = path.join(mount, spec.bundleName);
      await checkBundleLinks(source);
      await verify(source, run);
      const copy = path.join(staged, spec.bundleName);
      await run('/usr/bin/ditto', [source, copy]);
      await checkBundleLinks(copy);
      await verify(copy, run);
      await detachStage(staged, run);
      mountAttempted = false;
      await fs.mkdir(destination, { mode: 0o700 });
      await fs.rename(copy, app.bundle);
      const receipt = path.join(destination, '.receipt.json.tmp');
      await fs.writeFile(
        receipt,
        `${JSON.stringify(
          {
            version: spec.version,
            ...audit,
            ...(spec.license === 'image' ? { licenseAccepted: true } : {}),
          },
          null,
          2,
        )}\n`,
        { flag: 'wx', mode: 0o600 },
      );
      await fs.rename(receipt, path.join(destination, 'receipt.json'));
      complete = true;
      return app;
    } finally {
      if (mountAttempted)
        mountAttempted = await detachStage(staged, run).then(
          () => false,
          () => true,
        );
      // Only remove staging once its image is known to be detached.
      if (!mountAttempted)
        await fs.rm(staged, { recursive: true, force: true });
      if (!complete)
        await fs
          .rm(destination, { recursive: true, force: true })
          .catch(() => undefined);
      // The damaged copy is this app's own unusable bundle, never user data.
      if (damaged)
        await fs
          .rm(damaged, { recursive: true, force: true })
          .catch(() => undefined);
    }
  }

  return Object.freeze({
    spec,
    verify,
    installedVersion,
    health,
    installed,
    install,
  });
}
