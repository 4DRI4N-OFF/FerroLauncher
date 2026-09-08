// Efectos sintetizados con WebAudio: cero assets, estilo arcade sutil.
const KEY = 'ferro-sfx';

function loadCfg() {
  try {
    return { enabled: true, volume: 0.5, hover: true, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch { return { enabled: true, volume: 0.5, hover: true }; }
}

export const sfx = {
  cfg: loadCfg(),
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.cfg)); } catch {} },
  play(name) {
    if (!this.cfg.enabled || !RECIPES[name]) return;
    if (name === 'hover' && !this.cfg.hover) return;
    try { RECIPES[name](this.cfg.volume); } catch {}
  },
};

let ctx = null;
function tone({ f = 600, f2 = null, t = 0.08, type = 'sine', v = 1, delay = 0, master = 0.5 }) {
  if (!window.AudioContext && !window.webkitAudioContext) return;
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  const c = ctx;
  const o = c.createOscillator();
  const g = c.createGain();
  const t0 = c.currentTime + delay;
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + t);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.001, v * master), t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + t);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + t + 0.02);
}

const RECIPES = {
  click: (m) => tone({ f: 640, f2: 880, t: 0.07, type: 'triangle', v: 0.5, master: m }),
  hover: (m) => tone({ f: 980, t: 0.035, type: 'sine', v: 0.12, master: m }),
  success: (m) => { tone({ f: 523, t: 0.09, v: 0.6, master: m }); tone({ f: 784, t: 0.12, v: 0.6, delay: 0.09, master: m }); },
  error: (m) => tone({ f: 190, f2: 130, t: 0.18, type: 'sawtooth', v: 0.4, master: m }),
  launch: (m) => { tone({ f: 280, f2: 920, t: 0.35, type: 'triangle', v: 0.55, master: m }); tone({ f: 140, f2: 460, t: 0.35, type: 'sine', v: 0.4, master: m }); },
};
