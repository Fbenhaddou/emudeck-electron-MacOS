// Native macOS entries share EmuDeck's webpack/release layout, without importing
// the legacy renderer's Node dependencies or the shell-command IPC broker.
const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const paths = require('./webpack.paths');

module.exports = (env = {}, argv = {}) => {
  const development = argv.mode === 'development';
  const mode = development ? 'development' : 'production';
  const main = {
    name: 'mac-main',
    mode,
    target: 'electron-main',
    entry: {
      main: path.join(paths.srcMainPath, 'macos/main.ts'),
      preload: path.join(paths.srcMainPath, 'macos/preload.ts'),
    },
    output: { path: paths.distMainPath, filename: '[name].js', clean: true },
    // Development's default eval bundling is incompatible with the sandboxed
    // preload and the renderer's strict script-src policy.
    devtool: development ? 'source-map' : false,
    resolve: { extensions: ['.ts', '.js'] },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: { loader: 'ts-loader', options: { transpileOnly: true } },
        },
      ],
    },
    plugins: [
      new webpack.DefinePlugin({
        'process.env.NODE_ENV': JSON.stringify(mode),
      }),
    ],
    node: { __dirname: false, __filename: false },
  };
  const renderer = {
    name: 'mac-renderer',
    mode,
    target: 'web',
    entry: path.join(paths.srcRendererPath, 'macos/index.tsx'),
    output: {
      path: paths.distRendererPath,
      filename: 'renderer.js',
      clean: true,
      publicPath: development ? '/' : './',
    },
    resolve: { extensions: ['.tsx', '.ts', '.js'] },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          use: { loader: 'ts-loader', options: { transpileOnly: true } },
        },
        { test: /\.css$/, use: [MiniCssExtractPlugin.loader, 'css-loader'] },
      ],
    },
    plugins: [
      new MiniCssExtractPlugin({ filename: 'style.css' }),
      new HtmlWebpackPlugin({
        template: path.join(paths.srcRendererPath, 'macos/index.html'),
      }),
    ],
    devtool: development ? 'source-map' : false,
    devServer: {
      host: 'localhost',
      port: Number(process.env.PORT || 1212),
      hot: false,
      liveReload: true,
      allowedHosts: ['localhost'],
      client: false,
      static: false,
    },
  };
  if (env.renderer) return renderer;
  if (env.main) return main;
  return [main, renderer];
};
