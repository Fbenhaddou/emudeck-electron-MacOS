// No native application modules currently exist. Do not invoke a nested npm
// install just to populate an empty release/app manifest (npm 11 rejects that
// builder lifecycle invocation). Future native modules still use builder.
const { spawnSync } = require('child_process');
const metadata = require('../../release/app/package.json');
function run(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
run(require.resolve('./check-native-dep'));
if (Object.keys(metadata.dependencies || {}).length > 0) {
  run(require.resolve('electron-builder/cli.js'), ['install-app-deps']);
}
if (process.platform !== 'darwin') {
  process.env.NODE_ENV = 'development';
  run(require.resolve('webpack-cli/bin/cli.js'), [
    '--config',
    './.erb/configs/webpack.config.renderer.dev.dll.js',
  ]);
}
