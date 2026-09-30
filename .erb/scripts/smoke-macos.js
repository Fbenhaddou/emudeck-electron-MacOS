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
  const packagedExecutable = process.argv[2];
  const executable = packagedExecutable
    ? path.resolve(packagedExecutable)
    : require('electron');
  const args = packagedExecutable ? [] : [path.join(root, 'release/app')];
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    EMULATION_SMOKE_DIR: directory,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let output = '';
  let timedOut = false;
  const child = spawn(executable, args, {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const append = (chunk) => {
    output = (output + chunk.toString()).slice(-16000);
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, 45000);
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
    report.screenshots.length !== 3 ||
    Boolean(packagedExecutable) !== report.packaged
  ) {
    throw new Error(
      `Smoke failed (exit ${code}, timeout ${timedOut}). Report: ${reportPath}`,
    );
  }
  for (const filename of [
    'window-light.png',
    'window-dark.png',
    'window-small.png',
  ]) {
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
    `macOS ${packagedExecutable ? 'packaged' : 'production'} smoke passed. Report: ${reportPath}`,
  );
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
