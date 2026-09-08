const COLORS = { info: 0xffb62e, ok: 0x34d399, error: 0xf87171 };

async function notify(baseDir, kind, title, desc) {
  let cfg = {};
  try {
    cfg = JSON.parse(require('fs').readFileSync(require('path').join(baseDir, 'ferro-config.json'), 'utf8'));
  } catch { return false; }
  const url = cfg.discordWebhook || '';
  if (!url || cfg.discordWebhookOff) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'FerroLauncher',
        embeds: [{ title: title.slice(0, 200), description: String(desc || '').slice(0, 1500), color: COLORS[kind] || COLORS.info, timestamp: new Date().toISOString() }],
      }),
    });
    return res.ok;
  } catch { return false; }
}

module.exports = { notify };
