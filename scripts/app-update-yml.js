// Genera resources/app-update.yml dentro de win-unpacked para que el
// auto-updater encuentre el feed de GitHub Releases.
// Imprescindible con el flujo --dir + --prepackaged: electron-builder no lo
// genera solo en ese modo y sin él el updater falla con ENOENT al buscar updates.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const pub = (pkg.build && pkg.build.publish) || {};
if (!pub.owner || !pub.repo) {
  console.error('app-update-yml FAIL: falta owner/repo en package.json (build.publish)');
  process.exit(1);
}
const yml =
`provider: ${pub.provider || 'github'}
owner: ${pub.owner}
repo: ${pub.repo}
releaseType: ${pub.releaseType || 'release'}
`;
const dest = path.join(ROOT, 'release', 'win-unpacked', 'resources', 'app-update.yml');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, yml);
console.log('app-update.yml OK');
