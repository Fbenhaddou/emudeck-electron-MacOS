module.exports = {
  extends: null,
  productName: 'Emulation Workspace',
  appId: 'dev.emulation.workspace',
  asar: true,
  directories: {
    app: 'release/app',
    buildResources: 'assets',
    output: 'release/build-macos',
  },
  files: ['dist', 'package.json'],
  extraMetadata: {
    name: 'emulation-workspace',
    description: 'Emulation library management for macOS — development preview',
  },
  mac: {
    target: [{ target: 'dmg', arch: ['arm64'] }],
    hardenedRuntime: true,
    entitlements: 'assets/entitlements.mac.plist',
    entitlementsInherit: 'assets/entitlements.mac.plist',
    category: 'public.app-category.utilities',
    minimumSystemVersion: '12.0',
  },
  dmg: {
    sign: false,
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: 'link', path: '/Applications' },
    ],
  },
  publish: null,
};
