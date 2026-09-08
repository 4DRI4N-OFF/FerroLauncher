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
  fs.unlinkSync(p);
  return true;
}

module.exports = { listShots, deleteShot, shotsDir };
