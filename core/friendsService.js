// Sistema de amigos del FerroLauncher.
// - Lista local en ferro-config.json (nick + uuid premium + cara).
// - Presencia real: nick visible en el sample de tus servidores (ping).
// - Essential Mod: solo deteccion (sin API publica no se puede leer su lista);
//   si esta instalado, el juego gestiona invitaciones desde su menu Social.
const fs = require('fs');
const path = require('path');
const skins = require('./skinService');
const srv = require('./serverService');

function cfgPath(baseDir) { return path.join(baseDir, 'ferro-config.json'); }
function readCfg(baseDir) {
  try { return JSON.parse(fs.readFileSync(cfgPath(baseDir), 'utf8')); } catch { return {}; }
}
function writeCfg(baseDir, cfg) {
  fs.mkdirSync(path.dirname(cfgPath(baseDir)), { recursive: true });
  fs.writeFileSync(cfgPath(baseDir), JSON.stringify(cfg, null, 2));
}

function listFriends(baseDir) {
  const cfg = readCfg(baseDir);
  return Array.isArray(cfg.friends) ? cfg.friends : [];
}

async function addFriend(baseDir, { name }) {
  const nick = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) throw new Error('Nick inválido (3-16 caracteres: letras, números, _)');
  const cfg = readCfg(baseDir);
  cfg.friends = Array.isArray(cfg.friends) ? cfg.friends : [];
  if (cfg.friends.some((f) => String(f.name).toLowerCase() === nick.toLowerCase())) {
    throw new Error('Ese amigo ya está en tu lista');
  }
  const uuid = await skins.resolveUuid(nick); // null si no es premium o sin red
  if (!uuid) throw new Error('Solo se pueden añadir cuentas premium de Minecraft');
  let face = `https://minotar.net/helm/${encodeURIComponent(nick)}/100.png`;
  try {
    const r = uuid ? skins.renders(uuid) : null;
    if (r && r.fallbackFace) face = r.fallbackFace;
    else if (uuid) face = `https://minotar.net/helm/${uuid}/100.png`;
  } catch {}
  cfg.friends.push({ name: nick, uuid: uuid || null, face, addedAt: Date.now() });
  writeCfg(baseDir, cfg);
  return cfg.friends;
}

function removeFriend(baseDir, { name }) {
  const nick = String(name || '').toLowerCase();
  const cfg = readCfg(baseDir);
  cfg.friends = (Array.isArray(cfg.friends) ? cfg.friends : []).filter((f) => String(f.name).toLowerCase() !== nick);
  writeCfg(baseDir, cfg);
  return cfg.friends;
}

// Marca online a los amigos visibles en tus servidores (nombres del sample).
async function presence(baseDir) {
  const cfg = readCfg(baseDir);
  const servers = Array.isArray(cfg.servers) ? cfg.servers : [];
  const friends = listFriends(baseDir).map((f) => ({ ...f, status: 'offline', server: null }));
  if (!friends.length || !servers.length) return friends;
  const byName = new Map(friends.map((f) => [String(f.name).toLowerCase(), f]));
  await Promise.all(servers.map(async (s) => {
    try {
      const r = await srv.ping(String(s.host), Number(s.port) || 25565);
      for (const n of (r && r.players && r.players.sample) || []) {
        const f = byName.get(String(n).toLowerCase());
        if (f) { f.status = 'online'; f.server = s.name || `${s.host}:${s.port}`; }
      }
    } catch {}
  }));
  return friends;
}

// Jars de Essential en la carpeta mods de una instancia (rutas de instancia).
function essentialScan(instancePath) {
  try {
    const mods = path.join(String(instancePath), 'mods');
    return fs.readdirSync(mods).filter((f) => /essential/i.test(f) && f.toLowerCase().endsWith('.jar'));
  } catch { return []; }
}

module.exports = { listFriends, addFriend, removeFriend, presence, essentialScan };
