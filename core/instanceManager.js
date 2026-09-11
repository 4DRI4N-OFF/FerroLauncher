const fs = require('fs');
const path = require('path');

function ensureDirs(d) {
  for (const p of Object.values(d)) fs.mkdirSync(p, { recursive: true });
}

function defaultSettings() {
  return { ramMb: 2048, javaMode: 'auto', javaPath: '', width: 854, height: 480, jvmPreset: 'equilibrado' };
}

function withSettings(cfg) {
  return { ...cfg, settings: { ...defaultSettings(), ...(cfg.settings || {}) } };
}

// Los nombres vienen de la UI, pero nunca deben escapar del dir de instancias
function safeName(n) {
  const s = path.basename(String(n || ''));
  if (!s || s === '.' || s === '..') throw new Error('Nombre no válido');
  return s;
}

function listInstances(instancesDir) {
  fs.mkdirSync(instancesDir, { recursive: true });
  return fs.readdirSync(instancesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const cfgPath = path.join(instancesDir, e.name, 'ferro.json');
      let cfg = {};
      try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch {}
      return withSettings({ name: e.name, path: path.join(instancesDir, e.name), ...cfg });
    });
}

function createInstance(instancesDir, name, versionId, opts = {}) {
  const base = name.replace(/[^\w\-. ]+/g, '_').trim() || 'Instancia';
  const taken = (s) => {
    const d = path.join(instancesDir, s);
    try {
      return fs.existsSync(path.join(d, 'ferro.json')) || fs.readdirSync(d).length > 0;
    } catch { return false; }
  };
  let safe = base, i = 2;
  while (taken(safe)) safe = `${base} (${i++})`;
  const dir = path.join(instancesDir, safe);
  fs.mkdirSync(dir, { recursive: true });
  const type = ['fabric', 'quilt', 'forge', 'neoforge'].includes(opts.type) ? opts.type : 'vanilla';
  const cfg = withSettings({
    name: safe,
    versionId,
    createdAt: new Date().toISOString(),
    type,
    ...(type !== 'vanilla' ? { loaderVersion: opts.loaderVersion || null } : {}),
  });
  fs.writeFileSync(path.join(dir, 'ferro.json'), JSON.stringify(cfg, null, 2));
  return { name: safe, path: dir, ...cfg };
}

function updateInstanceSettings(instancesDir, name, patch) {
  const dir = path.join(instancesDir, safeName(name));
  const cfgPath = path.join(dir, 'ferro.json');
  const cfg = withSettings(JSON.parse(fs.readFileSync(cfgPath, 'utf8')));
  const s = { ...cfg.settings };
  if (patch.ramMb !== undefined) s.ramMb = Math.min(16384, Math.max(512, Number(patch.ramMb) || 2048));
  if (patch.javaMode !== undefined) s.javaMode = patch.javaMode === 'custom' ? 'custom' : 'auto';
  if (patch.javaPath !== undefined) s.javaPath = String(patch.javaPath || '');
  if (patch.width !== undefined) s.width = Math.min(7680, Math.max(320, Number(patch.width) || 854));
  if (patch.height !== undefined) s.height = Math.min(4320, Math.max(240, Number(patch.height) || 480));
  if (patch.jvmPreset !== undefined) {
    const ok = ['equilibrado', 'rendimiento', 'patata', 'zgc'];
    s.jvmPreset = ok.includes(patch.jvmPreset) ? patch.jvmPreset : 'equilibrado';
  }
  if (patch.pinned !== undefined) s.pinned = !!patch.pinned;
  cfg.settings = s;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  return withSettings({ name, path: dir, ...cfg });
}

module.exports = { ensureDirs, listInstances, createInstance, updateInstanceSettings, defaultSettings, setForgeProfile, duplicateInstance, deleteInstance, renameInstance, touchPlayed, addPlayTime, instanceSize, cleanInstance };

