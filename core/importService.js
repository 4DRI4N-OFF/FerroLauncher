const fs = require('fs');
const os = require('os');
const path = require('path');
const { createInstance } = require('./instanceManager');

function appdata() {
  return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
}

function detectLaunchers() {
  const out = {};
  const vanilla = path.join(appdata(), '.minecraft');
  if (fs.existsSync(path.join(vanilla, 'versions'))) out.vanilla = vanilla;
  for (const [key, p] of [
    ['prism', path.join(appdata(), 'PrismLauncher')],
    ['multimc', path.join(appdata(), 'MultiMC')],
  ]) {
    try {
      if (fs.existsSync(path.join(p, 'instances')) && fs.existsSync(path.join(p, 'mmc-pack.json')) === false) {
        out[key] = p;
      } else if (fs.existsSync(p)) {
        const inst = path.join(p, 'instances');
        if (fs.existsSync(inst)) out[key] = p;
      }
    } catch {}
  }
  return out;
}

function listVanilla(mcPath) {
  const vers = path.join(mcPath, 'versions');
  if (!fs.existsSync(vers)) return [];
  return fs.readdirSync(vers, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      let id = e.name;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(vers, e.name, `${e.name}.json`), 'utf8'));
        id = j.id || e.name;
      } catch {}
      return { id, dir: path.join(vers, e.name) };
    });
}

// mmc-pack.json -> { mc, loader: {type, version} | null }
function parseMmcPack(json) {
  const comps = json.components || [];
  const get = (uid) => comps.find((c) => c.uid === uid);
  const mc = get('net.minecraft')?.version || null;
  const table = [
    ['net.fabricmc.fabric-loader', 'fabric'],
    ['org.quiltmc.quilt-loader', 'quilt'],
    ['net.minecraftforge', 'forge'],
    ['net.neoforged', 'neoforge'],
  ];
  let loader = null;
  for (const [uid, type] of table) {
    const c = get(uid);
    if (c?.version) { loader = { type, version: c.version }; break; }
  }
  return { mc, loader };
}

function listPrism(prismPath) {
  const inst = path.join(prismPath, 'instances');
  if (!fs.existsSync(inst)) return [];
  return fs.readdirSync(inst, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      let info = { mc: null, loader: null };
      try {
        info = parseMmcPack(JSON.parse(fs.readFileSync(path.join(inst, e.name, 'mmc-pack.json'), 'utf8')));
      } catch {}
      return { name: e.name, path: path.join(inst, e.name), ...info };
    });
}

const COPY_DIRS = ['saves', 'resourcepacks', 'shaderpacks', 'config', 'mods', 'screenshots'];
function copyIfExists(src, dest) {
  try {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, e.name), d = path.join(dest, e.name);
      if (e.isDirectory()) copyIfExists(s, d);
      else fs.copyFileSync(s, d);
    }
  } catch {}
}

function importVanillaInstance(instancesDir, mcPath, versionId, asName) {
  const inst = createInstance(instancesDir, asName || versionId, versionId, { type: 'vanilla' });
  const src = mcPath;
  for (const d of ['saves', 'resourcepacks', 'shaderpacks', 'screenshots']) {
    copyIfExists(path.join(src, d), path.join(inst.path, d));
  }
  for (const f of ['options.txt', 'servers.dat']) {
    try {
      const s = path.join(src, f);
      if (fs.existsSync(s)) fs.copyFileSync(s, path.join(inst.path, f));
    } catch {}
  }
  return inst;
}

function importPrismInstance(instancesDir, prismInstPath, asName) {
  let info = { mc: null, loader: null };
  try {
    info = parseMmcPack(JSON.parse(fs.readFileSync(path.join(prismInstPath, 'mmc-pack.json'), 'utf8')));
  } catch {}
  if (!info.mc) throw new Error('Esa instancia no declara versión de Minecraft');
  const base = asName || path.basename(prismInstPath);
  const inst = createInstance(instancesDir, base, info.mc, {
    type: info.loader ? info.loader.type : 'vanilla',
    loaderVersion: info.loader ? info.loader.version : undefined,
  });
  for (const d of COPY_DIRS) copyIfExists(path.join(prismInstPath, d), path.join(inst.path, d));
  for (const f of ['options.txt', 'servers.dat']) {
    try {
      const s = path.join(prismInstPath, f);
      if (fs.existsSync(s)) fs.copyFileSync(s, path.join(inst.path, f));
    } catch {}
  }
  return { ...inst, mc: info.mc, loader: info.loader };
}

module.exports = { detectLaunchers, listVanilla, listPrism, parseMmcPack, importVanillaInstance, importPrismInstance };
