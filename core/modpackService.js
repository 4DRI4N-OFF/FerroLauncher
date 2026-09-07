const path = require('path');
const fs = require('fs');
const os = require('os');
const AdmZip = require('adm-zip');
const { downloadFile } = require('./downloader');

const API = 'https://api.modrinth.com/v2';
const UA = { 'User-Agent': 'FerroLauncher/0.1.0 (github.com/ferro)' };

async function apiJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`Modrinth HTTP ${res.status}: ${url}`);
  return res.json();
}

async function searchModpacks(query, mcVersion, limit = 12) {
  const facets = JSON.stringify([[`versions:${mcVersion}`], ['project_type:modpack']]);
  const url = `${API}/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(facets)}&limit=${limit}`;
  const data = await apiJson(url);
  return (data.hits || []).map((h) => ({
    id: h.project_id, slug: h.slug, title: h.title,
    description: h.description, icon: h.icon_url, downloads: h.downloads,
  }));
}

async function packVersions(projectId, mcVersion, loader = ['fabric', 'forge', 'neoforge', 'quilt']) {
  const url = `${API}/project/${encodeURIComponent(projectId)}/version?game_versions=${encodeURIComponent(JSON.stringify([mcVersion]))}&loaders=${encodeURIComponent(JSON.stringify(loader))}`;
  return apiJson(url);
}

async function getPackVersion(packVersionId) {
  return apiJson(`${API}/version/${encodeURIComponent(packVersionId)}`);
}

// Descarga el .mrpack y vuelca su contenido en instanceDir.
// Devuelve { mcVersion, loaderVersion, files } para configurar la instancia.
async function installMrpack(instanceDir, mrpackUrl, onLog) {
  fs.mkdirSync(instanceDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ferro-pack-'));
  const packPath = path.join(tmp, 'pack.mrpack');
  onLog && onLog('[ferro] descargando modpack...\n');
  await downloadFile(mrpackUrl, packPath);
  const zip = new AdmZip(packPath);
  const indexEntry = zip.getEntry('modrinth.index.json');
  if (!indexEntry) throw new Error('.mrpack sin modrinth.index.json');
  const index = JSON.parse(zip.readAsText(indexEntry));
  const deps = index.dependencies || {};
  const files = (index.files || []).filter((f) => f.env?.client !== 'unsupported');

  onLog && onLog(`[ferro] modpack ${index.name} v${index.versionId}: ${files.length} archivos (MC ${deps.minecraft})\n`);
  const CONC = 8;
  let done = 0;
  for (let i = 0; i < files.length; i += CONC) {
    await Promise.all(files.slice(i, i + CONC).map(async (f) => {
      const url = f.downloads?.[0];
      if (!url) return;
      const dest = path.join(instanceDir, ...f.path.split('/'));
      try {
        const st = fs.statSync(dest);
        if (st.size === f.fileSize) return;
      } catch {}
      await downloadFile(url, dest);
    }));
    done += Math.min(CONC, files.length - done);
    onLog && onLog(`[ferro] modpack ${done}/${files.length}\n`);
  }
  // overrides/ -> raíz de la instancia (configs, resourcepacks, etc.)
  for (const e of zip.getEntries()) {
    if (e.isDirectory || !e.entryName.startsWith('overrides/')) continue;
    const rel = e.entryName.slice('overrides/'.length);
    if (!rel) continue;
    zip.extractEntryTo(e, instanceDir, false, true);
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  const depEntries = [['fabric-loader', 'fabric'], ['quilt-loader', 'quilt'], ['forge', 'forge'], ['neoforge', 'neoforge']];
  let loaderType = 'fabric', loaderVersion = null;
  for (const [key, type] of depEntries) {
    if (deps[key]) { loaderType = type; loaderVersion = deps[key]; break; }
  }
  return { name: index.name, mcVersion: deps.minecraft, loaderType, loaderVersion, files: files.length };
}

module.exports = { searchModpacks, packVersions, getPackVersion, installMrpack };
