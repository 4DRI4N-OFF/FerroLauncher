const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { downloadFile } = require('./downloader');

const API = 'https://api.modrinth.com/v2';
const UA = { 'User-Agent': `FerroLauncher/${require('../package.json').version} (github.com/4DRI4N-OFF/FerroLauncher)` };

async function apiJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`Modrinth HTTP ${res.status}: ${url}`);
  return res.json();
}

const SORTS = ['relevance', 'downloads', 'follows', 'newest', 'updated'];
const KINDS = { mod: 'mods', shader: 'shaderpacks', resourcepack: 'resourcepacks', datapack: 'datapacks' };

function kindDir(kind) {
  return KINDS[kind] || 'mods';
}

async function searchMods(query, mcVersion, loader = 'fabric', { sort = 'relevance', limit = 24, offset = 0, kind = 'mod' } = {}) {
  const type = KINDS[kind] ? kind : 'mod';
  const facets = [[`versions:${mcVersion}`], [`project_type:${type}`]];
  // Los shaders/RP no siempre etiquetan loader: solo filtra si es mod
  if (type === 'mod') facets.push([`categories:${loader}`]);
  const url = `${API}/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(JSON.stringify(facets))}&limit=${limit}&offset=${offset}&index=${SORTS.includes(sort) ? sort : 'relevance'}`;
  const data = await apiJson(url);
  return {
    total: data.total_hits || 0,
    hits: (data.hits || []).map((h) => ({
      id: h.project_id, slug: h.slug, title: h.title,
      description: h.description, icon: h.icon_url,
      downloads: h.downloads, updated: h.date_modified,
      client: h.client_side, server: h.server_side,
    })),
  };
}

async function projectVersions(projectId, mcVersion, loader = 'fabric') {
  const q = `game_versions=${encodeURIComponent(JSON.stringify([mcVersion]))}` +
    (loader ? `&loaders=${encodeURIComponent(JSON.stringify([loader]))}` : '');
  return apiJson(`${API}/project/${encodeURIComponent(projectId)}/version?${q}`);
}

function pickVersion(versions, { releaseOnly = true } = {}) {
  const list = (versions || []).filter((v) => !releaseOnly || v.version_type === 'release');
  return list[0] || versions?.[0] || null;
}

function modsDir(instanceDir) {
  return path.join(instanceDir, 'mods');
}

function contentDir(instanceDir, kind, world) {
  // Los datapacks viven por mundo: saves/<mundo>/datapacks
  if (kind === 'datapack' && world) return path.join(instanceDir, 'saves', String(world), 'datapacks');
  return path.join(instanceDir, kindDir(kind));
}

// Mundos de una instancia (carpetas en saves/, con level.dat primero)
function listWorlds(instanceDir) {
  const saves = path.join(String(instanceDir), 'saves');
  let entries = [];
  try { entries = fs.readdirSync(saves, { withFileTypes: true }); } catch { return []; }
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  return dirs.sort((a, b) => {
    const la = fs.existsSync(path.join(saves, a, 'level.dat')) ? 0 : 1;
    const lb = fs.existsSync(path.join(saves, b, 'level.dat')) ? 0 : 1;
    return la - lb || a.localeCompare(b);
  });
}

function listMods(instanceDir, kind = 'mod', world) {
  const dir = contentDir(instanceDir, kind, world);
  fs.mkdirSync(dir, { recursive: true });
  const exts = kind === 'mod' ? ['.jar'] : ['.zip'];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && exts.some((x) => e.name.endsWith(x) && !e.name.endsWith(x + '.disabled')))
    .map((e) => { const st = fs.statSync(path.join(dir, e.name)); return { file: e.name, path: path.join(dir, e.name), size: st.size, mtime: st.mtimeMs }; })
    .concat(
      fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.disabled'))
        .map((e) => { const st = fs.statSync(path.join(dir, e.name)); return { file: e.name, path: path.join(dir, e.name), size: st.size, mtime: st.mtimeMs, disabled: true }; })
    );
}

