const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

async function fetchRetry(url, opts = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(20000) });
      return res;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error(`Sin conexión con ${new URL(url).hostname} tras ${tries} intentos (${last?.cause?.code || last?.message}). Revisa internet/firewall.`);
}

async function fetchJson(url) {
  const res = await fetchRetry(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.json();
}

async function downloadFile(url, dest, onProgress) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // Skip si ya existe con tamaño > 0 (caché simple)
  try {
    const st = fs.statSync(dest);
    if (st.size > 0) return dest;
  } catch {}

  const res = await fetchRetry(url);
  if (!res.ok || !res.body) throw new Error(`Descarga fallida ${res.status}: ${url}`);
  const total = Number(res.headers.get('content-length') || 0);
  let done = 0;
  const file = fs.createWriteStream(dest);
  // Convertimos web stream a node stream manualmente (sin getReader previo: bloquearía el stream)
  const { Readable } = require('stream');
  const readable = Readable.fromWeb(res.body);
  readable.on('data', (c) => {
    done += c.length;
    if (onProgress && total) onProgress(done / total);
  });
  await pipeline(readable, file);
  return dest;
}

module.exports = { fetchJson, downloadFile };
