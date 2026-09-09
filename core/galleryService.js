const fs = require('fs');
const path = require('path');

function shotsDir(instanceDir) {
  return path.join(instanceDir, 'screenshots');
}

function listShots(instanceDir) {
  const dir = shotsDir(instanceDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /\.png$/i.test(f))
    .map((f) => {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      return { file: f, path: p, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function deleteShot(instanceDir, file) {
  const p = path.join(shotsDir(instanceDir), path.basename(file));
  if (!fs.existsSync(p)) throw new Error('Captura no encontrada');
  fs.unlinkSync(p);
  return true;
}

// La captura más reciente de todas las instancias (fondo del hero)
function heroShot(instancesDir) {
  let best = null;
  try {
    for (const e of fs.readdirSync(instancesDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      for (const s of listShots(path.join(instancesDir, e.name))) {
        if (s.size > 8 * 1048576) continue;
        if (!best || s.mtime > best.mtime) best = { ...s, instance: e.name };
      }
    }
  } catch {}
  return best;
}

module.exports = { listShots, deleteShot, shotsDir, heroShot };
