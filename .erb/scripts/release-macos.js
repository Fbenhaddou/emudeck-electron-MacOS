// Signed, notarized macOS release. Nothing here runs implicitly: the owner
// selects a Developer ID and a notarytool keychain profile explicitly, and every
// claim in the final manifest is checked by Apple's own tools first.
//
//   EMULATION_SIGNING_IDENTITY="Developer ID Application: Name (TEAMID)" \
//   EMULATION_NOTARY_PROFILE=emulation-workspace \
//   npm run release:macos
//
// Create the profile once with:
//   xcrun notarytool store-credentials emulation-workspace --apple-id <id> --team-id <TEAMID>
const { execFileSync, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...options.env },
  });

/** stdout and stderr together; codesign and spctl report on stderr. Throws on failure. */
function report(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0)
    refuse(`${path.basename(command)} failed:\n${result.stderr}`);
  return `${result.stdout}\n${result.stderr}`;
}

function refuse(message) {
  console.error(`Release refused: ${message}`);
  process.exit(2);
}

/** Preconditions only; exported for tests. Returns the validated settings. */
function preconditions(env, git, identities) {
  const identity = env.EMULATION_SIGNING_IDENTITY || '';
  const profile = env.EMULATION_NOTARY_PROFILE || '';
  const team = /^Developer ID Application: .+ \(([A-Z0-9]{10})\)$/.exec(
    identity,
  );
  if (!team)
    return {
      error:
        'Set EMULATION_SIGNING_IDENTITY to the full "Developer ID Application: Name (TEAMID)" name. Development and ad-hoc identities are not used for releases.',
    };
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(profile))
    return {
      error:
        'Set EMULATION_NOTARY_PROFILE to a notarytool keychain profile (xcrun notarytool store-credentials).',
    };
  if (!identities.includes(`"${identity}"`))
    return {
      error: `The identity "${identity}" is not a valid signing identity in this keychain.`,
    };
  if (git.dirty)
    return {
      error:
        'Commit or stash local changes first; releases build only committed source.',
    };
  if (!/^[0-9a-f]{40}$/.test(git.revision))
    return { error: 'Not a git checkout.' };
  return { identity, profile, team: team[1] };
}

function sha256(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    refuse('Run on an Apple Silicon Mac.');
  const git = {
    revision: run('git', ['rev-parse', 'HEAD']).trim(),
    dirty:
      run('git', ['status', '--porcelain', '--untracked-files=no']).trim() !==
      '',
  };
  const identities = run('/usr/bin/security', [
    'find-identity',
    '-v',
    '-p',
    'codesigning',
  ]);
  const settings = preconditions(process.env, git, identities);
  if (settings.error) refuse(settings.error);

  // Stage outside iCloud Drive so File Provider cannot re-stamp attributes mid-signing.
  const staging = fs.mkdtempSync(
    path.join(os.tmpdir(), 'emulation-workspace-release-'),
  );
  const builder = (extra) =>
    run(
      'npx',
      [
        'electron-builder',
        '--config',
        '.erb/configs/electron-builder.macos.js',
        '--mac',
        '--arm64',
        '--publish',
        'never',
        '-c.electronDist=node_modules/electron/dist',
        `-c.directories.output=${staging}`,
        '-c.mac.notarize=false',
        ...extra,
      ],
      {
        inherit: true,
        env: {
          EMULATION_SIGNING_IDENTITY: settings.identity,
          CSC_IDENTITY_AUTO_DISCOVERY: 'false',
        },
      },
    );

  run('node', ['.erb/scripts/build-macos-native.js'], { inherit: true });
  run('node', ['.erb/scripts/write-macos-source-notice.js'], { inherit: true });
  run('npm', ['run', 'build:macos'], { inherit: true });

  // 1. Signed app, notarized and stapled on its own so it verifies offline once copied out.
  builder(['--dir']);
  const app = path.join(staging, 'mac-arm64', 'Emulation Workspace.app');
  const zip = path.join(staging, 'app-for-notarization.zip');
  run('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip]);
  run(
    'xcrun',
    [
      'notarytool',
      'submit',
      zip,
      '--keychain-profile',
      settings.profile,
      '--wait',
    ],
    {
      inherit: true,
    },
  );
  run('xcrun', ['stapler', 'staple', app], { inherit: true });
  fs.rmSync(zip);

  // 2. DMG from that exact stapled app, signed, notarized and stapled.
  builder(['--prepackaged', app, '-c.dmg.sign=true']);
  const dmg = fs
    .readdirSync(staging)
    .filter((name) => name.endsWith('.dmg'))
    .map((name) => path.join(staging, name));
  if (dmg.length !== 1) refuse(`Expected one DMG, found ${dmg.length}.`);
  run(
    'xcrun',
    [
      'notarytool',
      'submit',
      dmg[0],
      '--keychain-profile',
      settings.profile,
      '--wait',
    ],
    {
      inherit: true,
    },
  );
  run('xcrun', ['stapler', 'staple', dmg[0]], { inherit: true });

  // 3. Verify with Apple's tools; any failure stops before a manifest is written.
  run('/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    '--verbose=2',
    app,
  ]);
  const signature = report('/usr/bin/codesign', ['-dv', '--verbose=4', app]);
  const assessment = report('/usr/sbin/spctl', [
    '-a',
    '-vvv',
    '-t',
    'exec',
    app,
  ]);
  if (!signature.includes(`TeamIdentifier=${settings.team}`))
    refuse('Signed team does not match the identity.');
  if (!/flags=0x10000\(runtime\)/.test(signature))
    refuse('Hardened runtime flag missing.');
  if (!assessment.includes('source=Notarized Developer ID'))
    refuse('Gatekeeper does not report a notarized Developer ID app.');
  run('xcrun', ['stapler', 'validate', app]);
  run('xcrun', ['stapler', 'validate', dmg[0]]);
  run('/usr/sbin/spctl', [
    '-a',
    '-vvv',
    '-t',
    'open',
    '--context',
    'context:primary-signature',
    dmg[0],
  ]);
  run(
    'node',
    [
      '.erb/scripts/smoke-macos.js',
      path.join(app, 'Contents', 'MacOS', 'Emulation Workspace'),
    ],
    {
      inherit: true,
    },
  );

  const manifest = {
    product: 'Emulation Workspace',
    version: JSON.parse(
      run('/usr/bin/plutil', [
        '-convert',
        'json',
        '-o',
        '-',
        path.join(app, 'Contents', 'Info.plist'),
      ]),
    ).CFBundleShortVersionString,
    revision: git.revision,
    team: settings.team,
    dmg: path.basename(dmg[0]),
    sha256: sha256(dmg[0]),
    verified: [
      'codesign --deep --strict',
      'spctl exec',
      'spctl open (DMG)',
      'stapler validate (app, DMG)',
      'packaged smoke',
    ],
    created: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(staging, 'release-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(
    `Release ready in ${staging}\n${JSON.stringify(manifest, null, 2)}`,
  );
}

module.exports = { preconditions };
if (require.main === module) main();
