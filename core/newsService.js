// Noticias oficiales de Mojang.
// Fuente viva: sitemap de minecraft.net + meta tags de cada artículo.
// (launchercontent.mojang.com/news.json murió en 2024: solo es reserva.)
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };
const LEGACY = 'https://launchercontent.mojang.com';

let cache = { at: 0, data: null };
const TTL = 6 * 3600000;

async function fetchText(url, timeoutMs = 25000) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: UA, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(to); }
}

function meta(html, prop) {
  const m = html.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]*>', 'i'));
  if (!m) return null;
  const c = m[0].match(/content=["']([^"']*)["']/i);
  return c ? c[1] : null;
}

function clean(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function categoryOf(url, title) {
  const s = `${url} ${title}`.toLowerCase();
  if (/snapshot|pre-release|release-candidate|preview/.test(s)) return 'Minecraft: Java Edition';
  if (/realms/.test(s)) return 'Realms';
  if (/marketplace/.test(s)) return 'Marketplace';
  if (/dungeons/.test(s)) return 'Minecraft Dungeons';
  if (/bedrock/.test(s)) return 'Minecraft: Bedrock';
  return 'Minecraft';
}

async function liveNews(limit = 12) {
  const sm = await fetchText('https://www.minecraft.net/sitemap.xml', 90000);
  const pairs = [...sm.matchAll(/<loc>(https:\/\/www\.minecraft\.net\/en-us\/article\/[^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)]
    .map((m) => ({ u: m[1], d: m[2] }));
  pairs.sort((a, b) => b.d.localeCompare(a.d));
  const out = [];
  const top = pairs.slice(0, Math.min(24, Math.max(1, limit)));
  for (let i = 0; i < top.length; i += 4) {
    const chunk = await Promise.all(top.slice(i, i + 4).map(async (p) => {
      try {
        const html = await fetchText(p.u);
        const title = clean(meta(html, 'og:title'));
        if (!title) return null;
        return {
          id: p.u, title,
          category: categoryOf(p.u, title),
          date: (meta(html, 'article:published_time') || p.d || '').slice(0, 10),
          text: clean(meta(html, 'og:description')),
          image: meta(html, 'og:image'),
          url: p.u,
        };
      } catch { return null; }
    }));
    for (const e of chunk) if (e) out.push(e);
  }
  return out;
}

async function legacyNews(limit = 12) {
  const res = await fetch(`${LEGACY}/news.json`, { headers: UA });
  if (!res.ok) throw new Error(`Mojang HTTP ${res.status}`);
  const j = await res.json();
  return (j.entries || []).slice(0, limit).map((e) => ({
    id: e.id || e.title,
    title: e.title || '',
    category: e.category || '',
    date: e.date || '',
    text: e.text || '',
    image: e.newsPageImage?.url ? LEGACY + e.newsPageImage.url : null,
    url: e.readMoreLink || 'https://www.minecraft.net/articles',
  }));
}

async function getNews(limit = 12) {
  if (cache.data && Date.now() - cache.at < TTL) return cache.data;
  try {
    const entries = await liveNews(limit);
    if (!entries.length) throw new Error('vacío');
    cache = { at: Date.now(), data: { updated: Date.now(), entries, live: true } };
  } catch (e) {
    if (cache.data) return cache.data;
    const entries = await legacyNews(limit);
    cache = { at: 0, data: { updated: Date.now(), entries, live: false } };
  }
  return cache.data;
}

module.exports = { getNews };
