// Asistente IA (Gemini). La clave vive en ferro-config.json del usuario
// (userData) o en GEMINI_KEY: nunca se expone su valor al renderer,
// solo se responde si hay clave y se chatea desde el proceso principal.
const fs = require('fs');
const path = require('path');

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

function cfgPath(baseDir) {
  return path.join(baseDir, 'ferro-config.json');
}
function readCfg(baseDir) {
  try { return JSON.parse(fs.readFileSync(cfgPath(baseDir), 'utf8')); } catch { return {}; }
}
function getKey(baseDir) {
  return process.env.GEMINI_KEY || readCfg(baseDir).geminiKey || '';
}
function hasKey(baseDir) {
  return !!getKey(baseDir);
}

async function gj(url, opts) {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j?.error?.message || `HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return j;
}

async function models(baseDir) {
  const key = getKey(baseDir);
  if (!key) throw new Error('no-key');
  const j = await gj(`${BASE}/models?key=${encodeURIComponent(key)}`);
  return (j.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({ id: String(m.name || '').replace(/^models\//, ''), label: m.displayName || m.name }));
}

async function chat(baseDir, { model, system, history }) {
  const key = getKey(baseDir);
  if (!key) throw new Error('no-key');
  const contents = (history || []).map((h) => ({
    role: h.role === 'ai' ? 'model' : 'user',
    parts: [{ text: String(h.text || '').slice(0, 8000) }],
  }));
  const j = await gj(`${BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: system ? { parts: [{ text: system }] } : undefined,
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
    }),
  });
  if (j.promptFeedback?.blockReason) throw new Error('blocked: ' + j.promptFeedback.blockReason);
  const parts = j.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p) => p.text || '').join('').trim();
  if (!text) throw new Error('empty');
  return text;
}

module.exports = { hasKey, models, chat };
