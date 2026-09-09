const fs = require('fs');
const path = require('path');
const { downloadFile } = require('./downloader');

const API = 'https://api.curseforge.com/v1';
const UA = { 'User-Agent': `FerroLauncher/${require('../package.json').version} (github.com/4DRI4N-OFF/FerroLauncher)` };
const MC_GAME_ID = 432;
const CLASS = { mod: 6, modpack: 4471, resourcepack: 12 };
const LOADERS = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const SORTS = { relevance: 1, downloads: 6, newest: 11, updated: 3, name: 4 };

function cfgPath(baseDir) {
  return path.join(baseDir, 'ferro-config.json');
}
function readCfg(baseDir) {
  try { return JSON.parse(fs.readFileSync(cfgPath(baseDir), 'utf8')); } catch { return {}; }
}
function getKey(baseDir) {
  return process.env.CURSEFORGE_KEY || readCfg(baseDir).cfKey || '';
}
function setKey(baseDir, key) {
  const p = cfgPath(baseDir);
  const cfg = readCfg(baseDir);
  cfg.cfKey = String(key || '').trim();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return !!cfg.cfKey;
}

async function api(baseDir, url) {
  const key = getKey(baseDir);
  if (!key) throw new Error('Falta la API key de CurseForge (Contenido → Configurar)');
  const res = await fetch(url, { headers: { 'x-api-key': key, Accept: 'application/json', ...UA } });
  if (res.status === 403) throw new Error('CurseForge rechazó la API key (403)');
  if (res.status === 429) throw new Error('Límite de CurseForge excedido, espera un minuto');
  if (!res.ok) throw new Error(`CurseForge HTTP ${res.status}`);
  return res.json();
}

async function search(baseDir, query, mcVersion, kind = 'mod', sort = 'downloads') {
  const qs = new URLSearchParams({
    gameId: String(MC_GAME_ID),
    classId: String(CLASS[kind] || 6),
    gameVersion: mcVersion,
    searchFilter: query || '',
    sortField: String(SORTS[sort] || 6),
    sortOrder: 'desc',
    pageSize: '24',
  });
  let data;
  try {
    data = await api(baseDir, `${API}/mods/search?${qs}`);
  } catch (e) {
    if (/403/.test(e.message)) {
      throw new Error('CurseForge denegó la búsqueda con esta key: las keys nuevas a veces requieren aprobación para /search (escribe a support@curseforge.com). Mientras, usa Tendencias.');
    }
    throw e;
  }
  return {
    total: data.pagination?.totalCount || 0,
    hits: (data.data || []).map(hit),
  };
}

const KNOWN_LOADERS = ['forge', 'fabric', 'quilt', 'neoforge', 'cauldron', 'liteloader', 'rift'];
function loaderNames(f) {
  const out = [];
  for (const g of f.sortableGameVersions || []) {
    if (g.gameVersionTypeId === 68441 && g.name) out.push(g.name);
  }
  for (const v of f.gameVersions || []) {
    const hit = KNOWN_LOADERS.find((k) => String(v).toLowerCase() === k);
    if (hit && !out.some((o) => o.toLowerCase() === hit)) out.push(hit);
  }
  return out;
}

function hit(m) {
  return {
    id: m.id, title: m.name, description: m.summary,
    icon: m.logo?.url || null, downloads: m.downloadCount || 0,
    updated: m.dateModified || null, loaders: [],
  };
}

// Plan B sin /search: populares + recién actualizados (funciona con keys nuevas)
async function trending(baseDir) {
  const key = getKey(baseDir);
  if (!key) throw new Error('Falta la API key de CurseForge (Contenido → Configurar)');
  const res = await fetch(`${API}/mods/featured`, {
    method: 'POST',
    headers: { 'x-api-key': key, Accept: 'application/json', 'Content-Type': 'application/json', ...UA },
    body: JSON.stringify({ gameId: MC_GAME_ID, excludedModIds: [] }),
  });
  if (!res.ok) throw new Error(`CurseForge HTTP ${res.status}`);
  const data = await res.json();
  const seen = new Map();
  for (const m of [...(data.data?.popular || []), ...(data.data?.recentlyUpdated || [])]) {
    if (!seen.has(m.id)) seen.set(m.id, hit(m));
  }
  const hits = [...seen.values()];
  return { total: hits.length, hits };
}

async function files(baseDir, modId, mcVersion, loader) {
  const qs = new URLSearchParams({ gameVersion: mcVersion });
  if (loader && LOADERS[loader]) qs.set('modLoaderType', String(LOADERS[loader]));
  const data = await api(baseDir, `${API}/mods/${modId}/files?${qs}`);
  return (data.data || []).map((f) => ({
    id: f.id, name: f.fileName, date: f.fileDate,
    url: f.downloadUrl, size: f.fileLength,
    versions: f.gameVersions || [], loaders: loaderNames(f),
  }));
}

const KIND_DIR = { mod: 'mods', modpack: '__pack__', resourcepack: 'resourcepacks', shader: 'shaderpacks' };

async function installFile(baseDir, instanceDir, modId, fileId, kind, onLog) {
  const data = await api(baseDir, `${API}/mods/${modId}/files/${fileId}`);
  const f = data.data;
  if (!f?.downloadUrl) throw new Error('Ese archivo no tiene descarga directa');
  if (kind === 'modpack') {
    throw new Error('Los modpacks de CurseForge aún no se instalan solos (descárgalo manual)');
  }
  const dir = path.join(instanceDir, KIND_DIR[kind] || 'mods');
  const safe = String(f.fileName).replace(/[^\w\-.+() \[\]]+/g, '_');
  await downloadFile(f.downloadUrl, path.join(dir, safe), undefined, f.fileLength || undefined);
  onLog && onLog(`[ferro] instalado ${safe}\n`);
  return { file: safe };
}

module.exports = { getKey, setKey, search, trending, files, installFile };
