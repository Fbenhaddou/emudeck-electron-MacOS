// Developer build for the experimental, bounded ES-DE wait client.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error(
    'The native launcher requires an Apple Silicon macOS build host.',
  );
}
const repository = path.resolve(__dirname, '../..');
const output = path.join(repository, 'release/native');
fs.mkdirSync(output, { recursive: true });
execFileSync(
  '/usr/bin/xcrun',
  [
    '--sdk',
    'macosx',
    'swiftc',
    '-O',
    '-target',
    'arm64-apple-macos12.0',
    '-module-cache-path',
    path.join(output, 'module-cache'),
    path.join(repository, 'src/native/ConsoleLauncher.swift'),
    '-o',
    path.join(output, 'console-launcher'),
  ],
  { stdio: 'inherit' },
);
