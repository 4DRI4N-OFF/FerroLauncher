const path = require('path');
const os = require('os');

const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

function getDataDir(app) {
  // En dev usa carpeta del proyecto/.ferro, en prod usa userData
  if (app && app.getPath) {
    try { return app.getPath('userData'); } catch {}
  }
  return path.join(os.homedir(), '.ferro-launcher');
}

function dirs(base) {
  return {
    base,
    instances: path.join(base, 'instances'),
    libraries: path.join(base, 'libraries'),
    assets: path.join(base, 'assets'),
    versions: path.join(base, 'versions'),
    runtimes: path.join(base, 'runtimes'),
  };
}

module.exports = { MOJANG_MANIFEST, getDataDir, dirs };
