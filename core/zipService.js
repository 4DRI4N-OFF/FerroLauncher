const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

// ---------------------------------------------------------------------------
// Extracción de zips con contenido NO confiable (.mrpack, packs de CurseForge,
// jars de natives). adm-zip >= 0.6.1 ya valida symlinks del destino, pero NO
// valida que la entrada caiga dentro del dir de destino, y su
// `extractEntryTo(.., maintainEntryPath=false)` aplana los archivos al basename
// (anula las subcarpetas de overrides/). Aquí resolvemos las dos cosas:
//
//   1. la ruta relativa se normaliza y se rechaza si sale del destino;
//   2. escribimos nosotros los bytes, así el layout es el nuestro
//      (conservando subcarpetas cuando toca) y nunca creamos symlinks.
// ---------------------------------------------------------------------------

// Devuelve la ruta relativa segura dentro de destDir, o null si hay que saltar
// la entrada. stripPrefix quita el prefijo del zip (p. ej. "overrides/") y
// flatten aplana a basename (lo que necesitan los natives de Java).
function safeRel(entryName, { stripPrefix = '', flatten = false } = {}) {
  let rel = String(entryName || '').replace(/\\/g, '/');
  if (stripPrefix) {
    if (!rel.startsWith(stripPrefix)) return null;
    rel = rel.slice(stripPrefix.length);
  }
  if (!rel) return null;
  rel = path.posix.normalize(rel);
  // escape clásico, raíz absoluta, letra de unidad de Windows o UNC
  if (rel === '.' || rel === '..' || rel.startsWith('../') || rel.startsWith('/')) return null;
  if (/^[a-zA-Z]:/.test(rel)) return null;
  if (flatten) rel = path.posix.basename(rel);
  if (!rel || rel === '.' || rel === '..') return null;
  return rel;
}

// Compara contra el dir ya existente (resuelve symlinks del padre) para que un
// `instances/mi-instancia` que apunte fuera no se cuele como destino legítimo.
function isInside(destDir, target) {
  const root = path.resolve(destDir);
  const abs = path.resolve(target);
  if (abs !== root && !abs.startsWith(root + path.sep)) return false;
  // el padre real: si ya existe y es un symlink fuera del destino, fuera
  let probe = path.dirname(abs);
  const trail = [];
  while (!fs.existsSync(probe)) { trail.push(probe); const up = path.dirname(probe); if (up === probe) break; probe = up; }
  try {
    const realRoot = fs.realpathSync(root);
    const realProbe = fs.realpathSync(probe);
    if (realProbe !== realRoot && !realProbe.startsWith(realRoot + path.sep)) return false;
  } catch { return false; }
  return true;
}

function writeEntry(zip, entry, target) {
  const data = entry.getData();
  if (!data) throw new Error(`Zip: no se pudo leer ${entry.entryName}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Si el destino ya es un symlink (o un link colgado), se quita: escribir a
  // través de él sería escribir fuera de la instancia.
  try {
    const st = fs.lstatSync(target);
    if (st.isSymbolicLink()) fs.unlinkSync(target);
    else if (st.isDirectory()) throw new Error(`Zip: el destino es un directorio (${path.basename(target)})`);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  fs.writeFileSync(target, data);
  return data.length;
}

// Extrae las entradas de un AdmZip ya abierto. filter recibe la entrada cruda
// (para decidir por nombre: META-INF, exclude de Mojang, etc.).
function extractEntries(zip, destDir, { stripPrefix = '', flatten = false, filter = null, onSkip = null } = {}) {
  const out = { written: 0, skipped: 0, bytes: 0 };
  fs.mkdirSync(destDir, { recursive: true });
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    if (stripPrefix && !String(e.entryName).replace(/\\/g, '/').startsWith(stripPrefix)) continue; // fuera del ámbito: no es un "salto"
    if (filter && !filter(e)) continue;
    const rel = safeRel(e.entryName, { stripPrefix, flatten });
    if (!rel) { out.skipped++; onSkip && onSkip(e.entryName); continue; }
    const target = path.join(destDir, rel);
    if (!isInside(destDir, target)) { out.skipped++; onSkip && onSkip(e.entryName, 'fuera del destino'); continue; }
    out.bytes += writeEntry(zip, e, target);
    out.written++;
  }
  return out;
}

// Atajo cuando se tiene la ruta del .zip en disco
function extractZip(zipPath, destDir, opts = {}) {
  return extractEntries(new AdmZip(zipPath), destDir, opts);
}

module.exports = { safeRel, isInside, extractEntries, extractZip };
