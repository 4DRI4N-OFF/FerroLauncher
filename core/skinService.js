const MC_PROFILE = 'https://api.minecraftservices.com/minecraft/profile';

function renders(uuid) {
  const raw = String(uuid || '').replace(/-/g, '');
  return {
    face: `https://visage.surgeplay.com/face/64/${raw}`,
    head: `https://visage.surgeplay.com/head/128/${raw}`,
    full: `https://visage.surgeplay.com/full/512/${raw}`,
    skin: `https://visage.surgeplay.com/skin/512/${raw}`,
    fallbackFace: `https://minotar.net/helm/${raw}/100.png`,
  };
}

async function authed(mcToken, method = 'GET', body) {
  const res = await fetch(MC_PROFILE + (method === 'DELETE' ? '/skins/active' : method === 'POST' ? '/skins' : ''), {
    method,
    headers: { Authorization: `Bearer ${mcToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) throw new Error('Sin perfil de Minecraft en esta cuenta');
  if (!res.ok) throw new Error(`Mojang HTTP ${res.status}`);
  return method === 'DELETE' ? true : res.json();
}

async function applySkin(mcToken, { variant, url }) {
  if (!/^https:\/\/.+/.test(url || '')) throw new Error('URL de textura no válida (debe ser https)');
  if (!['classic', 'slim'].includes(variant)) throw new Error('Modelo: classic o slim');
  const p = await authed(mcToken, 'POST', { variant, url });
  return summarize(p);
}

async function resetSkin(mcToken) {
  await authed(mcToken, 'DELETE');
  return true;
}

function summarize(profile) {
  const skin = (profile.skins || []).find((s) => s.state === 'ACTIVE') || {};
  const cape = (profile.capes || []).find((c) => c.state === 'ACTIVE') || null;
  return {
    name: profile.name, uuid: profile.id,
    variant: skin.variant || 'classic', skinUrl: skin.url || null,
    cape: cape ? { id: cape.id, url: cape.url, alias: cape.alias } : null,
    renders: renders(profile.id),
  };
}

// Offline: intenta resolver nombre -> uuid para previsualizar (solo premium)
async function resolveUuid(name) {
  try {
    const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    return (await res.json()).id || null;
  } catch { return null; }
}

module.exports = { renders, applySkin, resetSkin, summarize, resolveUuid, profile: (t) => authed(t).then(summarize) };
