// Logros in-game: vigila advancements/stats de los mundos locales mientras juegas.
// Sin mods: Minecraft Java ya escribe esos JSON. En servidores no aplica
// (los avances los guarda el servidor, no tu PC).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFS = [
  { id: 'piedra', icon: '⛏️', adv: ['minecraft:story/mine_stone'],
    es: ['Primera piedra', 'Pica piedra por primera vez'], en: ['First stone', 'Mine stone for the first time'] },
  { id: 'mejora', icon: '🛠️', adv: ['minecraft:story/upgrade_tools'],
    es: ['Hora de mejorar', 'Fabrica un pico de piedra'], en: ['Getting an upgrade', 'Craft a stone pickaxe'] },
  { id: 'fundicion', icon: '🔥', adv: ['minecraft:story/smelt_iron'],
    es: ['Al rojo vivo', 'Funde hierro en el horno'], en: ['Hot stuff', 'Smelt iron in a furnace'] },
  { id: 'blindado', icon: '🛡️', adv: ['minecraft:story/obtain_armor'],
    es: ['Blindado', 'Ponte una armadura de hierro completa'], en: ['Suited up', 'Wear a full iron armor set'] },
  { id: 'lava', icon: '🪣', adv: ['minecraft:story/lava_bucket'],
    es: ['Cubo de lava', 'Guarda lava en un cubo'], en: ['Hot tub', 'Carry lava in a bucket'] },
  { id: 'hierro', icon: '⚔️', adv: ['minecraft:story/iron_tools'],
    es: ['Hierro total', 'Equípate entero de hierro'], en: ['Full iron', 'Gear up fully in iron'] },
  { id: 'diamante', icon: '💎', adv: ['minecraft:story/mine_diamond'],
    es: ['¡Diamantes!', 'Encuentra tu primer diamante'], en: ['Diamonds!', 'Find your first diamond'] },
  { id: 'fiebre', icon: '💰', stats: [['minecraft:mined', 'minecraft:diamond_ore', 10], ['minecraft:mined', 'minecraft:deepslate_diamond_ore', 10]],
    es: ['Fiebre del diamante', 'Pica 10 menas de diamante'], en: ['Diamond fever', 'Mine 10 diamond ores'] },
  { id: 'nether', icon: '🔥', adv: ['minecraft:story/enter_the_nether'],
    es: ['Al Nether', 'Cruza el portal'], en: ['Into the Nether', 'Step through the portal'] },
  { id: 'fortaleza', icon: '🏰', adv: ['minecraft:nether/find_fortress'],
    es: ['Fortaleza', 'Adéntrate en una fortaleza del Nether'], en: ['Fortress', 'Enter a Nether fortress'] },
  { id: 'blaze', icon: '🔥', adv: ['minecraft:nether/obtain_blaze_rod'],
    es: ['Cazablazes', 'Consigue una vara de blaze'], en: ['Blaze hunter', 'Grab a blaze rod'] },
  { id: 'devuelto', icon: '🎯', adv: ['minecraft:nether/return_to_sender'],
    es: ['Devuelto al remitente', 'Mata un ghast con su propia bola'], en: ['Return to sender', 'Kill a ghast with its own fireball'] },
  { id: 'encantar', icon: '📖', adv: ['minecraft:story/enchant_item'],
    es: ['Hechicero', 'Encanta un objeto en la mesa'], en: ['Enchanter', 'Enchant an item at the table'] },
  { id: 'cura', icon: '🧟', adv: ['minecraft:story/cure_zombie_villager'],
    es: ['Doctor zombi', 'Cura a un aldeano zombi'], en: ['Zombie doctor', 'Cure a zombie villager'] },
  { id: 'trato', icon: '🤝', adv: ['minecraft:adventure/trade'],
    es: ['Buen trato', 'Comercia con un aldeano'], en: ['What a deal', 'Trade with a villager'] },
  { id: 'franco', icon: '🏹', adv: ['minecraft:adventure/sniper_duel'],
    es: ['Francotirador', 'Mata un esqueleto a 50 metros'], en: ['Sniper duel', 'Kill a skeleton from 50 meters'] },
  { id: 'mascota', icon: '🐺', adv: ['minecraft:husbandry/tame_an_animal'],
    es: ['Mejor amigo', 'Doma un animal'], en: ['Best friends', 'Tame an animal'] },
  { id: 'granja', icon: '🐄', adv: ['minecraft:husbandry/breed_an_animal'],
    es: ['Granjero', 'Cría dos animales'], en: ['Farmer', 'Breed two animals'] },
  { id: 'end', icon: '👁️', adv: ['minecraft:story/enter_the_end'],
    es: ['El Fin', 'Entra al End'], en: ['The End', 'Enter the End'] },
  { id: 'dragon', icon: '🐉', adv: ['minecraft:end/kill_dragon'],
    es: ['Matadragones', 'Acaba con la dragona'], en: ['Dragon slayer', 'Defeat the dragon'] },
  { id: 'huevo', icon: '🥚', adv: ['minecraft:end/dragon_egg'],
    es: ['El huevo', 'Hazte con el huevo de dragón'], en: ['The egg', 'Claim the dragon egg'] },
  { id: 'elitros', icon: '🪂', adv: ['minecraft:end/elytra'],
    es: ['A volar', 'Consigue unos élitros'], en: ['Take off', 'Find elytra wings'] },
  { id: 'torpe', icon: '💀', stats: [['minecraft:custom', 'minecraft:deaths', 1]],
    es: ['Torpe', 'Muere por primera vez (a todos nos pasa)'], en: ['Clumsy', 'Die for the first time (happens to all)'] },
  { id: 'suelo', icon: '☠️', stats: [['minecraft:custom', 'minecraft:deaths', 25]],
    es: ['Amigo del suelo', 'Muere 25 veces'], en: ['Floor friend', 'Die 25 times'] },
  { id: 'hora', icon: '⏱️', stats: [['minecraft:custom', 'minecraft:play_time', 72000]],
    es: ['Una horita', 'Juega 1 hora en un mundo'], en: ['One hour', 'Play 1 hour in a world'] },
  { id: 'maraton', icon: '🏃', stats: [['minecraft:custom', 'minecraft:walk_one_cm', 100000]],
    es: ['Maratoniano', 'Camina 1 km'], en: ['Marathoner', 'Walk 1 km'] },
  { id: 'salto', icon: '🐇', stats: [['minecraft:custom', 'minecraft:jump', 1000]],
    es: ['Saltimbanqui', 'Salta 1000 veces'], en: ['Jumper', 'Jump 1000 times'] },
  { id: 'cazador', icon: '⚔️', stats: [['minecraft:custom', 'minecraft:mob_kills', 100]],
    es: ['Cazador', 'Derrota 100 criaturas'], en: ['Hunter', 'Defeat 100 mobs'] },
];

