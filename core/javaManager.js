const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

function execJavaVersion(javaPath) {
  return new Promise((resolve) => {
    execFile(javaPath, ['-version'], (err, stdout, stderr) => {
      const out = `${stdout}\n${stderr}`;
      const m = out.match(/version "([^"]+)"/) || out.match(/(\d+\.\d+\.\d+)/);
      resolve(m ? m[1] : null);
    });
  });
}

function majorOf(version) {
  if (!version) return null;
  if (/^1\.8/.test(version)) return 8;
  const m = String(version).match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

function compatible(systemMajor, required) {
  if (systemMajor == null || required == null) return false;
  if (required <= 8) return systemMajor === 8;
  return systemMajor >= required; // 17+ suele tirar con Java más nuevo (21/25)
}

function managedJavaPath(runtimesDir, major) {
  return path.join(runtimesDir, `java-${major}`, 'bin', 'java.exe');
}

async function checkJava(javaPath) {
  const version = await execJavaVersion(javaPath);
  if (!version) return null;
  return { path: javaPath, version, major: majorOf(version) };
}

function systemCandidates(runtimesDir) {
  const list = [];
  if (process.env.JAVA_HOME) list.push(path.join(process.env.JAVA_HOME, 'bin', 'java.exe'));
  list.push('java'); // PATH
  for (const base of ['C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Microsoft']) {
    try {
      const found = fs.readdirSync(base, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(base, e.name, 'bin', 'java.exe'))
        .filter((jp) => { try { return fs.existsSync(jp); } catch { return false; } })
        .sort()
        .reverse();
      list.push(...found);
    } catch {}
  }
  return list;
}

async function findJava() {
  let best = null;
  for (const c of systemCandidates()) {
    const found = await checkJava(c);
    if (found && (!best || (found.major || 0) > (best.major || 0))) best = found;
  }
  return best;
}

// Busca un Java compatible con el major requerido: primero runtimes gestionados, luego sistema.
async function findCompatibleJava(requiredMajor, runtimesDir) {
  if (runtimesDir && requiredMajor) {
    // Cualquier runtime gestionado compatible (exacto o mayor si >=17)
    try {
      const entries = fs.readdirSync(runtimesDir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith('java-'));
      for (const e of entries.sort().reverse()) {
        const jp = path.join(runtimesDir, e.name, 'bin', 'java.exe');
        if (!fs.existsSync(jp)) continue;
        const info = await checkJava(jp);
        if (info && compatible(info.major, requiredMajor)) return { ...info, managed: true };
      }
    } catch {}
  }
  for (const c of systemCandidates()) {
    const info = await checkJava(c);
    if (info && compatible(info.major, requiredMajor)) return info;
  }
  return null;
}

function temurinUrl(major) {
  return `https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/x64/jdk/hotspot/normal/eclipse`;
}

function findRecursively(dir, target) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === target.toLowerCase()) return p;
    if (e.isDirectory()) {
      const hit = findRecursively(p, target);
      if (hit) return hit;
    }
  }
  return null;
}

// Descarga Temurin si no hay Java compatible. Devuelve { path, version, major, managed }.
async function ensureJava(requiredMajor, runtimesDir, onProgress) {
  const found = await findCompatibleJava(requiredMajor, runtimesDir);
  if (found) return found;
  if (!requiredMajor) {
    const any = await findJava();
    if (!any) throw new Error('Java no encontrado. Instala JDK 21+ y reintenta.');
    return any;
  }
  fs.mkdirSync(runtimesDir, { recursive: true });
  const { downloadFile } = require('./downloader');
  const zipDest = path.join(runtimesDir, `.temurin-${requiredMajor}.zip`);
  onProgress && onProgress(`[ferro] descargando Java ${requiredMajor} (Temurin)...\n`);
  await downloadFile(temurinUrl(requiredMajor), zipDest);
  const destDir = path.join(runtimesDir, `java-${requiredMajor}`);
  fs.mkdirSync(destDir, { recursive: true });
  const AdmZip = require('adm-zip');
  new AdmZip(zipDest).extractAllTo(destDir, true);
  try { fs.unlinkSync(zipDest); } catch {}
  const javaExe = findRecursively(destDir, 'java.exe');
  if (!javaExe) throw new Error(`Temurin ${requiredMajor}: no se encontró java.exe tras extraer`);
  const info = await checkJava(javaExe);
  if (!info) throw new Error(`Temurin ${requiredMajor}: java.exe no responde`);
  return { ...info, managed: true };
}

module.exports = { findJava, findCompatibleJava, ensureJava, execJavaVersion, majorOf, compatible };
