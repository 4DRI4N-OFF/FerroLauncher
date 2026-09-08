let client = null;
let clientIdUsed = null;

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

async function setPlaying(clientId, { version, instance, loader, username }, onLog) {
  const c = await connect(clientId, onLog);
  if (!c) return;
  try {
    await c.setActivity({
      details: `Minecraft ${version}`,
      state: `${instance}${loader && loader !== 'vanilla' ? ` · ${loader}` : ''} — ${username}`,
      startTimestamp: Date.now(),
      largeImageKey: 'logo',
      largeImageText: 'FerroLauncher',
      instance: false,
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

module.exports = { connect, setPlaying, clear, disconnect };
