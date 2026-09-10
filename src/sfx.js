// Packs de sonido sintetizados: Cristal (UI pro) y ASMR (taps, cuencos, aire).
// Cero assets, 100% offline, sin licencias de terceros.
const KEY = 'ferro-sfx';

function loadCfg() {
  try {
    return { enabled: true, volume: 0.5, hover: true, pack: 'cristal', ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch { return { enabled: true, volume: 0.5, hover: true, pack: 'cristal' }; }
}

export const PACKS = ['cristal', 'asmr'];

export const sfx = {
  cfg: loadCfg(),
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.cfg)); } catch {} },
  play(name) {
    if (!this.cfg.enabled || !PACK[this.cfg.pack]?.[name]) return;
    if (name === 'hover' && !this.cfg.hover) return;
    try { PACK[this.cfg.pack][name](this.cfg.volume); } catch {}
  },
};

let ctx = null;
let master = null;
let verb = null;
let noiseBuf = null;

function ac() {
  if (!window.AudioContext && !window.webkitAudioContext) return null;
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    ctx = new C();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    master = ctx.createGain();
    master.connect(comp).connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 1.1);
    const imp = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = imp.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    verb = ctx.createConvolver();
    verb.buffer = imp;
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    verb.connect(wet).connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function out(dry = 1) {
  const g = ctx.createGain();
  g.gain.value = dry;
  g.connect(master);
  g.connect(verb);
  return g;
}

function partial({ f, f2 = null, t = 0.2, type = 'sine', v = 0.5, delay = 0, master = 0.5, wet = 0.5, attack = 0.008 }) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(20, f), t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + t);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.001, v * master), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + t);
  const bus = out(1 - wet * 0.6);
  o.connect(g).connect(bus);
  o.start(t0);
  o.stop(t0 + t + 0.05);
}

function noise({ t = 0.05, hp = 1000, lp = null, bp = null, v = 0.5, delay = 0, master = 0.5, wet = 0.3, q = 0.8, attack = 0.004 }) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  s.playbackRate.value = 0.7 + Math.random() * 0.6;
  let node = s;
  const filt = (type, freq) => {
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    node.connect(f); node = f;
  };
  if (hp) filt('highpass', hp);
  if (lp) filt('lowpass', lp);
  if (bp) filt('bandpass', bp);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.001, v * master), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + t);
  const bus = out(1 - wet * 0.6);
  node.connect(g).connect(bus);
  s.start(t0);
  s.stop(t0 + t + 0.05);
}

