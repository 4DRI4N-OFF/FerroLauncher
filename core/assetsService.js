const fs = require('fs');
const path = require('path');
const { fetchJson, downloadFile } = require('./downloader');

const RESOURCE_BASE = 'https://resources.download.minecraft.net';

async function downloadAssets(versionDetails, assetsDir, onProgress) {
  const ai = versionDetails.assetIndex;
  if (!ai) return { count: 0, indexId: 'legacy' };
  const indexesDir = path.join(assetsDir, 'indexes');
  const objectsDir = path.join(assetsDir, 'objects');
  fs.mkdirSync(indexesDir, { recursive: true });
  fs.mkdirSync(objectsDir, { recursive: true });

  const indexPath = path.join(indexesDir, `${ai.id}.json`);
  let index;
  try {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch {
    index = await fetchJson(ai.url);
    fs.writeFileSync(indexPath, JSON.stringify(index));
  }

  const entries = Object.entries(index.objects || {});
  let done = 0;
  const CONC = 8;
  for (let i = 0; i < entries.length; i += CONC) {
    const batch = entries.slice(i, i + CONC);
    await Promise.all(batch.map(async ([, obj]) => {
      const h = obj.hash;
      const sub = `${h.slice(0, 2)}/${h}`;
      const dest = path.join(objectsDir, h.slice(0, 2), h);
      await downloadFile(`${RESOURCE_BASE}/${sub}`, dest, undefined, obj.size, h);
    }));
    done += batch.length;
    onProgress && onProgress({ done, total: entries.length });
  }
  return { count: entries.length, indexId: ai.id };
}

async function downloadLoggingConfig(versionDetails, baseDir) {
  const cfg = versionDetails.logging?.client?.file;
  if (!cfg?.url) return null;
  const dest = path.join(baseDir, 'versions', versionDetails.id, cfg.id);
  return downloadFile(cfg.url, dest);
}

module.exports = { downloadAssets, downloadLoggingConfig };