async function installModFile(instanceDir, fileUrl, fileName, onProgress, kind = 'mod', expectedSize, expectedSha1, world) {
  const safe = String(fileName).replace(/[^\w\-.+() \[\]]+/g, '_');
  return downloadFile(fileUrl, path.join(contentDir(instanceDir, kind, world), safe), onProgress, expectedSize, expectedSha1);
}

async function installMod(instanceDir, projectId, mcVersion, loader = 'fabric', onLog, kind = 'mod', world) {
  const versions = await projectVersions(projectId, mcVersion, kind === 'mod' ? loader : null);
  const v = pickVersion(versions);
  if (!v) throw new Error('Sin versión compatible');
  const file = (v.files || []).find((f) => f.primary) || v.files?.[0];
  if (!file?.url) throw new Error('Versión sin archivo');
  onLog && onLog(`[ferro] ${kind} ${v.name} (${file.filename})\n`);
  await installModFile(instanceDir, file.url, file.filename, undefined, kind, file.size, file.hashes?.sha1, world);
  return { version: v.version_number, file: file.filename };
}

function toggleMod(instanceDir, file, disable, kind = 'mod', world) {
  const dir = contentDir(instanceDir, kind, world);
  const from = path.join(dir, file);
  const to = disable ? (file.endsWith('.disabled') ? from : from + '.disabled') : from.replace(/\.disabled$/, '');
  if (from !== to) fs.renameSync(from, to);
  return path.basename(to);
}

function removeMod(instanceDir, file, kind = 'mod', world) {
  fs.unlinkSync(path.join(contentDir(instanceDir, kind, world), file));
}

function sha1File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    const s = fs.createReadStream(p);
    s.on('data', (c) => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

async function versionFromHash(hash) {
  return apiJson(`${API}/version_file/${hash}?algorithm=sha1`);
}

const projectCache = new Map();
async function projectTitle(id) {
  if (!projectCache.has(id)) {
    try {
      const p = await apiJson(`${API}/project/${encodeURIComponent(id)}`);
      projectCache.set(id, p.title || id);
    } catch { projectCache.set(id, id); }
  }
  return projectCache.get(id);
}

// Compara cada .jar instalado con la última release para MC+loader
async function checkModUpdates(instanceDir, mcVersion, loader = 'fabric', onProgress) {
  const dir = contentDir(instanceDir, 'mod');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.jar')) : [];
  const out = [];
  let done = 0;
  for (const file of files) {
    try {
      const hash = await sha1File(path.join(dir, file));
      let ver = null;
      try { ver = await versionFromHash(hash); } catch { ver = null; } // 404 = no es de Modrinth
      if (ver?.project_id) {
        const latest = pickVersion(await projectVersions(ver.project_id, mcVersion, loader));
        if (latest && latest.id !== ver.id) {
          out.push({ file, projectId: ver.project_id, title: await projectTitle(ver.project_id), current: ver.version_number, latest: latest.version_number });
        }
      }
    } catch {}
    done++;
    onProgress && onProgress({ done, total: files.length, file });
  }
  return out;
}

async function updateMod(instanceDir, projectId, mcVersion, loader, oldFile, onLog) {
  const versions = await projectVersions(projectId, mcVersion, loader);
  const v = pickVersion(versions);
  if (!v) throw new Error('Sin versión compatible');
  const file = (v.files || []).find((f) => f.primary) || v.files?.[0];
  if (!file?.url) throw new Error('Versión sin archivo');
  await installModFile(instanceDir, file.url, file.filename, undefined, 'mod', file.size, file.hashes?.sha1);
  if (file.filename !== oldFile) { try { fs.unlinkSync(path.join(contentDir(instanceDir, 'mod'), oldFile)); } catch {} }
  onLog && onLog(`[ferro] actualizado a ${file.filename}\n`);
  return { version: v.version_number, file: file.filename };
}

module.exports = { searchMods, projectVersions, pickVersion, listMods, listWorlds, installModFile, installMod, toggleMod, removeMod, checkModUpdates, updateMod };
