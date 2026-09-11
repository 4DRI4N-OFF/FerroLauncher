const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

// fetch con reintentos. timeoutMs cubre la respuesta (cabeceras); el cuerpo
// de las descargas lo vigila un detector de parones, no un límite total:
// los PCs lentos no deben morir a los 20 s, solo los realmente atascados.
async function fetchRetry(url, opts = {}, tries = 3, timeoutMs = 30000) {
  let last;
  for (let i = 0; i < tries; i++) {
    const ctl = timeoutMs > 0 ? new AbortController() : null;
    const to = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const res = await fetch(url, { ...opts, ...(ctl ? { signal: ctl.signal } : {}) });
      if (to) clearTimeout(to);
      if ((res.status >= 500 || res.status === 429) && i < tries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
        continue;
      }
      return res;
    } catch (e) {
      if (to) clearTimeout(to);
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
  // Caché: reutiliza si coincide sha1 (o tamaño si no hay sha1).
  // Sin hash esperado: confirma el tamaño contra el servidor para no
  // reutilizar eternamente un parcial (trampa de "No END header found").
  try {
    const st = fs.statSync(dest);
    if (expectedSha1) {
      if (sha1Of(dest) === expectedSha1.toLowerCase()) return dest;
    } else if (expectedSize ? st.size === expectedSize : st.size > 0) {
      if (!expectedSize && st.size > 1048576) {
        try {
          const head = await fetchRetry(url, { method: 'HEAD' });
          const len = Number(head.headers.get('content-length') || 0);
          if (len > 0 && st.size !== len) {
            try { fs.unlinkSync(dest); } catch {}
          } else {
            return dest;
          }
        } catch {
          return dest;
        }
      } else {
        return dest;
      }
    } else {
      try { fs.unlinkSync(dest); } catch {}
    }
    try { fs.unlinkSync(dest); } catch {}
  } catch {}

  const res = await fetchRetry(url, {}, 3, 0);
  if (!res.ok || !res.body) throw new Error(`Descarga fallida ${res.status}: ${url}`);
  const total = Number(res.headers.get('content-length') || 0);
  let done = 0, lastData = Date.now();
  const file = fs.createWriteStream(dest);
  // Convertimos web stream a node stream manualmente (sin getReader previo: bloquearía el stream)
  const { Readable } = require('stream');
  const readable = Readable.fromWeb(res.body);
  readable.on('data', (c) => {
    done += c.length;
    lastData = Date.now();
    if (onProgress && total) onProgress(done / total);
  });
  // Solo muere si se para de verdad (90 s sin un byte), nunca por ir lento
  const watchdog = setInterval(() => {
    if (Date.now() - lastData > 90000) {
      try { readable.destroy(new Error('Descarga detenida 90 s sin datos. Revisa tu conexión.')); } catch {}
    }
  }, 5000);
  try {
    await pipeline(readable, file);
  } finally {
    clearInterval(watchdog);
  }
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
