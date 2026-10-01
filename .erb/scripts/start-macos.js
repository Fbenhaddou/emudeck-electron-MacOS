const { spawn, spawnSync } = require('child_process');
const webpack = require('webpack');
const WebpackDevServer = require('webpack-dev-server');
const configure = require('../configs/webpack.config.macos');
const result = spawnSync(
  process.execPath,
  [
    require.resolve('webpack-cli/bin/cli.js'),
    '--config',
    '.erb/configs/webpack.config.macos.js',
    '--mode',
    'development',
    '--env',
    'main',
  ],
  { stdio: 'inherit' },
);
if (result.status !== 0) process.exit(result.status || 1);
const config = configure({ renderer: true }, { mode: 'development' });
const compiler = webpack(config);
let electron;
const server = new WebpackDevServer(config.devServer, compiler);
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (electron && electron.exitCode === null) electron.kill();
  await server.stop();
  process.exit(code);
}
compiler.hooks.done.tap('StartMacApplication', (stats) => {
  if (electron || stats.hasErrors()) return;
  const env = { ...process.env, NODE_ENV: 'development' };
  delete env.ELECTRON_RUN_AS_NODE;
  electron = spawn(require('electron'), ['release/app'], {
    stdio: 'inherit',
    env,
  });
  electron.on('exit', (code) => stop(code || 0));
  electron.on('error', (error) => {
    console.error(error);
    stop(1);
  });
});
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
server.start().catch((error) => {
  console.error(error);
  stop(1);
});
