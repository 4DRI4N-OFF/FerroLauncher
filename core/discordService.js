let client = null;
let clientIdUsed = null;

const APP_URL = 'https://github.com/4DRI4N-OFF/FerroLauncher/releases/latest';

async function connect(clientId, onLog) {
  if (!clientId) return null;
  if (client && clientIdUsed === clientId) return client;
  disconnect();
  try {
    const RPC = require('discord-rpc');
    const c = new RPC.Client({ transport: 'ipc' });
    await c.login({ clientId });
    client = c;
    clientIdUsed = clientId;
    return c;
  } catch (e) {
    onLog && onLog(`[ferro] discord no disponible (${e.message?.slice(0, 80)}) — sigo sin RPC\n`);
    client = null;
    return null;
  }
}

function isConnected() {
  return !!(client && clientIdUsed);
}

function base(version) {
  return {
    largeImageKey: 'logo',
    largeImageText: version ? `FerroLauncher v${version}` : 'FerroLauncher',
    buttons: [{ label: 'Descargar FerroLauncher', url: APP_URL }],
  };
}

// Reposo: visible con solo abrir el launcher.
async function setIdle(clientId, { username, count, version, startedAt }, onLog) {
  const c = await connect(clientId, onLog);
  if (!c) return;
  const n = Number(count) || 0;
  try {
    await c.setActivity({
      ...base(version),
      details: 'En el launcher',
      state: `${username || 'offline'} · ${n} instancia${n === 1 ? '' : 's'}`,
      startTimestamp: startedAt || Date.now(),
    });
  } catch (e) {
    onLog && onLog(`[ferro] discord: ${e.message?.slice(0, 80)}\n`);
  }
}

async function setPlaying(clientId, { version, instance, loader, username, appVer, extra, startedAt }, onLog) {
  const c = await connect(clientId, onLog);
  if (!c) return;
  try {
    await c.setActivity({
      ...base(appVer),
      details: `Minecraft ${version}`,
      state: `${instance}${loader && loader !== 'vanilla' ? ` · ${loader}` : ''} — ${username}${extra ? ` · ${extra}` : ''}`,
      startTimestamp: startedAt || Date.now(),
    });
  } catch (e) {
    onLog && onLog(`[ferro] discord: ${e.message?.slice(0, 80)}\n`);
  }
}

function clear() {
  try { client && client.clearActivity(); } catch {}
}

function disconnect() {
  try { client && client.destroy(); } catch {}
  client = null;
  clientIdUsed = null;
}

module.exports = { connect, isConnected, setIdle, setPlaying, clear, disconnect };
