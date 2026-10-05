/* eslint-disable no-console */
// Read-only checks of the locally built Mac preview. This does not establish
// Developer ID signing, notarization or license clearance.
const assert = require('assert/strict');
const fs = require('fs/promises');
const { createReadStream } = require('fs');
const { createHash } = require('crypto');
const path = require('path');
const { execFileSync } = require('child_process');
const asar = require('@electron/asar');
const config = require('../configs/electron-builder.macos');

async function fingerprint(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function run() {
  assert.equal(process.platform, 'darwin');
  const repository = path.resolve(__dirname, '../..');
  assert.equal(
    require('electron/package.json').version,
    '41.10.7',
    'Review native dependency notices when changing Electron',
  );
  const app = path.join(
    repository,
    'release/build-macos/mac-arm64/Emulation Workspace.app',
  );
  const contents = path.join(app, 'Contents');
  const resources = path.join(contents, 'Resources');
  const archive = path.join(resources, 'app.asar');
  const info = JSON.parse(
    execFileSync(
      '/usr/bin/plutil',
      ['-convert', 'json', '-o', '-', path.join(contents, 'Info.plist')],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 },
    ),
  );
  assert.equal(info.CFBundleIdentifier, config.appId);
  assert.equal(info.CFBundleName, config.productName);
  assert.equal(info.CFBundleDisplayName, config.productName);
  assert.equal(info.CFBundleExecutable, config.productName);
  assert.equal(info.NSHumanReadableCopyright, config.copyright);
  assert.equal(info.LSMinimumSystemVersion, config.mac.minimumSystemVersion);
  const entries = [
    '/dist',
    '/dist/main',
    '/dist/main/main.js',
    '/dist/main/preload.js',
    '/dist/renderer',
    '/dist/renderer/index.html',
    '/dist/renderer/renderer.js',
    '/dist/renderer/renderer.js.LICENSE.txt',
    '/dist/renderer/style.css',
    '/package.json',
  ];
  assert.deepEqual(asar.listPackage(archive).sort(), entries.sort());
  const metadata = JSON.parse(
    asar.extractFile(archive, 'package.json').toString('utf8'),
  );
  assert.equal(metadata.name, config.extraMetadata.name);
  assert.equal(metadata.description, config.extraMetadata.description);
  assert.equal(metadata.author.name, config.extraMetadata.author.name);
  assert.equal(metadata.author.url, config.extraMetadata.author.url);
  assert.equal(metadata.version, info.CFBundleShortVersionString);
  assert.equal(metadata.main, './dist/main/main.js');
  assert.deepEqual(metadata.dependencies, {});
  for (const entry of entries.filter(
    (value) => value.includes('.') && value.startsWith('/dist/'),
  )) {
    assert.deepEqual(
      asar.extractFile(archive, entry.slice(1)),
      await fs.readFile(path.join(repository, 'release/app', entry)),
      `Stale bundled output: ${entry}`,
    );
  }
  for (const notice of config.extraResources) {
    assert.deepEqual(
      await fs.readFile(path.join(resources, notice.to)),
      await fs.readFile(path.join(repository, notice.from)),
      `Missing or altered notice: ${notice.to}`,
    );
  }
  for (const executable of [
    path.join(contents, 'MacOS', info.CFBundleExecutable),
    path.join(resources, 'helpers', 'console-launcher'),
    path.join(resources, 'helpers', 'activate-app'),
    path.join(
      contents,
      'Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
    ),
  ]) {
    assert.equal(
      execFileSync('/usr/bin/lipo', ['-archs', executable], {
        encoding: 'utf8',
        maxBuffer: 1024,
      }).trim(),
      'arm64',
    );
  }
  const runtime = path.join(
    repository,
    'node_modules/electron/dist/Electron.app/Contents',
  );
  for (const [built, installed] of [
    [
      path.join(contents, 'MacOS', info.CFBundleExecutable),
      path.join(runtime, 'MacOS/Electron'),
    ],
    [
      path.join(
        contents,
        'Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
      ),
      path.join(
        runtime,
        'Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
      ),
    ],
    [
      path.join(resources, 'default_app.asar'),
      path.join(runtime, 'Resources/default_app.asar'),
    ],
  ]) {
    assert.equal(
      await fingerprint(built),
      await fingerprint(installed),
      'Unsigned native runtime differs from installed Electron',
    );
  }
  assert.ok(
    (await fs.stat(path.join(resources, info.CFBundleIconFile))).size > 1024,
  );
  const dmg = path.join(
    repository,
    'release/build-macos',
    `${config.productName}-${metadata.version}-arm64.dmg`,
  );
  assert.ok((await fs.stat(dmg)).size > 1024 * 1024);
  console.log(
    `Mac package contents passed: ${entries.length} archive entries; ${config.extraResources.length} byte-identical notices/research files; ARM64 executable/framework and native runtime byte correspondence; neutral metadata/icon; DMG present.`,
  );
  console.log(
    'Unsigned development preview. Signing/notarization and clean-install validation are separate gates.',
  );
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
