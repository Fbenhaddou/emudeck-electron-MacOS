module.exports = {
  extends: null,
  productName: 'Emulation Workspace',
  appId: 'dev.emulation.workspace',
  copyright:
    'Development fork. Upstream copyright notices are preserved in Resources/licenses.',
  asar: true,
  directories: {
    app: 'release/app',
    buildResources: 'assets',
    output: 'release/build-macos',
  },
  // Mac webpack bundles React and all application code. Builder's dependency
  // collector otherwise falls back to root production dependencies when the
  // release/app manifest is empty, pulling legacy updater/UI modules into asar.
  files: ['dist', 'package.json', '!node_modules{,/**/*}'],
  extraResources: [
    // Console Mode's native helpers: the authenticated ES-DE wait client and the
    // single-purpose frontend activation helper (resolved from Resources/helpers).
    ...['console-launcher', 'activate-app', 'console-guardian'].map((name) => ({
      from: `release/native/${name}`,
      to: `helpers/${name}`,
    })),
    {
      from: 'node_modules/electron/dist/LICENSE',
      to: 'licenses/Electron-LICENSE.txt',
    },
    {
      from: 'node_modules/electron/dist/LICENSES.chromium.html',
      to: 'licenses/Chromium-NOTICES.html',
    },
    {
      from: 'assets/licenses/Octicons-LICENSE.txt',
      to: 'licenses/Octicons-LICENSE.txt',
    },
    ...['ReactiveObjC', 'Mantle'].map((name) => ({
      from: `assets/licenses/${name}-LICENSE.md`,
      to: `licenses/${name}-LICENSE.md`,
    })),
    ...['react', 'react-dom', 'scheduler'].map((name) => ({
      from: `node_modules/${name}/LICENSE`,
      to: `licenses/${name}-LICENSE.txt`,
    })),
    { from: 'LICENSE', to: 'licenses/upstream-MIT-LICENSE.txt' },
    { from: 'LICENSE.md', to: 'licenses/upstream-LICENSE.md' },
    {
      from: 'docs/research/license-inventory.md',
      to: 'licenses/RESEARCH-NOTICES.md',
    },
    ...[
      'components.md',
      'emulator-matrix.md',
      'es-de-integration.md',
      'es-de-artifact.md',
      'homebrew-fixtures.md',
      'controllers.md',
    ].map((name) => ({
      from: `docs/research/${name}`,
      to: `licenses/${name}`,
    })),
  ],
  extraMetadata: {
    name: 'emulation-workspace',
    author: {
      name: 'Emulation Workspace contributors',
      url: 'https://github.com/Fbenhaddou/emudeck-electron-MacOS',
    },
    description: 'Emulation library management for macOS — development preview',
  },
  mac: {
    // Unsigned previews are deliberate. Release signing selects a reviewed
    // Developer ID explicitly instead of silently using a local development key.
    identity: process.env.EMULATION_SIGNING_IDENTITY || null,
    icon: 'assets/macos-development-icon.png',
    target: [{ target: 'dmg', arch: ['arm64'] }],
    hardenedRuntime: true,
    entitlements: 'assets/entitlements.mac.plist',
    entitlementsInherit: 'assets/entitlements.mac.plist',
    category: 'public.app-category.utilities',
    minimumSystemVersion: '12.0',
    // Console Mode frontends and emulators are spawned children, so macOS charges
    // their privacy access to this app. SDL probes Bluetooth for wireless
    // controllers; without this key macOS terminates the child (observed with
    // ES-DE 3.5.0 and two Bluetooth DualSense controllers).
    extendInfo: {
      NSBluetoothAlwaysUsageDescription:
        'Emulation Workspace uses Bluetooth so wireless game controllers such as DualSense work in Console Mode and in games.',
      // PPSSPP emulates the PSP camera for the few games that use it.
      NSCameraUsageDescription:
        'Some PSP games use a camera. Emulation Workspace asks only when such a game wants it.',
    },
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
