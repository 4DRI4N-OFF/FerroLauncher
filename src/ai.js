// Cliente Gemini (Google AI Studio, capa gratuita): chat + listado de modelos.
// La clave la pone el usuario en la pestana IA y se guarda solo en su PC.
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

async function jfetch(url, opts) {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j?.error?.message || `HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return j;
}

// Mapea un fallo a clave de i18n ('ai.errKey' | 'ai.errQuota' | 'ai.errNet' | 'ai.errOther').
export function aiErrorKey(e) {
  if (e?.status === 400 || e?.status === 403) return 'ai.errKey';
  if (e?.status === 429) return 'ai.errQuota';
  if (e?.status === 404) return 'ai.errModel';
  const m = String(e?.message || '').toLowerCase();
  if (/quota|rate|resource_exhausted|rate limit/i.test(m)) return 'ai.errQuota';
  if (/api key|api_key|key/i.test(m) && /invalid|incorrect|expired|permission/i.test(m)) return 'ai.errKey';
  if (/failed to fetch|network|load failed|abort/i.test(m)) return 'ai.errNet';
  return 'ai.errOther';
}

export async function geminiModels(key) {
  const j = await jfetch(`${BASE}/models?key=${encodeURIComponent(key)}`);
  return (j.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({ id: String(m.name || '').replace(/^models\//, ''), label: m.displayName || m.name }));
}

// history: [{role:'user'|'ai', text}]. Devuelve el texto de respuesta.
export async function geminiChat({ key, model, system, history }) {
  const contents = (history || []).map((h) => ({
    role: h.role === 'ai' ? 'model' : 'user',
    parts: [{ text: String(h.text || '').slice(0, 8000) }],
  }));
  const j = await jfetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
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