// Peso de una instancia (recursivo, sin seguir enlaces) + desglose por carpeta
function walkSize(p, agg) {
  let st;
  try { st = fs.lstatSync(p); } catch { return; }
  if (st.isSymbolicLink()) return;
  if (st.isFile()) { agg.bytes += st.size; agg.files++; return; }
  if (!st.isDirectory()) return;
  let entries;
  try { entries = fs.readdirSync(p); } catch { return; }
  for (const e of entries) walkSize(path.join(p, e), agg);
}
function instanceSize(instanceDir) {
  const top = {};
  let total = 0, files = 0;
  let entries;
  try { entries = fs.readdirSync(instanceDir); } catch { return { bytes: 0, files: 0, top: {} }; }
  for (const e of entries) {
    const agg = { bytes: 0, files: 0 };
    walkSize(path.join(instanceDir, e), agg);
    if (agg.bytes > 0) top[e] = agg.bytes;
    total += agg.bytes; files += agg.files;
  }
  return { bytes: total, files, top };
}

// Limpieza segura: logs enteros + crash-reports de más de 30 días
function cleanInstance(instanceDir) {
  let freed = 0, removed = 0;
  const rmFile = (p) => {
    try {
      const s = fs.statSync(p);
      if (!s.isFile()) return;
      freed += s.size; fs.unlinkSync(p); removed++;
    } catch {}
  };
  try {
    const logs = path.join(instanceDir, 'logs');
    if (fs.existsSync(logs)) for (const f of fs.readdirSync(logs)) rmFile(path.join(logs, f));
  } catch {}
  try {
    const cr = path.join(instanceDir, 'crash-reports');
    if (fs.existsSync(cr)) {
      const limit = Date.now() - 30 * 86400000;
      for (const f of fs.readdirSync(cr)) {
        const p = path.join(cr, f);
        try { if (fs.statSync(p).mtimeMs < limit) rmFile(p); } catch {}
      }
    }
  } catch {}
  return { freed, removed };
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function duplicateInstance(instancesDir, name) {
  const src = path.join(instancesDir, safeName(name));
  const cfg = withSettings(JSON.parse(fs.readFileSync(path.join(src, 'ferro.json'), 'utf8')));
  const safe = `${cfg.name} copia`.replace(/[^\w\-. ]+/g, '_').trim();
  let dest = safe, i = 2;
  while (fs.existsSync(path.join(instancesDir, dest))) dest = `${safe} (${i++})`;
  copyDir(src, path.join(instancesDir, dest));
  const cfgPath = path.join(instancesDir, dest, 'ferro.json');
  const c2 = withSettings(JSON.parse(fs.readFileSync(cfgPath, 'utf8')));
  c2.name = dest;
  delete c2.lastPlayed;
  fs.writeFileSync(cfgPath, JSON.stringify(c2, null, 2));
  return dest;
}

function deleteInstance(instancesDir, name) {
  fs.rmSync(path.join(instancesDir, safeName(name)), { recursive: true, force: true });
  return true;
}

function renameInstance(instancesDir, oldName, newName) {
  const safe = String(newName).replace(/[^\w\-. ]+/g, '_').trim();
  if (!safe) throw new Error('Nombre vacío');
  if (fs.existsSync(path.join(instancesDir, safe))) throw new Error('Ya existe ese nombre');
  fs.renameSync(path.join(instancesDir, safeName(oldName)), path.join(instancesDir, safe));
  const cfgPath = path.join(instancesDir, safe, 'ferro.json');
  const cfg = withSettings(JSON.parse(fs.readFileSync(cfgPath, 'utf8')));
  cfg.name = safe;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  return safe;
}

function touchPlayed(instancesDir, name) {
  try {
    const cfgPath = path.join(instancesDir, safeName(name), 'ferro.json');
    const cfg = withSettings(JSON.parse(fs.readFileSync(cfgPath, 'utf8')));
    cfg.lastPlayed = Date.now();
    cfg.plays = (cfg.plays || 0) + 1;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  } catch {}
}

function addPlayTime(instancesDir, name, secs) {
  try {
    if (!secs || secs < 5) return null;
    const cfgPath = path.join(instancesDir, safeName(name), 'ferro.json');
    const cfg = withSettings(JSON.parse(fs.readFileSync(cfgPath, 'utf8')));
    cfg.playSecs = Math.round((cfg.playSecs || 0) + secs);
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    return cfg.playSecs;
  } catch { return null; }
}

function setForgeProfile(instancesDir, name, patch) {
  const dir = path.join(instancesDir, safeName(name));
  const cfgPath = path.join(dir, 'ferro.json');
  const cfg = withSettings(JSON.parse(fs.readFileSync(cfgPath, 'utf8')));
  Object.assign(cfg, patch);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  return cfg;
}
