const fs = require('fs');
const path = require('path');

function crashDir(instanceDir) {
  return path.join(instanceDir, 'crash-reports');
}

function listCrashes(instanceDir) {
  const dir = crashDir(instanceDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      return { file: f, path: p, size: st.size, mtime: st.mtimeMs, description: peekDescription(p) };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function peekDescription(p) {
  try {
    const head = fs.readFileSync(p, 'utf8').slice(0, 2000);
    const m = head.match(/Description:\s*(.+)/);
    return (m && m[1].trim().slice(0, 90)) || null;
  } catch { return null; }
}

function readCrash(instanceDir, file, maxBytes = 60000) {
  const p = path.join(crashDir(instanceDir), path.basename(file));
  const st = fs.statSync(p);
  const buf = Buffer.alloc(Math.min(st.size, maxBytes));
  const fd = fs.openSync(p, 'r');
  fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  return { file, size: st.size, truncated: st.size > maxBytes, content: buf.toString('utf8') };
}

module.exports = { listCrashes, readCrash, crashDir };