const cristal = {
  click: (m) => {
    noise({ t: 0.03, hp: 3200, v: 0.5, master: m, wet: 0.2 });
    partial({ f: 2093, t: 0.09, type: 'sine', v: 0.32, master: m, wet: 0.6 });
    partial({ f: 1318, t: 0.07, type: 'triangle', v: 0.22, master: m, wet: 0.4 });
  },
  hover: (m) => partial({ f: 3136, t: 0.03, type: 'sine', v: 0.08, master: m, wet: 0.3 }),
  success: (m) => {
    partial({ f: 659, t: 0.5, type: 'sine', v: 0.5, master: m, wet: 0.7 });
    partial({ f: 784, t: 0.5, type: 'sine', v: 0.45, delay: 0.09, master: m, wet: 0.7 });
    partial({ f: 988, t: 0.6, type: 'sine', v: 0.5, delay: 0.18, master: m, wet: 0.7 });
    partial({ f: 1319, t: 0.7, type: 'sine', v: 0.25, delay: 0.18, master: m, wet: 0.8 });
  },
  error: (m) => {
    partial({ f: 147, f2: 82, t: 0.32, type: 'sine', v: 0.7, master: m, wet: 0.4 });
    noise({ t: 0.12, lp: 500, v: 0.4, master: m, wet: 0.3 });
    partial({ f: 294, f2: 165, t: 0.2, type: 'triangle', v: 0.2, master: m, wet: 0.4 });
  },
  launch: (m) => {
    const c = ac();
    if (c) {
      const t0 = c.currentTime;
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(160, t0);
      o.frequency.exponentialRampToValueAtTime(880, t0 + 0.45);
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = 4;
      f.frequency.setValueAtTime(300, t0);
      f.frequency.exponentialRampToValueAtTime(5200, t0 + 0.45);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.5 * m, t0 + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      const bus = out(0.7);
      o.connect(f).connect(g).connect(bus);
      o.start(t0); o.stop(t0 + 0.55);
    }
    partial({ f: 1760, f2: 3520, t: 0.4, type: 'sine', v: 0.16, master: m, wet: 0.8 });
    partial({ f: 110, f2: 220, t: 0.45, type: 'sine', v: 0.4, master: m, wet: 0.3 });
  },
  alarm: (m) => {
    for (let i = 0; i < 3; i++) {
      partial({ f: 620, f2: 310, t: 0.22, type: 'sawtooth', v: 0.4, delay: i * 0.28, master: m, wet: 0.3 });
      partial({ f: 155, t: 0.22, type: 'square', v: 0.2, delay: i * 0.28, master: m, wet: 0.2 });
    }
  },
  // Explosion: trueno grave + chasquido + estruendo
  boom: (m) => {
    partial({ f: 95, f2: 32, t: 0.5, type: 'sine', v: 0.9, master: m, wet: 0.25 });
    noise({ t: 0.35, lp: 900, v: 0.7, master: m, wet: 0.3 });
    noise({ t: 0.08, hp: 2500, v: 0.5, master: m, wet: 0.4 });
    partial({ f: 620, f2: 180, t: 0.18, type: 'sawtooth', v: 0.25, master: m, wet: 0.3 });
  },
  // Quien vuela: barrido ascendente + aire
  whoosh: (m) => {
    noise({ t: 0.5, bp: 800, v: 0.4, q: 1.2, master: m, wet: 0.5 });
    partial({ f: 180, f2: 720, t: 0.45, type: 'sine', v: 0.25, master: m, wet: 0.6 });
  },
  // Aterrizaje: campana doble cristalina
  chime: (m) => {
    partial({ f: 1319, t: 0.8, type: 'sine', v: 0.3, master: m, wet: 0.8 });
    partial({ f: 1760, t: 1.0, type: 'sine', v: 0.2, delay: 0.08, master: m, wet: 0.8 });
  },
  // Subida THX fiel a Moorer: 30 voces 200-400 Hz vagando y luego
  // desliz directo a la pila D mayor (3 por nota, 2 en graves).
  riser: (m) => {
    const targets = [73.42, 73.42, 110, 110, 146.83, 146.83, 220, 220, 220, 293.66, 293.66, 293.66, 369.99, 369.99, 369.99, 440, 440, 440, 587.33, 587.33, 587.33, 739.99, 739.99, 739.99, 880, 880, 880, 1174.66, 1174.66, 1174.66];
    targets.forEach((ft) => {
      const f0 = 200 + Math.random() * 200;
      const drift = f0 * (1 + (Math.random() - 0.5) * 0.06);
      const dt = ft * (1 + (Math.random() - 0.5) * 0.004);
      const deep = ft < 150;
      partial({ f: f0, f2: drift, t: 0.5, type: 'sine', v: 0.05, master: m, wet: 0.75, attack: 0.2 });
      partial({ f: drift, f2: dt, t: 1.05, type: deep ? 'triangle' : 'sine', v: deep ? 0.09 : 0.06, delay: 0.42, master: m, wet: 0.7, attack: 0.35 });
    });
    noise({ t: 1.2, bp: 600, v: 0.1, q: 1, master: m, wet: 0.6, attack: 0.3 });
  },
  // Golpe triple-forte: sub + acorde + crash + brillo
  deepHit: (m) => {
    partial({ f: 58, f2: 30, t: 1.1, type: 'sine', v: 0.9, master: m, wet: 0.25, attack: 0.005 });
    [147, 185, 220, 294, 370, 440].forEach((f) => {
      partial({ f, t: 1.2, type: 'sine', v: 0.22, master: m, wet: 0.7, attack: 0.005 });
    });
    noise({ t: 0.4, hp: 400, v: 0.55, master: m, wet: 0.35, attack: 0.003 });
    partial({ f: 2500, f2: 1800, t: 0.35, type: 'triangle', v: 0.15, master: m, wet: 0.6 });
  },
};