function storePath(baseDir) {
  return path.join(baseDir, 'achievements.json');
}
function readStore(baseDir) {
  try { return JSON.parse(fs.readFileSync(storePath(baseDir), 'utf8')); } catch { return {}; }
}
function normUuid(u) {
  const h = String(u || '').replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(h)) return '';
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function offlineUuid(name) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + String(name || '')).digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const s = h.toString('hex');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
function savesDir(instanceDir) {
  return path.join(instanceDir, 'saves');
}
// Une avances + stats de todos los mundos para un jugador.
function readProgress(instanceDir, uuid) {
  const done = new Set();
  const stats = {};
  let dir = null;
  try { dir = fs.readdirSync(savesDir(instanceDir), { withFileTypes: true }); } catch { return { done, stats }; }
  for (const w of dir) {
    if (!w.isDirectory()) continue;
    const wb = path.join(savesDir(instanceDir), w.name);
    try {
      const adv = JSON.parse(fs.readFileSync(path.join(wb, 'advancements', `${uuid}.json`), 'utf8'));
      for (const [k, v] of Object.entries(adv)) {
        if (v && v.done === true && !k.startsWith('DataVersion')) done.add(k);
      }
    } catch {}
    try {
      const st = JSON.parse(fs.readFileSync(path.join(wb, 'stats', `${uuid}.json`), 'utf8')).stats || {};
      for (const [cat, vals] of Object.entries(st)) {
        stats[cat] = stats[cat] || {};
        for (const [k, v] of Object.entries(vals)) {
          if (cat === 'minecraft:custom' || cat === 'minecraft:mined' || cat === 'minecraft:crafted' || cat === 'minecraft:killed' || cat === 'minecraft:picked_up') {
            stats[cat][k] = Math.max(stats[cat][k] || 0, Number(v) || 0);
          } else {
            stats[cat][k] = (stats[cat][k] || 0) + (Number(v) || 0);
          }
        }
      }
    } catch {}
  }
  return { done, stats };
}
function statVal(stats, cat, key) {
  return (stats[cat] && Number(stats[cat][key])) || 0;
}
function isUnlocked(def, prog) {
  if (def.adv && def.adv.some((id) => prog.done.has(id))) return true;
  if (def.stats && def.stats.some(([cat, key, min]) => statVal(prog.stats, cat, key) >= min)) return true;
  return false;
}
// Logro en vivo (puente): avances de servidor/mod que no estan en DEFS.
// Si coincide con uno base, enciende ese.
function unlockLive(baseDir, instanceName, advId, advName) {
  const store = readStore(baseDir);
  const hit = DEFS.find((d) => d.adv && d.adv.includes(advId));
  const key = `${instanceName}:${hit ? hit.id : advId}`;
  if (store[key]) return null;
  const entry = { ts: Date.now(), inst: instanceName, name: String(advName || advId) };
  store[key] = entry;
  try { fs.writeFileSync(storePath(baseDir), JSON.stringify(store, null, 2)); } catch {}
  return entry;
}
// Revisa y devuelve los recién desbloqueados (persistiendo).
function checkNew(baseDir, instanceDir, instanceName, username, uuid) {
  const id = normUuid(uuid) || offlineUuid(username);
  const prog = readProgress(instanceDir, id);
  const store = readStore(baseDir);
  const fresh = [];
  for (const def of DEFS) {
    const key = `${instanceName}:${def.id}`;
    if (store[key] || !isUnlocked(def, prog)) continue;
    store[key] = { ts: Date.now(), inst: instanceName };
    fresh.push(def);
  }
  if (fresh.length) {
    try { fs.writeFileSync(storePath(baseDir), JSON.stringify(store, null, 2)); } catch {}
  }
  return fresh;
}
function list(baseDir) {
  const store = readStore(baseDir);
  const byAdv = {};
  for (const [key, v] of Object.entries(store)) {
    const i = key.lastIndexOf(':');
    const adv = key.slice(i + 1);
    if (!byAdv[adv] || (v && v.ts && v.ts > (byAdv[adv].ts || 0))) byAdv[adv] = v;
  }
  return {
    defs: DEFS.map((d) => ({ id: d.id, icon: d.icon, es: d.es, en: d.en })),
    unlocked: byAdv,
    total: DEFS.length,
  };
}

module.exports = { DEFS, normUuid, offlineUuid, readProgress, checkNew, unlockLive, list };
