// Opens the packaged app on the owner's permanent test profile:
//   npm run test-app:macos
// Profile: ~/Emulation Workspace Test (library, installed components, Console
// Mode state). Diagnostics stream to app.log inside it.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const app = path.join(
  root,
  'release/build-macos/mac-arm64/Emulation Workspace.app',
);
const profile = path.join(os.homedir(), 'Emulation Workspace Test');

if (!fs.existsSync(app)) {
  console.error('No packaged app yet. Run: npm run package:macos');
  process.exit(1);
}
const running = (() => {
  try {
    execFileSync('/usr/bin/pgrep', ['-f', `${app}/Contents/MacOS/`]);
    return true;
  } catch {
    return false;
  }
})();
if (running) {
  console.error(
    'Emulation Workspace is already running. Quit it first so the new build is used.',
  );
  process.exit(1);
}
fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
execFileSync('/usr/bin/open', [
  '-n',
  '--stderr',
  path.join(profile, 'app.log'),
  '--env',
  `EMULATION_SMOKE_DIR=${profile}`,
  '--env',
  'EMULATION_SMOKE_INTERACTIVE=1',
  '-a',
  app,
]);
console.log(`Opened ${path.basename(app)} with the test profile in ${profile}`);
