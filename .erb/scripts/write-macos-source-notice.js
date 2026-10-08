// Records exactly which source built this package (GPL "Corresponding Source").
// Written to an ignored build folder and shipped as Resources/licenses/SOURCE.txt.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const revision = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain', '--untracked-files=no') !== '';
const repository = 'https://github.com/Fbenhaddou/emudeck-electron-MacOS';
const text = `Emulation Workspace for macOS — source

This application is a modified fork of EmuDeck's Electron app, licensed under
the GNU General Public License, version 3 or (at your option) any later version.
See upstream-LICENSE.md. Parts derived from Electron React Boilerplate are under
the MIT license; see upstream-MIT-LICENSE.txt.

Complete corresponding source for this build:
  ${repository}/tree/${revision}
Revision: ${revision}${dirty ? '\nWARNING: built from uncommitted changes; not a release build.' : ''}

Emulators and ES-DE are downloaded from their official publishers at the
versions shown in the app; they are not part of this package. No games,
BIOS or firmware files are included.
`;
const output = path.join(root, 'release', 'native');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'SOURCE.txt'), text);
fs.writeFileSync(
  path.join(output, 'source.json'),
  `${JSON.stringify({ revision, dirty, repository })}\n`,
);
console.log(`Source notice: ${revision}${dirty ? ' (dirty)' : ''}`);
