const fs = require('fs');
const path = require('path');

function ensureDirs(d) {
  for (const p of Object.values(d)) fs.mkdirSync(p, { recursive: true });
}

function defaultSettings() {
  return { ramMb: 2048, javaMode: 'auto', javaPath: '', width: 854, height: 480 };
}

function withSettings(cfg) {
  return { ...cfg, settings: { ...defaultSettings(), ...(cfg.settings || {}) } };
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
  const safe = name.replace(/[^\w\-. ]+/g, '_').trim() || 'Instancia';
  const dir = path.join(instancesDir, safe);
  fs.mkdirSync(dir, { recursive: true });
  const cfg = withSettings({
    name: safe,
    versionId,
    createdAt: new Date().toISOString(),
    type: opts.type === 'fabric' ? 'fabric' : 'vanilla',
    ...(opts.type === 'fabric' ? { loaderVersion: opts.loaderVersion || null } : {}),
  });
  fs.writeFileSync(path.join(dir, 'ferro.json'), JSON.stringify(cfg, null, 2));
  return { name: safe, path: dir, ...cfg };
}

function updateInstanceSettings(instancesDir, name, patch) {
  const dir = path.join(instancesDir, name);
  const cfgPath = path.join(dir, 'ferro.json');
  const cfg = withSettings(JSON.parse(fs.readFileSync(cfgPath, 'utf8')));
  const s = { ...cfg.settings };
  if (patch.ramMb !== undefined) s.ramMb = Math.min(16384, Math.max(512, Number(patch.ramMb) || 2048));
  if (patch.javaMode !== undefined) s.javaMode = patch.javaMode === 'custom' ? 'custom' : 'auto';
  if (patch.javaPath !== undefined) s.javaPath = String(patch.javaPath || '');
  if (patch.width !== undefined) s.width = Math.min(7680, Math.max(320, Number(patch.width) || 854));
  if (patch.height !== undefined) s.height = Math.min(4320, Math.max(240, Number(patch.height) || 480));
  cfg.settings = s;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  return withSettings({ name, path: dir, ...cfg });
}

module.exports = { ensureDirs, listInstances, createInstance, updateInstanceSettings, defaultSettings };
