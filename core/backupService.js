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
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.ferro'))
    .map((f) => ({ file: f, path: path.join(dir, f), size: fs.statSync(path.join(dir, f)).size, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

function createBackup(baseDir, instanceDir, instanceName, onLog) {
  const dest = path.join(backupsDir(baseDir, instanceName), stampName(instanceName));
  return { file: path.basename(exportInstance(instanceDir, dest, onLog)), path: dest };
}

function restoreBackup(baseDir, instancesDir, instanceName, file, onLog) {
  const src = path.join(backupsDir(baseDir, instanceName), path.basename(file));
  if (!src.startsWith(backupsDir(baseDir, instanceName))) throw new Error('Ruta no válida');
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
  const p = path.join(backupsDir(baseDir, instanceName), path.basename(file));
  fs.unlinkSync(p);
  return true;
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

module.exports = { exportInstance, importPack, listBackups, createBackup, restoreBackup, deleteBackup, profileBackup, profileRestore };
