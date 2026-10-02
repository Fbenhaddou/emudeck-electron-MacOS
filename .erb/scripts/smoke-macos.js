/* eslint-disable no-console */
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

async function run() {
  if (process.platform !== 'darwin')
    throw new Error('The macOS smoke test requires macOS.');
  const root = path.resolve(__dirname, '../..');
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'emulation-smoke-'),
  );
  const development = process.argv[2] === '--dev';
  const packagedExecutable = development ? undefined : process.argv[2];
  const executable = development
    ? process.execPath
    : packagedExecutable
      ? path.resolve(packagedExecutable)
      : require('electron');
  const args = development
    ? [path.join(__dirname, 'start-macos.js')]
    : packagedExecutable
      ? []
      : [path.join(root, 'release/app')];
  const env = {
    ...process.env,
    NODE_ENV: development ? 'development' : 'production',
    ...(development ? { PORT: process.env.PORT || '4318' } : {}),
    EMULATION_SMOKE_DIR: directory,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let output = '';
  let timedOut = false;
  const child = spawn(executable, args, {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const append = (chunk) => {
    output = (output + chunk.toString()).slice(-16000);
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  const timer = setTimeout(() => {
    timedOut = true;
    // Kill only this runner's process group, including its dev server and app.
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* Already exited. */
      }
    }
  }, 55000);
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
  } finally {
    clearTimeout(timer);
  }
  const reportPath = path.join(directory, 'report.json');
  await fs.writeFile(
    path.join(directory, 'process.log'),
    output.split(os.homedir()).join('<home>'),
  );
  let report;
  try {
    report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  } catch {
    throw new Error(
      `Smoke failed: no valid report (exit ${code}, timeout ${timedOut}). Logs: ${directory}`,
    );
  }
  const preferences = report.webPreferences || {};
  const expectedScreenshots = [
    ...[
      'window',
      'page-emulators',
      'page-this-mac',
      'page-development',
      'library-selected',
      'library-disconnected',
      'library-error',
      'emulators-library',
      'emulators-installed',
      'emulators-advanced',
    ].flatMap((prefix) =>
      ['light', 'dark', 'small'].map((variant) => `${prefix}-${variant}.png`),
    ),
    ...['zoom-emulators', 'zoom-library', 'keyboard-focus'].flatMap((prefix) =>
      ['light', 'dark'].map((theme) => `${prefix}-${theme}.png`),
    ),
  ];
  if (
    timedOut ||
    code !== 0 ||
    report.ready !== true ||
    report.errors?.length ||
    preferences.sandbox !== true ||
    preferences.contextIsolation !== true ||
    preferences.nodeIntegration !== false ||
    preferences.webSecurity !== true ||
    report.status?.platform !== 'darwin' ||
    !report.status?.appVersion ||
    !Array.isArray(report.screenshots) ||
    report.screenshots.length !== expectedScreenshots.length ||
    new Set(report.screenshots).size !== expectedScreenshots.length ||
    expectedScreenshots.some(
      (filename) => !report.screenshots.includes(filename),
    ) ||
    report.coverage?.screenshotCount !== expectedScreenshots.length ||
    report.coverage?.realPreloadAndIPC !== true ||
    report.coverage?.fixturesInsideIsolatedUserData !== true ||
    report.coverage?.syntheticInstalledState !== true ||
    report.coverage?.zoomActionsKeyboardReachable !== true ||
    !report.coverage?.syntheticFixtureNote ||
    !Array.isArray(report.captures) ||
    report.captures.length !== expectedScreenshots.length ||
    report.captures.some(
      (capture) =>
        capture.horizontalOverflow ||
        (capture.filename.startsWith('keyboard-focus-') &&
          !capture.keyboardFocus),
    ) ||
    Boolean(packagedExecutable) !== report.packaged
  ) {
    throw new Error(
      `Smoke failed (exit ${code}, timeout ${timedOut}). Report: ${reportPath}`,
    );
  }
  for (const filename of expectedScreenshots) {
    const data = await fs.readFile(path.join(directory, filename));
    if (
      data.length < 100 ||
      data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    ) {
      throw new Error(
        `Smoke failed: invalid screenshot ${filename}. Report: ${reportPath}`,
      );
    }
  }
  console.log(
    `macOS ${development ? 'development' : packagedExecutable ? 'packaged' : 'production'} smoke passed. Report: ${reportPath}`,
  );
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
