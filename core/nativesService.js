const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { downloadFile } = require('./downloader');

function is64() { return ['x64', 'arm64'].includes(process.arch); }

function isNativeForCurrentArch(libName) {
  // Formato moderno (1.19+): el native es una librería aparte con sufijo
  // x64 -> :natives-windows | arm64 -> :natives-windows-arm64 | ia32 -> :natives-windows-x86
  const arch = process.arch;
  if (arch === 'arm64') return /:natives-windows-arm64$/.test(libName);
  if (arch === 'ia32') return /:natives-windows-x86$/.test(libName);
  return /:natives-windows$/.test(libName);
}

function isAnyNativeLib(libName) {
  return /:natives-/.test(libName);
}

function pickNativeClassifier(lib) {
  const cls = lib.downloads?.classifiers;
  if (!cls) return null;
  // Prioridad Windows actual
  const arch = process.arch; // x64 | arm64 | ia32
  const candidates =
    arch === 'arm64'
      ? ['natives-windows-arm64', 'natives-windows']
      : ['natives-windows-x86', 'natives-windows', 'natives-windows-64'];
  // también soporta claves con guion distinto en versiones viejas
  for (const k of candidates) if (cls[k]) return k;
  // fallback: cualquier natives-windows*
  const found = Object.keys(cls).find((k) => k.startsWith('natives-windows'));
  return found || null;
}

function ruleAllows(rules) {
  if (!rules || rules.length === 0) return true;
  let allowed = false;
  for (const r of rules) {
    if (r.features) continue; // demo/resolución custom: no las tenemos -> regla no aplica
    let osOk = true;
    if (r.os) {
      if (r.os.name && r.os.name !== 'windows') osOk = false;
      if (r.os.arch && r.os.arch === 'x86' && is64()) osOk = false;
    }
    if (r.action === 'allow' && osOk) allowed = true;
    if (r.action === 'disallow' && osOk) allowed = false;
  }
  return allowed;
}

function extractJar(dest, nativesDir, lib) {
  const zip = new AdmZip(dest);
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    if (e.entryName.startsWith('META-INF')) continue;
    const excl = lib.extract?.exclude || [];
    if (excl.some((x) => e.entryName.startsWith(x))) continue;
    zip.extractEntryTo(e, nativesDir, false, true);
  }
}

async function resolveNatives(versionDetails, librariesDir, nativesDir, onProgress) {
  fs.mkdirSync(nativesDir, { recursive: true });
  // Limpia extracciones previas de esta versión para evitar DLLs viejas
  let done = 0;
  const libs = (versionDetails.libraries || []).filter((l) => ruleAllows(l.rules));
  const jobs = [];
  for (const lib of libs) {
    // Formato viejo (<1.19): classifiers dentro de la misma librería
    const key = pickNativeClassifier(lib);
    if (key) { jobs.push({ lib, art: lib.downloads.classifiers[key] }); continue; }
    // Formato moderno (1.19+): librería aparte con sufijo :natives-windows
    if (isNativeForCurrentArch(lib.name) && lib.downloads?.artifact) {
      jobs.push({ lib, art: lib.downloads.artifact });
    }
  }
  for (const { lib, art } of jobs) {
    const dest = path.join(librariesDir, art.path);
    await downloadFile(art.url, dest);
    try {
      extractJar(dest, nativesDir, lib);
    } catch (err) {
      throw new Error(`Natives ${lib.name}: ${err.message}`);
    }
    done++;
    onProgress && onProgress({ done, total: jobs.length, lib: lib.name });
  }
  return { nativesDir, count: jobs.length };
}

module.exports = { resolveNatives, pickNativeClassifier, isNativeForCurrentArch, isAnyNativeLib };
