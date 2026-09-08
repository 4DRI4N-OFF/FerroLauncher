const { MOJANG_MANIFEST } = require('./constants');
const { fetchJson, downloadFile } = require('./downloader');
const path = require('path');

let cache = null;

async function listVersions() {
  if (cache) return cache;
  const manifest = await fetchJson(MOJANG_MANIFEST);
  cache = manifest.versions;
  return cache;
}

async function getVersionDetails(versionId) {
  const versions = await listVersions();
  const entry = versions.find((v) => v.id === versionId);
  if (!entry) throw new Error(`Versión no encontrada: ${versionId}`);
  return fetchJson(entry.url);
}

async function downloadClientJar(versionDetails, versionsDir, onProgress) {
  const id = versionDetails.id;
  const dl = versionDetails.downloads?.client;
  if (!dl?.url) throw new Error('Sin client jar en version details');
  const dest = path.join(versionsDir, id, `${id}.jar`);
  return downloadFile(dl.url, dest, onProgress, dl.size);
}

module.exports = { listVersions, getVersionDetails, downloadClientJar };
