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
  click: (m) => { tone({ f: 880, f2: 1318, t: 0.055, type: 'sine', v: 0.4, master: m }); tone({ f: 2637, t: 0.03, type: 'sine', v: 0.1, master: m }); },
  hover: (m) => tone({ f: 1568, t: 0.025, type: 'sine', v: 0.07, master: m }),
  success: (m) => { tone({ f: 659, t: 0.1, type: 'triangle', v: 0.5, master: m }); tone({ f: 784, t: 0.1, type: 'triangle', v: 0.5, delay: 0.08, master: m }); tone({ f: 988, t: 0.16, type: 'triangle', v: 0.55, delay: 0.16, master: m }); },
  error: (m) => { tone({ f: 233, f2: 110, t: 0.24, type: 'sine', v: 0.6, master: m }); tone({ f: 466, f2: 220, t: 0.18, type: 'triangle', v: 0.2, master: m }); },
  alarm: (m) => {
    for (let i = 0; i < 3; i++) {
      tone({ f: 620, f2: 310, t: 0.22, type: 'sawtooth', v: 0.5, delay: i * 0.28, master: m });
      tone({ f: 155, t: 0.22, type: 'square', v: 0.25, delay: i * 0.28, master: m });
    }
  },
  launch: (m) => { tone({ f: 220, f2: 1175, t: 0.42, type: 'triangle', v: 0.5, master: m }); tone({ f: 440, f2: 2350, t: 0.42, type: 'sine', v: 0.2, master: m }); tone({ f: 110, f2: 330, t: 0.4, type: 'sine', v: 0.35, master: m }); },
};
