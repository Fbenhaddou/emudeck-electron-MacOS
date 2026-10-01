const { spawnSync } = require('child_process');
const commands = {
  package: process.platform === 'darwin' ? 'dmg:macos' : 'package:legacy',
  build: process.platform === 'darwin' ? 'build:macos' : 'build:legacy',
  start: process.platform === 'darwin' ? 'start:macos' : 'start:legacy',
};
const command = commands[process.argv[2]];
if (!command) throw new Error('Unknown platform command');
const result = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', command],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
process.exit(result.status ?? 1);
