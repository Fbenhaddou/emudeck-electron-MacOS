// Fails the Mac build if anything outside the reviewed module boundary is
// bundled: no file from the GUI submodule or the legacy renderer/main, and only
// allowlisted third-party packages (each with its notice in Resources/licenses).
const fs = require('fs');
const path = require('path');

const statsFile = process.argv[2];
if (!statsFile) {
  console.error('Usage: verify-macos-modules.js <webpack-stats.json>');
  process.exit(2);
}

const allowedPackages = new Set([
  'react',
  'react-dom',
  'scheduler',
  'css-loader',
]);
const allowedFirstParty = [
  'src/main/macos/',
  'src/main/components/',
  'src/renderer/macos/',
  'src/shared/macos.ts',
];

const stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
const names = new Set();
const walk = (modules) =>
  (modules || []).forEach((module) => {
    const name = module.nameForCondition || module.name;
    if (name) names.add(name);
    walk(module.modules);
  });
(stats.children || [stats]).forEach((child) => walk(child.modules));

const root = path.resolve(__dirname, '..', '..');
const problems = [];
const packages = new Set();
let checked = 0;
names.forEach((raw) => {
  const name = raw.split('!').pop().split('?')[0]; // loader chains

  // Webpack runtime helpers and Node built-ins are not bundled source.
  if (name.startsWith('webpack/') || name.startsWith('external ')) return;
  const index = name.lastIndexOf('node_modules/');
  if (index !== -1) {
    const parts = name.slice(index + 'node_modules/'.length).split('/');
    const pkg = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
    packages.add(pkg);
    checked += 1;
    if (!allowedPackages.has(pkg)) problems.push(`unreviewed package: ${pkg}`);
    return;
  }
  const relative = path.isAbsolute(name)
    ? path.relative(root, name)
    : name.replace(/^\.\//, '');
  checked += 1;
  if (!allowedFirstParty.some((prefix) => relative.startsWith(prefix)))
    problems.push(`outside the Mac boundary: ${relative}`);
});

if (checked < 10)
  problems.push(`only ${checked} source modules found in stats`);
if (problems.length) {
  console.error(
    `Mac module boundary failed:\n- ${[...new Set(problems)].join('\n- ')}`,
  );
  process.exit(1);
}
console.log(
  `Mac module boundary passed: ${checked} source modules; packages ${[...packages].sort().join(', ')}; no GUI-submodule or legacy files.`,
);
