const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

function backupsDir(baseDir, instanceName) {
  return path.join(baseDir, 'backups', instanceName);
}

function stampName(name) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${name}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.ferro`;
}

function exportInstance(instanceDir, destZip, onLog) {
  fs.mkdirSync(path.dirname(destZip), { recursive: true });
  const zip = new AdmZip();
  zip.addLocalFolder(instanceDir);
  zip.writeZip(destZip);
  onLog && onLog(`[ferro] exportado ${(fs.statSync(destZip).size / 1048576).toFixed(1)} MB\n`);
  return destZip;
}

function readPackName(zipPath) {
  try {
    const zip = new AdmZip(zipPath);
    const e = zip.getEntry('ferro.json');
    if (e) return JSON.parse(zip.readAsText(e)).name || null;
  } catch {}
  return null;
}

function uniqueDir(instancesDir, base) {
  let name = base, i = 2;
  while (fs.existsSync(path.join(instancesDir, name))) name = `${base} (${i++})`;
  return name;
}

function importPack(zipPath, instancesDir, onLog) {
  if (!fs.existsSync(zipPath)) throw new Error('Archivo no encontrado');
  const name = uniqueDir(instancesDir, (readPackName(zipPath) || path.basename(zipPath, '.ferro')).replace(/[^\w\-. ]+/g, '_').trim() || 'Instancia');
  const dest = path.join(instancesDir, name);
  fs.mkdirSync(dest, { recursive: true });
  new AdmZip(zipPath).extractAllTo(dest, true);
  // Normaliza el nombre interno
  try {
    const cfgPath = path.join(dest, 'ferro.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.name = name;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  } catch {}
  onLog && onLog(`[ferro] importada como ${name}\n`);
  return name;
}

function listBackups(baseDir, instanceName) {
  const dir = backupsDir(baseDir, instanceName);
  const out = [];
  const read = (d, auto) => {
    if (!fs.existsSync(d)) return;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith('.ferro')) continue;
      const p = path.join(d, f);
      try {
        const st = fs.statSync(p);
        if (!st.isFile()) continue;
        out.push({ file: (auto ? 'auto/' : '') + f, path: p, size: st.size, mtime: st.mtimeMs, auto: !!auto });
      } catch {}
    }
  };
  read(dir, false);
  read(path.join(dir, 'auto'), true);
  return out.sort((a, b) => b.mtime - a.mtime);
}

// Resuelve una copia esté en la raíz o en auto/
function resolveBackup(baseDir, instanceName, file) {
  const base = path.basename(String(file || '').replace(/^auto\//, ''));
  const dir = backupsDir(baseDir, instanceName);
  for (const p of [path.join(dir, base), path.join(dir, 'auto', base)]) {
    try { if (fs.statSync(p).isFile()) return p; } catch {}
  }
  throw new Error('Copia no encontrada');
}

function createBackup(baseDir, instanceDir, instanceName, onLog) {
  const dest = path.join(backupsDir(baseDir, instanceName), stampName(instanceName));
  return { file: path.basename(exportInstance(instanceDir, dest, onLog)), path: dest };
}

function restoreBackup(baseDir, instancesDir, instanceName, file, onLog) {
  const src = resolveBackup(baseDir, instanceName, file);
  // Valida ANTES de tocar nada: un zip corrupto no debe destruir la instancia
  try {
    const test = new AdmZip(src);
    if (!test.getEntry('ferro.json')) throw new Error('sin ferro.json');
  } catch (e) {
    throw new Error(`Copia no válida: ${e.message}`);
  }
  const dest = path.join(instancesDir, instanceName);
  const tmp = dest + '.restore-tmp';
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  new AdmZip(src).extractAllTo(tmp, true);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(tmp, dest);
  onLog && onLog(`[ferro] ${instanceName} restaurada desde ${file}\n`);
  return true;
}

function deleteBackup(baseDir, instanceName, file) {
  fs.unlinkSync(resolveBackup(baseDir, instanceName, file));
  return true;
}

// Copias automáticas opcionales: viven en backups/<inst>/auto/
function readCfg(baseDir) {
  try { return JSON.parse(fs.readFileSync(path.join(baseDir, 'ferro-config.json'), 'utf8')); } catch { return {}; }
}
function writeCfg(baseDir, cfg) {
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(path.join(baseDir, 'ferro-config.json'), JSON.stringify(cfg, null, 2));
}
function getAutoCfg(baseDir) {
  const c = readCfg(baseDir).autoBackup || {};
  const mode = ['off', 'beforePlay', 'daily', 'weekly'].includes(c.mode) ? c.mode : 'off';
  const keep = Math.min(20, Math.max(1, Number(c.keep) || 3));
  return { mode, keep, lastAuto: Number(c.lastAuto) || 0 };
}
function setAutoCfg(baseDir, patch) {
  const cfg = readCfg(baseDir);
  cfg.autoBackup = { ...getAutoCfg(baseDir), ...(patch || {}) };
  if (patch && patch.mode !== undefined && !['off', 'beforePlay', 'daily', 'weekly'].includes(patch.mode)) {
    throw new Error('Modo no válido');
  }
  writeCfg(baseDir, cfg);
  return getAutoCfg(baseDir);
}
function createAutoBackup(baseDir, instanceDir, instanceName, onLog) {
  const dir = path.join(backupsDir(baseDir, instanceName), 'auto');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, stampName(instanceName));
  return { file: 'auto/' + path.basename(exportInstance(instanceDir, dest, onLog)), path: dest };
}
function pruneAuto(baseDir, instanceName, keep) {
  const dir = path.join(backupsDir(baseDir, instanceName), 'auto');
  if (!fs.existsSync(dir)) return 0;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ferro'))
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  let n = 0;
  for (const x of files.slice(Math.max(0, keep))) {
    try { fs.unlinkSync(path.join(dir, x.f)); n++; } catch {}
  }
  return n;
}
function autoDue(cfg) {
  if (cfg.mode === 'daily') {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    return cfg.lastAuto < d.getTime();
  }
  if (cfg.mode === 'weekly') return Date.now() - cfg.lastAuto > 7 * 86400000;
  return false;
}
// Todas las instancias (diaria/semanal). Devuelve informe por instancia.
function runAutoBackups(baseDir, instances, onLog, force) {
  const cfg = getAutoCfg(baseDir);
  if (!force && !autoDue(cfg)) return { due: false, done: [] };
  const done = [];
  for (const inst of instances || []) {
    try {
      const r = createAutoBackup(baseDir, inst.path, inst.name, onLog);
      pruneAuto(baseDir, inst.name, cfg.keep);
      done.push({ instance: inst.name, file: r.file });
    } catch (e) { done.push({ instance: inst.name, error: String((e && e.message) || e) }); }
  }
  const c = readCfg(baseDir);
  c.autoBackup = { ...cfg, lastAuto: Date.now() };
  writeCfg(baseDir, c);
  return { due: true, done };
}
// Una instancia (antes de jugar)
function autoBackupOnce(baseDir, instanceDir, instanceName, onLog) {
  const cfg = getAutoCfg(baseDir);
  const r = createAutoBackup(baseDir, instanceDir, instanceName, onLog);
  pruneAuto(baseDir, instanceName, cfg.keep);
  return r;
}

// Copia total del perfil: todo menos lo re-descargable (y sin copias para no anidar)
const PROFILE_SKIP = new Set(['libraries', 'assets', 'versions', 'runtimes', 'backups']);

function profileBackup(baseDir, destZip, onLog) {
  fs.mkdirSync(path.dirname(destZip), { recursive: true });
  const zip = new AdmZip();
  for (const e of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (PROFILE_SKIP.has(e.name)) continue;
    const full = path.join(baseDir, e.name);
    if (e.isDirectory()) zip.addLocalFolder(full, e.name);
    else zip.addLocalFile(full);
  }
  zip.writeZip(destZip);
  onLog && onLog(`[ferro] perfil exportado ${(fs.statSync(destZip).size / 1048576).toFixed(1)} MB\n`);
  return destZip;
}

function profileRestore(zipPath, baseDir, onLog) {
  try {
    const test = new AdmZip(zipPath);
    if (test.getEntries().length === 0) throw new Error('vacío');
  } catch (e) {
    throw new Error(`Perfil no válido: ${e.message}`);
  }
  new AdmZip(zipPath).extractAllTo(baseDir, true);
  onLog && onLog('[ferro] perfil restaurado (reinicia el launcher)\n');
  return true;
}

module.exports = { exportInstance, importPack, listBackups, createBackup, restoreBackup, deleteBackup, profileBackup, profileRestore, getAutoCfg, setAutoCfg, runAutoBackups, autoBackupOnce };
