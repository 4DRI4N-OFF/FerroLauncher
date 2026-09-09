const net = require('net');
const fs = require('fs');
const path = require('path');

function writeVarInt(value, out) {
  let v = value >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
}

function readVarInt(buf, off) {
  let value = 0, shift = 0, i = off;
  for (;;) {
    const b = buf[i++];
    value |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
    if (shift > 35) throw new Error('varint largo');
  }
  return { value, off: i };
}

function packet(id, data) {
  const body = [];
  writeVarInt(id, body);
  for (const b of data) body.push(b);
  const head = [];
  writeVarInt(body.length, head);
  return Buffer.from([...head, ...body]);
}

function strBytes(s) {
  const b = Buffer.from(s, 'utf8');
  const head = [];
  writeVarInt(b.length, head);
  return Buffer.concat([Buffer.from(head), b]);
}

function chatToText(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  let t = c.text || c.translate || '';
  for (const e of c.extra || []) t += chatToText(e);
  return t;
}

// Ping de estado estilo Minecraft (handshake + status). Sin auth.
function ping(host, port = 25565, timeoutMs = 5000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port }, () => {
      const addr = [];
      writeVarInt(47, addr);
      const hs = Buffer.concat([
        Buffer.from(addr),
        strBytes(host),
        (() => { const b = Buffer.alloc(2); b.writeUInt16BE(port); return b; })(),
        Buffer.from([1]),
      ]);
      sock.write(packet(0, [...hs]));
      sock.write(packet(0, []));
    });
    let buf = Buffer.alloc(0);
    const done = (fn, v) => { try { sock.destroy(); } catch {} fn(v); };
    const timer = setTimeout(() => done(reject, new Error('Tiempo agotado')), timeoutMs);
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        let off = 0;
        const l = readVarInt(buf, off); off = l.off;
        const p = readVarInt(buf, off); off = p.off;
        if (p.value !== 0) return;
        const s = readVarInt(buf, off); off = s.off;
        const json = JSON.parse(buf.slice(off, off + s.value).toString('utf8'));
        clearTimeout(timer);
        done(resolve, {
          online: true,
          latencyMs: Date.now() - t0,
          version: json.version?.name || null,
          protocol: json.version?.protocol ?? null,
          players: { online: json.players?.online ?? null, max: json.players?.max ?? null },
          motd: chatToText(json.description).slice(0, 200),
          favicon: json.favicon || null,
        });
      } catch {}
    });
    sock.on('error', (e) => { clearTimeout(timer); done(reject, e); });
    sock.on('close', () => { clearTimeout(timer); });
  });
}

function cfgPath(baseDir) {
  return path.join(baseDir, 'ferro-config.json');
}
function readCfg(baseDir) {
  try { return JSON.parse(fs.readFileSync(cfgPath(baseDir), 'utf8')); } catch { return {}; }
}
function writeCfg(baseDir, cfg) {
  fs.mkdirSync(path.dirname(cfgPath(baseDir)), { recursive: true });
  fs.writeFileSync(cfgPath(baseDir), JSON.stringify(cfg, null, 2));
}

function listServers(baseDir) {
  const cfg = readCfg(baseDir);
  return Array.isArray(cfg.servers) ? cfg.servers : [];
}

function addServer(baseDir, { name, host, port }) {
  const h = String(host || '').trim();
  if (!h) throw new Error('Falta el host');
  const p = Math.min(65535, Math.max(1, Number(port) || 25565));
  const cfg = readCfg(baseDir);
  cfg.servers = Array.isArray(cfg.servers) ? cfg.servers : [];
  if (cfg.servers.some((s) => s.host === h && s.port === p)) throw new Error('Ese servidor ya está');
  cfg.servers.push({ name: String(name || h).slice(0, 40), host: h, port: p });
  writeCfg(baseDir, cfg);
  return cfg.servers;
}

function removeServer(baseDir, host, port) {
  const cfg = readCfg(baseDir);
  cfg.servers = (Array.isArray(cfg.servers) ? cfg.servers : []).filter((s) => !(s.host === host && s.port === port));
  writeCfg(baseDir, cfg);
  return cfg.servers;
}

module.exports = { ping, listServers, addServer, removeServer, chatToText };
