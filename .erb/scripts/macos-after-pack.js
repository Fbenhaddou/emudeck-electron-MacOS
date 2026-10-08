// Runs after packing and before signing. A checkout inside iCloud Drive (File
// Provider) stamps com.apple.FinderInfo and fileprovider attributes onto bundle
// folders, which codesign rejects as "detritus". Strip them from the packed app.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  if (!fs.existsSync(app)) throw new Error(`Packed app not found: ${app}`);
  execFileSync('/usr/bin/xattr', ['-cr', app]);
  execFileSync('/usr/bin/find', [app, '-name', '._*', '-type', 'f', '-delete']);
};
