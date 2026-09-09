const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

async function fetchRetry(url, opts = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(20000) });
      if ((res.status >= 500 || res.status === 429) && i < tries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
        continue;
      }
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

async function downloadFile(url, dest, onProgress, expectedSize, expectedSha1) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // Caché: reutiliza si coincide sha1 (o tamaño si no hay sha1)
  try {
    const st = fs.statSync(dest);
    if (expectedSha1) {
      if (sha1Of(dest) === expectedSha1.toLowerCase()) return dest;
    } else if (expectedSize ? st.size === expectedSize : st.size > 0) {
      return dest;
    }
    fs.unlinkSync(dest); // corrupto o parcial: re-descargar
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
  if (expectedSize) {
    const got = fs.statSync(dest).size;
    if (got !== expectedSize) {
      try { fs.unlinkSync(dest); } catch {}
      throw new Error(`Descarga incompleta (${got}/${expectedSize} bytes): ${url}`);
    }
  }
  if (expectedSha1 && sha1Of(dest) !== expectedSha1.toLowerCase()) {
    try { fs.unlinkSync(dest); } catch {}
    throw new Error(`Descarga corrupta (sha1 no coincide): ${url}`);
  }
  return dest;
}

function sha1Of(p) {
  try {
    const h = require('crypto').createHash('sha1');
    h.update(fs.readFileSync(p));
    return h.digest('hex');
  } catch { return null; }
}

module.exports = { fetchJson, downloadFile };
