const path = require('path');
const fs = require('fs');
const { downloadFile } = require('./downloader');

const API = 'https://api.modrinth.com/v2';
const UA = { 'User-Agent': 'FerroLauncher/0.1.0 (github.com/ferro)' };

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

async function searchMods(query, mcVersion, loader = 'fabric', { sort = 'relevance', limit = 24, kind = 'mod' } = {}) {
  const type = KINDS[kind] ? kind : 'mod';
  const facets = [[`versions:${mcVersion}`], [`project_type:${type}`]];
  // Los shaders/RP no siempre etiquetan loader: solo filtra si es mod
  if (type === 'mod') facets.push([`categories:${loader}`]);
  const url = `${API}/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(JSON.stringify(facets))}&limit=${limit}&index=${SORTS.includes(sort) ? sort : 'relevance'}`;
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

function contentDir(instanceDir, kind) {
  return path.join(instanceDir, kindDir(kind));
}

function listMods(instanceDir, kind = 'mod') {
  const dir = contentDir(instanceDir, kind);
  fs.mkdirSync(dir, { recursive: true });
  const exts = kind === 'mod' ? ['.jar'] : ['.zip'];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && exts.some((x) => e.name.endsWith(x) && !e.name.endsWith(x + '.disabled')))
    .map((e) => ({ file: e.name, path: path.join(dir, e.name), size: fs.statSync(path.join(dir, e.name)).size }))
    .concat(
      fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.disabled'))
        .map((e) => ({ file: e.name, path: path.join(dir, e.name), size: 0, disabled: true }))
    );
}

async function installModFile(instanceDir, fileUrl, fileName, onProgress, kind = 'mod') {
  const safe = String(fileName).replace(/[^\w\-.+() \[\]]+/g, '_');
  return downloadFile(fileUrl, path.join(contentDir(instanceDir, kind), safe), onProgress);
}

async function installMod(instanceDir, projectId, mcVersion, loader = 'fabric', onLog, kind = 'mod') {
  const versions = await projectVersions(projectId, mcVersion, kind === 'mod' ? loader : null);
  const v = pickVersion(versions);
  if (!v) throw new Error('Sin versión compatible');
  const file = (v.files || []).find((f) => f.primary) || v.files?.[0];
  if (!file?.url) throw new Error('Versión sin archivo');
  onLog && onLog(`[ferro] ${kind} ${v.name} (${file.filename})\n`);
  await installModFile(instanceDir, file.url, file.filename, undefined, kind);
  return { version: v.version_number, file: file.filename };
}

function toggleMod(instanceDir, file, disable, kind = 'mod') {
  const dir = contentDir(instanceDir, kind);
  const from = path.join(dir, file);
  const to = disable ? (file.endsWith('.disabled') ? from : from + '.disabled') : from.replace(/\.disabled$/, '');
  if (from !== to) fs.renameSync(from, to);
  return path.basename(to);
}

function removeMod(instanceDir, file, kind = 'mod') {
  fs.unlinkSync(path.join(contentDir(instanceDir, kind), file));
}

module.exports = { searchMods, projectVersions, pickVersion, listMods, installModFile, installMod, toggleMod, removeMod };