const asmr = {
  // Thock de tecla lineal lubricada: transitorio plástico + cuerpo grave
  click: (m) => keyHit(m, { f: 210, bright: 0.5 }),
  // Roce previo al punto de actuación: casi nada
  hover: (m) => noise({ t: 0.05, bp: 4200, v: 0.05, q: 3, master: m, wet: 0.5, attack: 0.015 }),
  // Teclear "ok": 4 golpes rítmicos ascendentes
  success: (m) => {
    [0, 1, 2, 3].forEach((i) => keyHit(m, { f: 200 + i * 28, bright: 0.45, delay: i * 0.11 }));
  },
  // Spacebar grave + ping de muelle
  error: (m) => {
    keyHit(m, { f: 130, bright: 0.35, deep: true });
    partial({ f: 3200, f2: 2900, t: 0.5, type: 'sine', v: 0.08, delay: 0.03, master: m, wet: 0.7, attack: 0.005 });
  },
  // Ráfaga de escritura + campana de retorno
  launch: (m) => {
    for (let i = 0; i < 7; i++) {
      keyHit(m, { f: 190 + Math.random() * 90, bright: 0.5, delay: i * 0.075 });
    }
    partial({ f: 1568, t: 0.7, type: 'sine', v: 0.2, delay: 0.55, master: m, wet: 0.8, attack: 0.01 });
  },
  // Machaqueo de teclas insistente
  alarm: (m) => {
    for (let i = 0; i < 8; i++) {
      keyHit(m, { f: 150 + Math.random() * 120, bright: 0.55, delay: i * 0.16 });
    }
  },
  // Explosion grave: golpe hondo + estruendo de escombro
  boom: (m) => {
    keyHit(m, { f: 95, bright: 0.4, deep: true });
    noise({ t: 0.4, lp: 700, v: 0.6, master: m, wet: 0.4 });
    noise({ t: 0.09, bp: 1800, v: 0.4, q: 1, master: m, wet: 0.3 });
  },
  // Aire que pasa + tecla grave de llegada
  whoosh: (m) => {
    noise({ t: 0.5, bp: 1100, v: 0.35, q: 1.4, master: m, wet: 0.6, attack: 0.02 });
    keyHit(m, { f: 140, bright: 0.3, deep: true, delay: 0.35 });
  },
  // Dos toques de cuenco
  chime: (m) => {
    partial({ f: 1568, t: 0.8, type: 'sine', v: 0.15, master: m, wet: 0.85, attack: 0.01 });
    partial({ f: 2093, t: 0.9, type: 'sine', v: 0.12, delay: 0.1, master: m, wet: 0.85, attack: 0.01 });
  },
  // Subida suave: 12 voces vagando hacia el acorde
  riser: (m) => {
    [73.42, 110, 146.83, 220, 293.66, 369.99, 440, 587.33, 739.99, 880, 587.33, 293.66].forEach((ft, i) => {
      const f0 = 200 + Math.random() * 200;
      const dt = ft * (1 + (Math.random() - 0.5) * 0.004);
      partial({ f: f0, f2: dt, t: 1.2, type: 'sine', v: 0.07, delay: i * 0.02, master: m, wet: 0.85, attack: 0.25 });
    });
    noise({ t: 1.1, bp: 500, v: 0.12, q: 1.4, master: m, wet: 0.75, attack: 0.3 });
  },
  // Llegada honda: golpe grave + acorde + aire
  deepHit: (m) => {
    keyHit(m, { f: 70, bright: 0.3, deep: true });
    [147, 220, 294].forEach((f, i) => {
      partial({ f, t: 1.1, type: 'sine', v: 0.16, delay: i * 0.02, master: m, wet: 0.75, attack: 0.008 });
    });
    noise({ t: 0.35, lp: 900, v: 0.4, master: m, wet: 0.5, attack: 0.005 });
  },
};

// Golpe de tecla humanizado: cada pulsación varía un poco como unos dedos de verdad
function keyHit(master, { f = 210, bright = 0.5, deep = false, delay = 0 } = {}) {
  const j = () => 1 + (Math.random() - 0.5) * 0.09;
  noise({ t: 0.035, bp: 2600 * j(), v: 0.5 * bright, q: 1.1, delay, master, wet: 0.35, attack: 0.002 });
  partial({ f: f * j(), f2: f * 0.72, t: deep ? 0.22 : 0.13, type: 'sine', v: deep ? 0.65 : 0.5, delay, master, wet: 0.45, attack: 0.004 });
  partial({ f: f * 3.02 * j(), t: 0.05, type: 'triangle', v: 0.1, delay, master, wet: 0.5, attack: 0.002 });
}

const PACK = { cristal, asmr };
