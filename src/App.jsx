import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import brand from './assets/brand.png';
import flMark from './assets/fl.png';
import { sfx } from './sfx.js';
import { geminiChat, geminiModels, aiErrorKey } from './ai.js';
import { STR, getLang } from './i18n.js';
import { GithubIcon, DiscordIcon, YoutubeIcon, XIcon } from './brands.jsx';
import Embers from './embers.jsx';
import DynamicIsland from './island.jsx';
import {
  Play, Square, Layers, Package, LayoutGrid, Gift, User, Palette,
  Settings, Search, Plus, RefreshCw, FolderOpen, Copy, Pencil, Trash2,
  Download, Upload, Check, X, AlertTriangle, Info, Camera,
  MessageCircle, ExternalLink, Server, Pin, PinOff,
} from 'lucide-react';

// Resortes al fijar/soltar la sidebar: los botones entran en cascada con muelle.
function springNav() {
  try {
    document.querySelectorAll('.side > button').forEach((b, i) => {
      try {
        b.animate([
          { transform: 'translateX(-10px)', opacity: 0.4 },
          { transform: 'translateX(4px)', opacity: 1 },
          { transform: 'translateX(0px)', opacity: 1 },
        ], { duration: 450, delay: i * 35, easing: 'cubic-bezier(.2,1.4,.4,1)' });
      } catch {}
    });
  } catch {}
}

// Resorte de Apple al hacer scroll: al llegar al tope, el contenido cede
// con resistencia y vuelve con muelle. Un solo listener global.
function initSpringScroll() {
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  } catch {}
  const state = new WeakMap();
  const MAX = 130;
  const onWheel = (e) => {
    if (e.ctrlKey) return;
    if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    const t = e.target;
    if (!(t instanceof Element)) return;
    const dir = e.deltaY < 0 ? -1 : 1;
    // Si alguien de la cadena puede hacer scroll en esta direccion, scroll nativo.
    let n = t, can = false, box = null;
    while (n && n !== document.documentElement) {
      if (n instanceof HTMLElement && n.scrollHeight > n.clientHeight + 1) {
        if (!box) box = n;
        if ((dir < 0 && n.scrollTop > 0) || (dir > 0 && n.scrollTop + n.clientHeight < n.scrollHeight - 1)) { can = true; break; }
      }
      n = n.parentElement;
    }
    if (can) return;
    // Rebota el contenido interior, nunca el panel: el marco queda fijo.
    let target = t.closest ? t.closest('.bounce, .modal-body, .log') : null;
    if (!target) {
      const scroller = t.closest ? t.closest('.main') : null;
      if (scroller && scroller.querySelector) { try { target = scroller.querySelector(':scope > .bounce'); } catch {} }
    }
    if (!target) return;
    box = target;
    e.preventDefault();
    let s = state.get(box);
    if (!s) { s = { raw: 0, pull: 0, timer: 0, back: 0, dir: 1 }; state.set(box, s); }
    clearTimeout(s.timer); clearTimeout(s.back);
    try { box.getAnimations().forEach((a) => a.cancel()); } catch {}
    box.style.transition = 'none';
    box.style.willChange = 'transform';
    // Resistencia exponencial: blando al empezar, duro al final (nada de bloque rigido).
    s.raw = Math.max(-MAX * 3, Math.min(MAX * 3, s.raw + e.deltaY * 0.5));
    s.pull = MAX * Math.tanh(s.raw / MAX);
    // Squash vertical anclado al borde: efecto gelatina (2D, sin recortes).
    const k = Math.min(1, Math.abs(s.pull) / MAX);
    s.dir = s.pull < 0 ? -1 : 1;
    const y = (-s.pull).toFixed(1), sy = (1 - 0.16 * k).toFixed(3);
    box.style.transformOrigin = s.dir < 0 ? '50% 0%' : '50% 100%';
    box.style.transform = `translateY(${y}px) scale(1,${sy})`;
    s.timer = setTimeout(() => {
      const p = s.pull, d = s.dir || 1; s.pull = 0; s.raw = 0;
      const done = () => { try { box.style.transform = ''; box.style.transformOrigin = ''; box.style.willChange = ''; } catch {} };
      if (Math.abs(p) < 8) { done(); return; }
      // Al soltar: gelatina que oscila apagandose (estira, aplasta, asienta).
      const kk = Math.min(1, Math.abs(p) / MAX);
      const org = d < 0 ? '50% 0%' : '50% 100%';
      const y0 = (-p).toFixed(1), sy0 = (1 - 0.16 * kk).toFixed(3);
      box.style.transform = '';
      box.style.transformOrigin = org;
      try {
        const ov = (parseFloat(y0) >= 0 ? -10 : 10).toFixed(0);
        box.animate([
          { transform: `translateY(${y0}px) scale(1,${sy0})`, transformOrigin: org, offset: 0 },
          { transform: `translateY(${ov}px) scale(1,1.14)`, transformOrigin: org, offset: 0.18, easing: 'cubic-bezier(.3,1.1,.4,1)' },
          { transform: 'translateY(0px) scale(1,0.92)', transformOrigin: org, offset: 0.4, easing: 'ease-in-out' },
          { transform: 'translateY(0px) scale(1,1.06)', transformOrigin: org, offset: 0.6, easing: 'ease-in-out' },
          { transform: 'translateY(0px) scale(1,0.98)', transformOrigin: org, offset: 0.8, easing: 'ease-in-out' },
          { transform: 'translateY(0px) scale(1,1)', transformOrigin: org, offset: 1, easing: 'ease-out' },
        ], { duration: 850 });
      } catch {}
      s.back = setTimeout(done, 900);
    }, 150);
  };
  document.addEventListener('wheel', onWheel, { passive: false, capture: true });
  return () => { try { document.removeEventListener('wheel', onWheel, { capture: true }); } catch {} };
}

// El recuadro del botón crece hasta convertirse en la ventana (morph ida y vuelta)
function MorphModal({ origin, closing, onClose, title, children }) {
  const boxRef = useRef(null);
  const ovRef = useRef(null);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || !origin) return;
    const r = box.getBoundingClientRect();
    const dx = origin.cx - (r.left + r.width / 2);
    const dy = origin.cy - (r.top + r.height / 2);
    const sx = Math.max(0.05, origin.w / r.width);
    const sy = Math.max(0.05, origin.h / r.height);
    box.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 1, borderRadius: '14px' },
      { transform: 'none', opacity: 1, borderRadius: '22px' },
    ], { duration: 700, easing: 'cubic-bezier(.65, 0, .35, 1)', fill: 'backwards' });
  }, []);
  useEffect(() => {
    if (!closing) return;
    const box = boxRef.current, ov = ovRef.current;
    if (ov) { ov.style.transition = 'opacity .25s ease'; ov.style.opacity = '0'; }
    if (box && origin) {
      const r = box.getBoundingClientRect();
      const dx = origin.cx - (r.left + r.width / 2);
      const dy = origin.cy - (r.top + r.height / 2);
      box.animate([
        { transform: 'none', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(${Math.max(0.05, origin.w / r.width)}, ${Math.max(0.05, origin.h / r.height)})`, opacity: 1 },
      ], { duration: 260, easing: 'cubic-bezier(.65, 0, .35, 1)', fill: 'forwards' });
    }
  }, [closing]);
  return (
    <div className="morph-overlay" ref={ovRef} onClick={onClose}>
      <div ref={boxRef} className="morph-box" onClick={(e) => e.stopPropagation()}>
        <div className="morph-head"><span className="card-title">{title}</span><button className="mini" onClick={onClose}><X size={12} /></button></div>
        <div className="morph-body">{children}</div>
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState('jugar');
  const [sideOpen, setSideOpen] = useState(false);
  const [sidePinned, setSidePinned] = useState(() => { try { return localStorage.getItem('ferro-sidepin') === '1'; } catch { return false; } });
  const sideBig = sideOpen || sidePinned;
  const firstTab = useRef(true);
  useEffect(() => {
    if (firstTab.current) { firstTab.current = false; return; }
    if (!sidePinned) setSideOpen(false);
  }, [tab, sidePinned]);
  const [lang, setLang] = useState(getLang());
  const t = (k, vars) => {
    let s = (STR[lang] && STR[lang][k]) || STR.es[k] || k;
    if (vars) for (const [kk, vv] of Object.entries(vars)) s = s.replace(`{${kk}}`, vv);
    return s;
  };
  const setLangBoth = (l) => { setLang(l); try { localStorage.setItem('ferro-lang', l); } catch {} };
  const fmtPlay = (s) => {
    const m = Math.floor((s || 0) / 60);
    if (!m) return null;
    return m < 60 ? `${m} min` : `${(m / 60).toFixed(m < 600 ? 1 : 0)} h`;
  };
  const [versions, setVersions] = useState([]);
  const [instances, setInstances] = useState([]);
  const [java, setJava] = useState(null);
  const [username, setUsername] = useState(() => { try { return localStorage.getItem('ferro-username') || ''; } catch { return ''; } });
  const [versionId, setVersionId] = useState('1.21.1');
  const [instanceName, setInstanceName] = useState('');
  const [instanceType, setInstanceType] = useState('vanilla');
  const [loaders, setLoaders] = useState([]);
  const [loaderVersion, setLoaderVersion] = useState('');
  const [modQuery, setModQuery] = useState('');
  const [modHits, setModHits] = useState([]);
  const [modTotal, setModTotal] = useState(0);
  const [fVersion, setFVersion] = useState('1.21.1');
  const [fLoader, setFLoader] = useState('fabric');
  const [fSort, setFSort] = useState('relevance');
  const [kind, setKind] = useState('mod');
  const kindName = kind === 'shader' ? 'shaders' : kind === 'resourcepack' ? 'resource packs' : 'mods';
  const [mods, setMods] = useState([]);
  const [modsFor, setModsFor] = useState('');
  const [searching, setSearching] = useState(false);
  const [installingId, setInstallingId] = useState(null);
  const [installedIds, setInstalledIds] = useState([]);
  const [source, setSource] = useState('mr');
  const [cfKeyInput, setCfKeyInput] = useState('');
  const [cfKeySet, setCfKeySet] = useState('');
  const [cfHits, setCfHits] = useState([]);
  const [cfTotal, setCfTotal] = useState(0);
  const [cfFiles, setCfFiles] = useState({});
  const [cfBusy, setCfBusy] = useState(null);
  const [updMap, setUpdMap] = useState({});
  const [checkingUpd, setCheckingUpd] = useState(false);
  const [updMsg, setUpdMsg] = useState('');
  const [rpOn, setRpOn] = useState(null);
  const [shaderCur, setShaderCur] = useState(null);
  const [packMc, setPackMc] = useState('1.21.1');
  const [packLoader, setPackLoader] = useState('');
  const [packSort, setPackSort] = useState('relevance');
  const [packTotal, setPackTotal] = useState(0);
  const [packQuery, setPackQuery] = useState('');
  const [packHits, setPackHits] = useState([]);
  const [packVers, setPackVers] = useState({});
  const [packBusy, setPackBusy] = useState(null);
  const [packSrc, setPackSrc] = useState('mr');
  const [cfPackVers, setCfPackVers] = useState({});
  const [cfPackBusy, setCfPackBusy] = useState(null);
  const [clientId, setClientId] = useState('');
  const [idInfo, setIdInfo] = useState({ masked: '', configured: false });
  const [account, setAccount] = useState(null);
  const [accts, setAccts] = useState([]);
  const [authStep, setAuthStep] = useState(null);
  const [browserWaiting, setBrowserWaiting] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const [appVer, setAppVer] = useState('');
  const [upd, setUpd] = useState({ state: 'idle' });
  const [sfxOn, setSfxOn] = useState(sfx.cfg.enabled);
  const [sfxVol, setSfxVol] = useState(sfx.cfg.volume);
  const [sfxHover, setSfxHover] = useState(sfx.cfg.hover);
  const [sfxPack, setSfxPack] = useState(sfx.cfg.pack || 'cristal');
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('ferro-theme') || 'ember'; } catch { return 'ember'; } });

  useEffect(() => {
    try {
      if (theme === 'ember') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('ferro-theme', theme);
    } catch {}
  }, [theme]);
  const [dcId, setDcId] = useState('');
  const [dcOn, setDcOn] = useState(true);
  const [dcHook, setDcHook] = useState('');
  const [social, setSocial] = useState({ github: '', discord: '', youtube: '' });
  useEffect(() => { window.ferro.social?.().then(setSocial).catch(()=>{}); }, []);
  const [toasts, setToasts] = useState([]);
  const [flashKey, setFlashKey] = useState(0);
  const [scare, setScare] = useState(null);
  const toastId = useRef(0);
  const touchedVer = useRef({ create: false, filter: false, pack: false });

  const pushToast = (type, msg, action) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, type, msg: String(msg).slice(0, 180), action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 8000 : 4500);
  };

  // Todo el log pasa por aquí: clasifica lo nuevo (error/éxito) para VFX+sonido
  const setLog = (updater) => {
    setLogRaw((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      const added = typeof next === 'string' ? next.slice(prev.length) : '';
      if (added) {
        const errLine = added.split('\n').find((ln) => /^\[error\]/.test(ln));
        if (errLine) {
          sfx.play('error');
          pushToast('error', errLine.replace(/^\[error\]\s*/, ''));
          setFlashKey((k) => k + 1);
        } else if (/lanzando\.\.\./.test(added)) sfx.play('launch');
        else if (/instalad[oa]|creada|iniciada|guardados|restaurada|importada|list[oa]|aplicada|restablecida/i.test(added)) sfx.play('success');
        if (/protocolo anti-suplantaci.n/i.test(added)) sfx.play('alarm');
        if (/Acceso DENEGADO/.test(added)) {
          const full = prev + added;
          const nm = (full.match(/NOMBRE PREMIUM DETECTADO:\s*(.+?)\s*!!/) || [])[1] || '???';
          const cs = (full.match(/(?:Reporte|Caso)\s+(F-[0-9A-F]+)/) || [])[1] || 'F-????';
          setScare({ name: nm.trim(), caseId: cs });
          setTimeout(() => setScare(null), 6000);
        }
        const crashM = added.match(/crash detectado en (.+?) \(código (\d+)\)/);
        if (crashM) {
          const [, instName] = crashM;
          pushToast('error', t('toast.crash', { n: instName }), {
            label: t('inst.view'),
            fn: () => { setTab('instancias'); setSettingsFor(instName); loadBackups(instName); loadCrashes(instName); },
          });
        }
      }
      return next;
    });
  };
  const [skinInfo, setSkinInfo] = useState(null);
  const [skinName, setSkinName] = useState('');
  const [skinUrl, setSkinUrl] = useState('');
  const [skinVariant, setSkinVariant] = useState('classic');
  const [skinBusy, setSkinBusy] = useState(false);
  const [bkList, setBkList] = useState([]);
  const [crList, setCrList] = useState([]);
  const [crOpen, setCrOpen] = useState(null);
  const [modalOrigin, setModalOrigin] = useState(null);
  const [modalClosing, setModalClosing] = useState(false);
  const [galName, setGalName] = useState('');
  const [galOrigin, setGalOrigin] = useState(null);
  const [galClosing, setGalClosing] = useState(false);
  const [galShots, setGalShots] = useState([]);
  const [intro, setIntro] = useState(true);
  const introImgRef = useRef(null);
  const sideLogoRef = useRef(null);
  const overlayRef = useRef(null);
  const pollRef = useRef(null);
  const [launchInstance, setLaunchInstance] = useState(() => { try { return localStorage.getItem('ferro-instance') || ''; } catch { return ''; } });
  useEffect(() => { try { localStorage.setItem('ferro-username', username); } catch {} }, [username]);
  useEffect(() => { try { if (launchInstance) localStorage.setItem('ferro-instance', launchInstance); } catch {} }, [launchInstance]);
  const [log, setLogRaw] = useState('[ferro] listo\n');
  const [playFace, setPlayFace] = useState(null);
  const [nameState, setNameState] = useState({ status: 'idle', suggestions: [] });
  const [tourIdx, setTourIdx] = useState(null);
  const [tourRect, setTourRect] = useState(null);

  const tourSteps = () => ([
    { tab: 'jugar', sel: '[data-tour="play"]', title: t('tour.s1t'), body: t('tour.s1x') },
    { tab: 'instancias', sel: '[data-tour="create"]', title: t('tour.s2t'), body: t('tour.s2x') },
    { tab: 'mods', sel: '[data-tour="mods-search"]', title: t('tour.s3t'), body: t('tour.s3x') },
    { tab: 'cuenta', sel: '[data-tour="account-login"]', title: t('tour.s4t'), body: t('tour.s4x') },
    { tab: 'ajustes', sel: '[data-tour="settings"]', title: t('tour.s5t'), body: t('tour.s5x') },
  ]);
  const startTour = () => setTourIdx(0);
  const endTour = () => { setTourIdx(null); setTourRect(null); try { localStorage.setItem('ferro-tour-done', '1'); } catch {} };

  useEffect(() => {
    if (tourIdx === null) return;
    const steps = tourSteps();
    const st = steps[tourIdx];
    if (!st) { endTour(); return; }
    if (tab !== st.tab) setTab(st.tab);
    const t1 = setTimeout(() => {
      const el = document.querySelector(st.sel);
      if (!el) { setTourRect(null); return; }
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      setTimeout(() => {
        const r = el.getBoundingClientRect();
        setTourRect({ x: r.left - 8, y: r.top - 8, w: r.width + 16, h: r.height + 16 });
      }, 250);
    }, 300);
    return () => clearTimeout(t1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourIdx, tab, lang]);

  // Auto-arranque solo la primera vez (tras la intro)
  useEffect(() => {
    let ok = false;
    try { ok = !localStorage.getItem('ferro-tour-done'); } catch {}
    if (!ok) return;
    const t1 = setTimeout(() => setTourIdx(0), 4500);
    return () => clearTimeout(t1);
  }, []);

  useEffect(() => {
    const name = (account?.name || username || '').trim();
    if (!name) { setPlayFace(null); return; }
    if (account) { setPlayFace(`https://visage.surgeplay.com/face/64/${account.uuid.replace(/-/g, '')}`); return; }
    const t = setTimeout(async () => {
      try {
        const s = await window.ferro.skin({ name });
        setPlayFace(s?.renders ? s.renders.face : null);
      } catch { setPlayFace(null); }
    }, 600);
    return () => clearTimeout(t);
  }, [username, account]);

  // Comprueba si el nombre offline está libre y sugiere alternativas
  useEffect(() => {
    if (account) { setNameState({ status: 'idle', suggestions: [] }); return; }
    const name = (username || '').trim();
    if (name.length < 3) { setNameState({ status: 'idle', suggestions: [] }); return; }
    setNameState({ status: 'checking', suggestions: [] });
    const t = setTimeout(async () => {
      try {
        const r = await window.ferro.nameCheck({ name });
        if (!r.valid) { setNameState({ status: 'invalid', suggestions: [] }); return; }
        if (r.unknown) { setNameState({ status: 'unknown', suggestions: [] }); return; }
        if (!r.premium) { setNameState({ status: 'free', suggestions: [] }); return; }
        const sug = await window.ferro.nameSuggest({ base: name }).catch(() => []);
        setNameState({ status: 'taken', suggestions: sug });
      } catch { setNameState({ status: 'unknown', suggestions: [] }); }
    }, 600);
    return () => clearTimeout(t);
  }, [username, account]);
  const [running, setRunning] = useState(false);
  const [logLevel, setLogLevel] = useState('todo');
  const [logSearch, setLogSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [settingsFor, setSettingsFor] = useState('');
  const [sRam, setSRam] = useState('2048');
  const [sW, setSW] = useState('854');
  const [sH, setSH] = useState('480');
  const [sJavaMode, setSJavaMode] = useState('auto');
  const [sJavaPath, setSJavaPath] = useState('');
  const [sJvm, setSJvm] = useState('equilibrado');
  const [verKind, setVerKind] = useState('release');
  const [diag, setDiag] = useState(null);
  const [impScan, setImpScan] = useState(null);
  const [servers, setServers] = useState([]);
  const [srvName, setSrvName] = useState('');
  const [srvHost, setSrvHost] = useState('');
  const [srvPort, setSrvPort] = useState('');
  const [srvPing, setSrvPing] = useState({});
  const [heroBg, setHeroBg] = useState(null);
  const [confirmDlg, setConfirmDlg] = useState(null);
  const [confirmInput, setConfirmInput] = useState('');
  const [loginFx, setLoginFx] = useState(0);
  const [flashFx, setFlashFx] = useState(0);
  const [exploding, setExploding] = useState(null);
  const boomCtl = useRef({ raf: 0, kill: 0 });
  // Limpia restos de explosiones anteriores (canvas huerfano con luz congelada).
  useEffect(() => { try { document.getElementById('boom-fx')?.remove(); } catch {} return initSpringScroll(); }, []);
  const celebrateLogin = () => {
    setLoginFx((k) => k + 1);
    setFlashFx((k) => k + 1);
    try {
      const el = document.querySelector('.player-chip');
      const r = el ? el.getBoundingClientRect() : { left: innerWidth / 2, top: 120, width: 0, height: 0 };
      confettiBurst(r.left + r.width / 2, r.top + r.height / 2);
    } catch {}
  };
  const confettiBurst = (x, y) => {
    let cv = document.getElementById('login-confetti');
    if (!cv) {
      cv = document.createElement('canvas');
      cv.id = 'login-confetti';
      document.body.appendChild(cv);
    }
    cv.width = innerWidth; cv.height = innerHeight;
    const ctx = cv.getContext('2d');
    const cols = ['#ffd166', '#34d399', '#ffffff', '#ffb62e', '#7ef0c1'];
    const ps = Array.from({ length: 90 }, () => ({
      x, y,
      vx: (Math.random() - 0.5) * 11, vy: Math.random() * -9 - 2,
      s: 3 + Math.random() * 5, r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3, c: cols[(Math.random() * cols.length) | 0],
      life: 1,
    }));
    let f = 0;
    const tick = () => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      let alive = false;
      for (const p of ps) {
        p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life -= 0.012;
        if (p.life > 0 && p.y < cv.height + 20) {
          alive = true;
          ctx.save(); ctx.globalAlpha = Math.max(0, p.life); ctx.translate(p.x, p.y); ctx.rotate(p.r);
          ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
          ctx.restore();
        }
      }
      if (alive && ++f < 300) requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, cv.width, cv.height);
    };
    tick();
  };
  // Explosión de tarjeta: destello + metralla + humo con piezas DOM animadas
  // por el compositor (WAAPI): va fluido incluso sin aceleracion de canvas.
  const boomBurst = (rect) => {
    const ctl = boomCtl.current;
    clearTimeout(ctl.kill || 0);
    try { document.getElementById('boom-fx')?.remove(); } catch {}
    const layer = document.createElement('div');
    layer.id = 'boom-fx';
    document.body.appendChild(layer);
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const cols = ['#fff7d6', '#ffd166', '#ffb62e', '#ff6e1e', '#ff3d00'];
    const flash = document.createElement('div');
    flash.className = 'boom-flash';
    flash.style.left = cx + 'px'; flash.style.top = cy + 'px';
    layer.appendChild(flash);
    try {
      flash.animate(
        [{ transform: 'translate(-50%,-50%) scale(.2)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 0 }],
        { duration: 450, easing: 'ease-out', fill: 'forwards' });
      for (let k = 0; k < 28; k++) {
        const s = document.createElement('div');
        s.className = 'boom-shard';
        const sz = 4 + Math.random() * 7;
        s.style.left = cx + 'px'; s.style.top = cy + 'px';
        s.style.width = sz.toFixed(1) + 'px'; s.style.height = (sz * (0.5 + Math.random() * 0.7)).toFixed(1) + 'px';
        s.style.background = cols[(Math.random() * cols.length) | 0];
        layer.appendChild(s);
        const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 170;
        s.animate(
          [{ transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 1 },
           { transform: `translate(calc(-50% + ${(Math.cos(a) * d).toFixed(1)}px), calc(-50% + ${(Math.sin(a) * d - 50).toFixed(1)}px)) rotate(${((Math.random() - 0.5) * 540).toFixed(0)}deg)`, opacity: 0 }],
          { duration: 600 + Math.random() * 500, easing: 'cubic-bezier(.15,.7,.3,1)', fill: 'forwards' });
      }
      for (let k = 0; k < 8; k++) {
        const m = document.createElement('div');
        m.className = 'boom-smoke';
        const sz = 26 + Math.random() * 40;
        m.style.left = (cx + (Math.random() - 0.5) * 90).toFixed(1) + 'px';
        m.style.top = (cy + (Math.random() - 0.5) * 40).toFixed(1) + 'px';
        m.style.width = sz.toFixed(1) + 'px'; m.style.height = sz.toFixed(1) + 'px';
        layer.appendChild(m);
        m.animate(
          [{ transform: 'translate(-50%,-50%) scale(.5)', opacity: 0.4 }, { transform: `translate(-50%,calc(-50% + ${(-80 - Math.random() * 70).toFixed(0)}px)) scale(1.4)`, opacity: 0 }],
          { duration: 1000 + Math.random() * 400, easing: 'ease-out', fill: 'forwards' });
      }
    } catch {}
    // Interruptor final: la capa desaparece a los 1.6 s pase lo que pase.
    ctl.kill = setTimeout(() => { try { document.getElementById('boom-fx')?.remove(); } catch {} }, 1600);
  };
  // Borrar con explosión: la tarjeta tiembla, brilla y revienta; luego se borra de verdad.
  const explodeInstance = (name, cardEl) => {
    try {
      const r = cardEl ? cardEl.getBoundingClientRect() : { left: innerWidth / 2 - 150, top: innerHeight / 2 - 100, width: 300, height: 200 };
      setExploding(name);
      sfx.play('boom');
      boomBurst(r);
    } catch {}
    setTimeout(async () => {
      try { await window.ferro.deleteInstance({ instanceName: name }); } catch {}
      setExploding(null);
      refresh();
    }, 760);
  };
  // --- Asistente IA ---
  const aiSystem = () => {
    const names = (instances || []).slice(0, 12).map((i) => `${i.name} (${i.versionId}${i.type !== 'vanilla' ? ' ' + i.type : ''})`).join(', ') || '—';
    const base = lang === 'en'
      ? 'You are the FerroLauncher assistant, a Minecraft Java launcher for Windows (Electron). Help with: Minecraft versions, loaders (Vanilla/Fabric/Quilt/Forge/NeoForge), Modrinth/CurseForge mods, shaders, Java and RAM, errors and crashes. Reply in English, short and direct, with concrete steps. If given console/log text, diagnose the likely cause.'
      : 'Eres el asistente de FerroLauncher, un launcher de Minecraft Java para Windows (Electron). Ayudas con: versiones de Minecraft, loaders (Vanilla/Fabric/Quilt/Forge/NeoForge), mods de Modrinth/CurseForge, shaders, Java y RAM, errores y cuelgues. Responde en español, breve y directo, con pasos concretos. Si te pegan consola o log, diagnostica la causa probable.';
    return `${base} Context: FerroLauncher v${appVer || '?'}, instances: ${names}.`;
  };
  const saveAiKey = async () => {
    const k = aiKeyInput.trim();
    if (!k) return;
    setAiKey(k);
    try { localStorage.setItem('ferro-ai-key', k); } catch {}
    setAiKeyInput('');
    pushToast('success', t('ai.keySaved'));
    loadAiModels(k);
  };
  const loadAiModels = async (k) => {
    if (aiBuiltIn && window.ferro?.aiModels) {
      try {
        const ms = await window.ferro.aiModels();
        if (ms.length) {
          setAiModels(ms);
          if (!ms.some((m) => m.id === aiModel)) {
            const stable = ms.filter((m) => !/preview|tts|image|transcribe|lyria|robotics|computer-use|antigravity|deep-research|nano-banana|gemma|latest$/i.test(m.id));
            const pick = stable.find((m) => /flash-lite/i.test(m.id)) || stable.find((m) => /flash/i.test(m.id)) || ms[0];
            setAiModel(pick.id);
            try { localStorage.setItem('ferro-ai-model', pick.id); } catch {}
          }
          pushToast('success', `${ms.length} ✓`);
        } else pushToast('error', t('ai.errOther'));
      } catch (e) { pushToast('error', t(aiErrorKey(e))); }
      return;
    }
    const key = (k || aiKey || '').trim();
    if (!key) { pushToast('error', t('ai.needKey')); return; }
    try {
      const ms = await geminiModels(key);
      if (ms.length) {
        setAiModels(ms);
        if (!ms.some((m) => m.id === aiModel)) {
          const pick = ms.find((m) => /flash/i.test(m.id)) || ms[0];
          setAiModel(pick.id);
          try { localStorage.setItem('ferro-ai-model', pick.id); } catch {}
        }
        pushToast('success', `${ms.length} ✓`);
      } else pushToast('error', t('ai.errKey'));
    } catch (e) { pushToast('error', t(aiErrorKey(e))); }
  };
  const sendAi = async () => {
    const text = aiInput.trim();
    if (!text || aiBusy) return;
    if (!aiBuiltIn && !aiKey) { pushToast('error', t('ai.needKey')); setIslandOpen(true); return; }
    const next = [...aiMsgs, { role: 'user', text }].slice(-60);
    setAiMsgs(next);
    setAiInput('');
    setAiBusy(true);
    try {
      const reply = (aiBuiltIn && window.ferro?.aiChat)
        ? await window.ferro.aiChat({ model: aiModel, system: aiSystem(), history: next.slice(-12) })
        : await geminiChat({ key: aiKey, model: aiModel, system: aiSystem(), history: next.slice(-12) });
      setAiMsgs((m) => [...m, { role: 'ai', text: reply }].slice(-60));
      setIslandOpen(true);
    } catch (e) {
      if (e?.status === 404) { try { await loadAiModels(); } catch {} }
      setAiMsgs((m) => [...m, { role: 'ai', text: `⚠ ${t(aiErrorKey(e))}` }].slice(-60));
      setIslandOpen(true);
    } finally { setAiBusy(false); }
  };
  const attachLog = () => {
    const tail = String(log || '').slice(-4000);
    setAiMsgs((m) => [...m, { role: 'user', text: `${t('ai.logAttached')}\n\`\`\`\n${tail}\n\`\`\`` }].slice(-60));
  };
  const clearAi = () => { setAiMsgs([]); try { localStorage.removeItem('ferro-ai-chat'); } catch {} };
  const askConfirm = (message, onOk) => setConfirmDlg({ message, onOk, input: false });
  const askRename = (current, onOk) => { setConfirmInput(current); setConfirmDlg({ message: t('inst.renamePrompt'), input: true, onOk: (v) => { if (v && v !== current) onOk(v); } }); };
  const [saving, setSaving] = useState(false);
  const [instFilter, setInstFilter] = useState('');
  // Chat IA (Gemini, clave del usuario guardada solo en su PC)
  const [aiKey, setAiKey] = useState(() => { try { return localStorage.getItem('ferro-ai-key') || ''; } catch { return ''; } });
  const [aiKeyInput, setAiKeyInput] = useState('');
  const [aiModel, setAiModel] = useState(() => { try { return localStorage.getItem('ferro-ai-model') || 'gemini-3.5-flash-lite'; } catch { return 'gemini-3.5-flash-lite'; } });
  const [aiModels, setAiModels] = useState([]);
  const [aiMsgs, setAiMsgs] = useState(() => { try { return JSON.parse(localStorage.getItem('ferro-ai-chat') || '[]').slice(-60); } catch { return []; } });
  const [aiBusy, setAiBusy] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const aiEndRef = useRef(null);
  const [islandOpen, setIslandOpen] = useState(false);
  useEffect(() => { try { localStorage.setItem('ferro-ai-chat', JSON.stringify(aiMsgs.slice(-60))); } catch {} }, [aiMsgs]);
  // Clave integrada (proceso principal): si existe, no se pide ni se muestra ninguna clave.
  const [aiBuiltIn, setAiBuiltIn] = useState(false);
  useEffect(() => { try { window.ferro?.aiHasKey?.()?.then?.((v) => { if (v) setAiBuiltIn(true); })?.catch?.(() => {}); } catch {} }, []);
  useEffect(() => { if (aiBuiltIn && aiModels.length === 0 && !aiBusy) loadAiModels(); }, [aiBuiltIn]);
  useEffect(() => { try { aiEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); } catch {} }, [aiMsgs, aiBusy, tab, islandOpen]);
  const [launchProg, setLaunchProg] = useState(null);
  const [dragOn, setDragOn] = useState(false);
  const dragCount = useRef(0);
  const logRef = useRef(null);

  const refresh = async () => {
    try {
      const vers = await window.ferro.versions();
      setVersions(vers);
      // Predeterminada: la última release del manifiesto (vale para futuras versiones)
      const latest = vers[0]?.id;
      if (latest) {
        if (!touchedVer.current.create) setVersionId(latest);
        if (!touchedVer.current.filter) setFVersion(latest);
        if (!touchedVer.current.pack) setPackMc(latest);
      }
      const inst = await window.ferro.instances();
      setInstances(inst);
      if (inst[0]) {
        if (!launchInstance || !inst.some((i) => i.name === launchInstance)) setLaunchInstance(inst[0].name);
      }
      if (inst[0] && !modsFor) setModsFor(inst[0].name);
      setJava(await window.ferro.java());
      try { setAccount(await window.ferro.authStatus()); } catch {}
    } catch (e) {
      setLog((l) => l + `[error] ${e.message}\n`);
    }
  };

  const loadVers = async (k) => {
    try {
      setVerKind(k);
      setVersions(await window.ferro.versions({ kind: k }));
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const loadMods = async (name, k) => {
    if (!name) return;
    const kk = k || kind;
    try {
      setMods(await window.ferro.mods({ instanceName: name, kind: kk }));
      if (kk === 'resourcepack') {
        try { const r = await window.ferro.rp({ instanceName: name }); setRpOn(r.enabled); }
        catch { setRpOn(null); }
      }
      if (kk === 'shader') {
        try { setShaderCur(await window.ferro.shader({ instanceName: name })); }
        catch { setShaderCur(null); }
      }
    }
    catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const checkUpdates = async () => {
    if (checkingUpd || !modsFor) return;
    setCheckingUpd(true);
    setUpdMsg('');
    try {
      const list = await window.ferro.modUpdates({ instanceName: modsFor });
      const map = {};
      for (const u of list) map[u.file] = u;
      setUpdMap(map);
      setUpdMsg(list.length === 0 ? t('mods.upToDate') : t('mods.nUpdates', { n: list.length }));
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
    finally { setCheckingUpd(false); }
  };

  const doModUpdate = async (u) => {
    try {
      setLog((l) => l + `[ferro] actualizando ${u.title || u.file}...\n`);
      await window.ferro.modUpdate({ instanceName: modsFor, file: u.file, projectId: u.projectId });
      setUpdMap((m) => { const n = { ...m }; delete n[u.file]; return n; });
      loadMods(modsFor);
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const loadBackups = async (name) => {
    if (!name) return;
    try { setBkList(await window.ferro.backups({ instanceName: name })); }
    catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const loadCrashes = async (name) => {
    if (!name) return;
    setCrOpen(null);
    try { setCrList(await window.ferro.crashes({ instanceName: name })); }
    catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  useEffect(() => { if (tab === 'mods' && modsFor) loadMods(modsFor); }, [modsFor]);

  useEffect(() => {
    const inst = instances.find((i) => i.name === modsFor);
    if (inst) {
      setFVersion(inst.versionId);
      if (inst.type !== 'vanilla') setFLoader(inst.type);
    }
  }, [modsFor]);

  const doSearch = async () => {
    setSearching(true);
    try {
      const r = await window.ferro.modSearch({ query: modQuery, mcVersion: fVersion, loader: fLoader, sort: fSort, kind });
      setModHits(r.hits || r);
      setModTotal(r.total || (r.hits || r).length);
      setInstalledIds([]);
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
    finally { setSearching(false); }
  };

  const doInstall = async (projectId, title) => {
    if (installingId) return;
    setInstallingId(projectId);
    try {
      setLog((l) => l + `[ferro] instalando ${title} en ${modsFor}...\n`);
      const r = await window.ferro.modInstall({ instanceName: modsFor, projectId, kind });
      setLog((l) => l + `[ferro] instalado ${r.file}\n`);
      pushToast('success', `${title} ${t('toast.installed')}`);
      setInstalledIds((s) => [...s, projectId]);
      await loadMods(modsFor);
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
    finally { setInstallingId(null); }
  };

  const loadCfKey = async () => {
    try { setCfKeySet(await window.ferro.cfKey()); } catch {}
  };

  const doCfSearch = async () => {
    setSearching(true);
    try {
      const ck = kind === 'shader' ? 'mod' : kind;
      const r = await window.ferro.cfSearch({ query: modQuery, mcVersion: fVersion, kind: ck, sort: fSort });
      setCfHits(r.hits || []);
      setCfTotal(r.total || 0);
      setInstalledIds([]);
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
    finally { setSearching(false); }
  };

  const doCfTrending = async () => {
    setSearching(true);
    try {
      const r = await window.ferro.cfTrending();
      setCfHits(r.hits || []);
      setCfTotal(r.total || 0);
      setInstalledIds([]);
      setLog((l) => l + `[ferro] tendencias CF: ${r.hits?.length || 0}\n`);
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
    finally { setSearching(false); }
  };

  const doCfFiles = async (modId) => {
    if (cfFiles[modId]) {
      setCfFiles((p) => { const n = { ...p }; delete n[modId]; return n; });
      return;
    }
    try {
      const inst = instances.find((i) => i.name === modsFor);
      const vers = await window.ferro.cfFiles({ modId, mcVersion: fVersion, loader: inst?.type === 'vanilla' ? undefined : inst?.type });
      setCfFiles((p) => ({ ...p, [modId]: vers }));
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const doCfInstall = async (m, f) => {
    if (cfBusy) return;
    setCfBusy(f.id);
    try {
      setLog((l) => l + `[ferro] instalando ${f.name} en ${modsFor}...\n`);
      const r = await window.ferro.cfInstall({ instanceName: modsFor, modId: m.id, fileId: f.id, kind: kind === 'resourcepack' ? 'resourcepack' : 'mod' });
      setLog((l) => l + `[ferro] instalado ${r.file}\n`);
      pushToast('success', `${m.title} ${t('toast.installed')}`);
      await loadMods(modsFor);
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
    finally { setCfBusy(null); }
  };

  const doPackSearch = async () => {
    try {
      const r = await window.ferro.packSearch({ query: packQuery, mcVersion: packMc, loader: packLoader || undefined, sort: packSort });
      setPackHits(r.hits || r);
      setPackTotal(r.total || (r.hits || r).length);
      setPackVers({});
    }
    catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const doPackVers = async (projectId) => {
    if (packVers[projectId]) {
      setPackVers((p) => { const n = { ...p }; delete n[projectId]; return n; });
      return;
    }
    try {
      const vers = await window.ferro.packVersions({ projectId, mcVersion: packMc, loader: packLoader || undefined });
      setPackVers((p) => ({ ...p, [projectId]: vers }));
    }
    catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const doPackInstall = async (pack, v) => {
    if (packBusy) return;
    setPackBusy(v.id);
    try {
      setTab('jugar');
      const r = await window.ferro.packInstall({ name: `${pack.title} ${v.number}`, projectId: pack.id, packVersionId: v.id, mcVersion: packMc });
      setLog((l) => l + `[ferro] instancia ${r.name} creada desde modpack\n`);
      pushToast('success', `${t('toast.packDone')}: ${r.name}`);
      await refresh();
      setLaunchInstance(r.name);
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
    finally { setPackBusy(null); }
  };

  const doCfPackSearch = async () => {
    try {
      const r = await window.ferro.cfSearch({ query: packQuery, mcVersion: packMc, kind: 'modpack', sort: packSort });
      setPackHits(r.hits || []);
      setPackTotal(r.total || 0);
      setPackVers({});
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const doCfPackVers = async (modId) => {
    if (cfPackVers[modId]) {
      setCfPackVers((p) => { const n = { ...p }; delete n[modId]; return n; });
      return;
    }
    try {
      const vers = await window.ferro.cfFiles({ modId, mcVersion: packMc });
      setCfPackVers((p) => ({ ...p, [modId]: vers }));
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const doCfPackInstall = async (pack, f) => {
    if (cfPackBusy) return;
    setCfPackBusy(f.id);
    try {
      setTab('jugar');
      const r = await window.ferro.cfPackInstall({ name: pack.title, modId: pack.id, fileId: f.id });
      setLog((l) => l + `[ferro] instancia ${r.name} creada desde modpack\n`);
      pushToast('success', `${t('toast.packDone')}: ${r.name}`);
      await refresh();
      setLaunchInstance(r.name);
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
    finally { setCfPackBusy(null); }
  };

  const loadAuth = async () => {
    try {
      const ci = await window.ferro.clientId().catch(() => null);
      setIdInfo(ci || { masked: '', configured: false });
      setClientId('');
      setAccount(await window.ferro.authStatus());
      setAccts(await window.ferro.accounts());
      const dc = await window.ferro.discord().catch(()=>({clientId:'',enabled:true}));
      setDcId(dc.clientId || ''); setDcOn(dc.enabled !== false); setDcHook(dc.webhook || '');
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  const shareLinks = (net) => {
    const url = encodeURIComponent('https://github.com/4DRI4N-OFF/FerroLauncher');
    const txt = encodeURIComponent(lang === 'en'
      ? 'FerroLauncher: free open-source Minecraft Java launcher for Windows (all loaders, mods, modpacks)'
      : 'FerroLauncher: launcher gratis y open-source de Minecraft Java para Windows (todos los loaders, mods, modpacks)');
    const links = {
      x: `https://x.com/intent/tweet?text=${txt}&url=${url}`,
      reddit: `https://www.reddit.com/submit?url=${url}&title=${txt}`,
      whatsapp: `https://wa.me/?text=${txt}%20${url}`,
      telegram: `https://t.me/share/url?url=${url}&text=${txt}`,
    };
    if (net === 'copy') {
      try { navigator.clipboard.writeText('https://github.com/4DRI4N-OFF/FerroLauncher'); setLog((l) => l + '[ferro] enlace copiado\n'); } catch {}
      return;
    }
    window.ferro.openUrl(links[net]);
  };

  const loadSkin = async (name) => {
    try { setSkinInfo(await window.ferro.skin({ name: name ?? skinName ?? username ?? 'Ferro' })); }
    catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const applySkin = async () => {
    if (skinBusy) return;
    setSkinBusy(true);
    try {
      const r = await window.ferro.skinApply({ variant: skinVariant, url: skinUrl });
      setSkinInfo({ online: true, ...r });
      setLog((l) => l + `[ferro] skin actualizada (${skinVariant})\n`);
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
    finally { setSkinBusy(false); }
  };

  const resetSkin = async () => {
    try {
      await window.ferro.skinReset();
      setLog((l) => l + '[ferro] skin restablecida\n');
      loadSkin();
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };
  useEffect(() => stopPoll, []);

  // Intro: el logo vuela del centro (donde estaba el splash) al sidebar
  useEffect(() => {
    document.body.classList.add('intro-lock');
    const unlock = () => document.body.classList.remove('intro-lock');
    let done = false;
    const fly = async () => {
      if (done) return;
      done = true;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const img = introImgRef.current, target = sideLogoRef.current, ov = overlayRef.current;
      if (!img || !target) { unlock(); setIntro(false); return; }
      const r1 = img.getBoundingClientRect(), r2 = target.getBoundingClientRect();
      // Aterriza sobre el mini real (no sobre la caja): el fundido lo deja ya con su forma.
      const tiny0 = img.querySelector('.intro-mini'), full0 = img.querySelector('.intro-full');
      const land = (target.querySelector && target.querySelector('.brand-mini')) || target;
      const rl = land.getBoundingClientRect();
      const dx = rl.left + rl.width / 2 - (r1.left + r1.width / 2);
      const dy = rl.top + rl.height / 2 - (r1.top + r1.height / 2);
      const baseMini = tiny0 ? tiny0.getBoundingClientRect().width : r1.width;
      const s = baseMini > 0 ? rl.width / baseMini : r2.width / r1.width;
      try {
        const a1 = img.animate([
          { transform: 'translate(0, 0) scale(1)' },
          { transform: `translate(${dx}px, ${dy}px) scale(${s})` },
        ], { duration: 1100, easing: 'cubic-bezier(.65, 0, .35, 1)', fill: 'forwards' });
        const jobs = [a1.finished];
        if (full0) jobs.push(full0.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, easing: 'ease-in', fill: 'forwards' }).finished);
        if (tiny0) jobs.push(tiny0.animate([
          { opacity: 0, transform: 'scale(.5)' },
          { opacity: 1, transform: 'scale(1.06)', offset: 0.7 },
          { opacity: 1, transform: 'scale(1)' },
        ], { duration: 900, delay: 300, easing: 'ease-out', fill: 'forwards' }).finished);
        await Promise.all(jobs);
      } catch {}
      // Corte seco al logo real: sin fundido que delate 1px de diferencia
      unlock();
      setIntro(false);
    };
    if (window.ferro?.onShown) {
      let fallback;
      // El vuelo arranca cuando la ventana deja de crecer (medidas ya estables)
      window.ferro.onSettled?.(() => fly());
      window.ferro.onShown(() => {
        fallback = setTimeout(fly, 2000); // por si settled no llega
      });
      const t = setTimeout(fly, 9000); // salvavidas
      return () => { clearTimeout(t); clearTimeout(fallback); unlock(); };
    }
    const t = setTimeout(fly, 600); // fuera de Electron
    return () => { clearTimeout(t); unlock(); };
  }, []);

  useEffect(() => {
    window.ferro.onAuthResult?.((err, data) => {
      setBrowserWaiting(false);
      if (err) setLog((l) => l + `[error] ${err.error || err}\n`);
      else {
        setLog((l) => l + `[ferro] sesión iniciada: ${data.name}\n`);
        pushToast('success', `${t('toast.login')}: ${data.name}`);
        loadAuth();
        celebrateLogin();
      }
    });
    window.ferro.onUpdate?.((d) => setUpd(d));
    window.ferro.appVersion?.().then(setAppVer).catch(()=>{});
  }, []);

  const doBrowserAuth = async () => {
    try {
      setBrowserWaiting(true);
      await window.ferro.authWindow();
      setLog((l) => l + '[ferro] completa el login en la ventana de Microsoft…\n');
    } catch (e) { setBrowserWaiting(false); setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const cancelBrowserAuth = async () => {
    setBrowserWaiting(false);
    try { await window.ferro.authWindowCancel(); } catch {}
  };

  const doAuthPollOnce = async (s) => {
    const r = await window.ferro.authPoll({ deviceCode: (s || authStep)?.deviceCode });
    setPollCount((c) => c + 1);
    if (r.status === 'done') {
      stopPoll(); setAuthStep(null);
      setLog((l) => l + `[ferro] sesión iniciada: ${r.name}\n`);
      loadAuth();
      celebrateLogin();
    } else if (r.status === 'error') {
      stopPoll(); setAuthStep(null);
      setLog((l) => l + `[error] ${r.error}\n`);
    }
    return r;
  };

  const doAuthStart = async () => {
    try {
      if (clientId.trim()) await window.ferro.setClientId({ clientId });
      const s = await window.ferro.authStart();
      setAuthStep(s);
      setPollCount(0);
      setLog((l) => l + `[ferro] autoriza con el código ${s.userCode} en ${s.verificationUri}\n`);
      stopPoll();
      pollRef.current = setInterval(async () => {
        try { await doAuthPollOnce(s); }
        catch (e) { stopPoll(); setAuthStep(null); setLog((l) => l + `[error] ${e.message}\n`); }
      }, s.interval);
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const doLogout = async () => {
    stopPoll(); setAuthStep(null);
    await window.ferro.authLogout();
    setAccount(null);
    setLog((l) => l + '[ferro] sesión cerrada\n');
  };

  useEffect(() => {
    window.ferro.onLog((t) => {
      setLog((l) => l + t);
      if (/proceso terminado|error al arrancar/i.test(t)) setRunning(false);
    });
    refresh();
    window.ferro.status?.().then((s) => setRunning(!!s?.running)).catch(()=>{});
  }, []);

  // Tilt 3D en tarjetas al pasar el ratón
  useEffect(() => {
    const clear = (except) => document.querySelectorAll('.grid .card.tilting').forEach((c) => {
      if (c !== except) { c.classList.remove('tilting'); c.style.transform = ''; }
    });
    const move = (e) => {
      const card = e.target.closest?.('.grid .card');
      clear(card);
      if (!card) return;
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      card.classList.add('tilting');
      card.style.transform = `perspective(900px) rotateX(${(-py * 7).toFixed(2)}deg) rotateY(${(px * 7).toFixed(2)}deg) translateY(-3px)`;
    };
    const out = (e) => { if (!e.relatedTarget) clear(null); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseout', out);
    return () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseout', out); };
  }, [tab]);

  // Clics y hover globales en botones
  useEffect(() => {
    let lastHover = 0;
    const onClick = (e) => { if (e.target.closest('button:not(:disabled)')) sfx.play('click'); };
    const onOver = (e) => {
      if (!e.target.closest('button:not(:disabled)')) return;
      const now = Date.now();
      if (now - lastHover < 90) return;
      lastHover = now;
      sfx.play('hover');
    };
    document.addEventListener('click', onClick);
    document.addEventListener('mouseover', onOver);
    return () => { document.removeEventListener('click', onClick); document.removeEventListener('mouseover', onOver); };
  }, []);

  useEffect(() => {
    if (instanceType === 'vanilla') return;
    window.ferro.loaders({ mcVersion: versionId, type: instanceType }).then((l) => {
      setLoaders(l);
      if (l[0]) setLoaderVersion(l[0].loader);
    }).catch((e) => setLog((x) => x + `[error ${instanceType}] ${e.message}\n`));
  }, [instanceType, versionId]);

  const create = async () => {
    try {
      const r = await window.ferro.createInstance({ name: instanceName, versionId, type: instanceType, loaderVersion: instanceType === 'vanilla' ? undefined : loaderVersion });
      setLog((l) => l + `[ferro] instancia creada: ${r.name} (${versionId}${instanceType === 'vanilla' ? '' : ` + ${instanceType} ${loaderVersion}`})\n`);
      pushToast('success', t('toast.instCreated', {n:r.name}));
      setInstanceName('');
      setLaunchInstance(r.name);
      refresh();
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const play = async (nm, srv) => {
    const target = nm || launchInstance;
    if (!target) return;
    try {
      setTab('jugar');
      setLaunchInstance(target);
      setLog((l) => l + `[ferro] lanzando ${target} como ${username}...\n`);
      setRunning(true);
      setLaunchProg(null);
      await window.ferro.launch({ instanceName: target, username, ...(srv ? { serverHost: srv.host, serverPort: srv.port } : {}) });
      const s = await window.ferro.status().catch(() => null);
      setRunning(!!s?.running);
      if (!s?.running) setLog((l) => l + `[error] ${t('play.diedFast')}\n`);
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); setRunning(false); }
  };

  const stop = async () => {
    try { await window.ferro.stop(); }
    catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const loadServers = async () => {
    try {
      const list = await window.ferro.servers();
      setServers(list);
      list.forEach((s) => pingServer(s));
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const pingServer = async (s) => {
    const key = `${s.host}:${s.port}`;
    try {
      const r = await window.ferro.serverPing({ host: s.host, port: s.port });
      setSrvPing((m) => ({ ...m, [key]: r }));
    } catch { setSrvPing((m) => ({ ...m, [key]: { online: false } })); }
  };

  const addServer = async () => {
    if (!srvHost.trim()) return;
    try {
      setServers(await window.ferro.serverAdd({ name: srvName.trim() || srvHost.trim(), host: srvHost.trim(), port: srvPort }));
      setSrvName(''); setSrvHost(''); setSrvPort('25565');
      setLog((l) => l + `[ferro] ${t('srv.added')}\n`);
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
  };

  const playOn = async (s) => {
    if (!launchInstance) { setLog((l) => l + `[error] ${t('srv.noInst')}\n`); return; }
    setLog((l) => l + `[ferro] directo a ${s.host}...\n`);
    play(launchInstance, s);
  };

  const filteredLog = useMemo(() => {
    const lines = log.split('\n');
    return lines.filter((ln) => {
      if (logLevel === 'error' && !/error|exception|caused|fail|FATAL/i.test(ln)) return false;
      if (logLevel === 'warn' && !/warn|aviso/i.test(ln)) return false;
      if (logLevel === 'ferro' && !/^\[ferro\]|^\[error\]/i.test(ln)) return false;
      if (logSearch && !ln.toLowerCase().includes(logSearch.toLowerCase())) return false;
      return true;
    }).join('\n');
  }, [log, logLevel, logSearch]);

  useEffect(() => {
    if (autoScroll && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [filteredLog, autoScroll]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (islandOpen) setIslandOpen(false);
      else if (galName) closeGallery();
      else if (settingsFor) closeModal();
      else if (confirmDlg) setConfirmDlg(null);
      else if (dragOn) { dragCount.current = 0; setDragOn(false); }
      else if (tourIdx !== null) endTour();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [galName, settingsFor, confirmDlg, dragOn, tourIdx, islandOpen]);

  const confirmGo = () => { const v = confirmDlg.input ? confirmInput : true; const f = confirmDlg.onOk; setConfirmDlg(null); f(v); };

  useEffect(() => { if (!running) setLaunchProg(null); }, [running]);

  useEffect(() => {
    window.ferro.onProgress?.((d) => setLaunchProg(d));
    window.ferro.heroBg?.().then((r) => { if (r?.dataUrl) setHeroBg(r.dataUrl); }).catch(() => {});
  }, []);

  useEffect(() => {
    const onDragEnter = (e) => { e.preventDefault(); if (e.dataTransfer?.types?.includes('Files')) { dragCount.current++; setDragOn(true); } };
    const lv = (e) => { e.preventDefault(); dragCount.current = Math.max(0, dragCount.current - 1); if (!dragCount.current) setDragOn(false); };
    const dr = (e) => { e.preventDefault(); };
    const dp = async (e) => {
      e.preventDefault(); dragCount.current = 0; setDragOn(false);
      const files = [...(e.dataTransfer?.files || [])].map((f) => f.path).filter(Boolean);
      if (!files.length) return;
      try {
        const r = await window.ferro.importDrop({ paths: files, instanceName: modsFor });
        for (const x of r || []) setLog((l) => l + `[ferro] drop ${x.kind}: ${x.name || x.file || ''}${x.error ? ` (${x.error})` : ''}\n`);
        refresh();
      } catch (err) { setLog((l) => l + `[error] ${err.message}\n`); }
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', lv);
    window.addEventListener('dragover', dr);
    window.addEventListener('drop', dp);
    return () => { window.removeEventListener('dragenter', onDragEnter); window.removeEventListener('dragleave', lv); window.removeEventListener('dragover', dr); window.removeEventListener('drop', dp); };
  }, [modsFor]);

  const editSettings = (name, e) => {
    if (settingsFor === name) { setSettingsFor(''); setModalOrigin(null); return; }
    const r = e?.currentTarget?.getBoundingClientRect?.();
    setModalOrigin(r ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height } : null);
    setSettingsFor(name);
    const i = instances.find((x) => x.name === name);
    if (i?.settings) {
      setSRam(String(i.settings.ramMb)); setSW(String(i.settings.width)); setSH(String(i.settings.height));
      setSJvm(i.settings.jvmPreset || 'equilibrado'); setDiag(null);
      setSJavaMode(i.settings.javaMode); setSJavaPath(i.settings.javaPath || '');
    }
    loadBackups(name);
    loadCrashes(name);
  };

  const closeModal = () => { setModalClosing(true); setTimeout(() => { setSettingsFor(''); setModalOrigin(null); setModalClosing(false); }, 280); };

  const openGallery = async (name, e) => {
    const r = e?.currentTarget?.getBoundingClientRect?.();
    setGalOrigin(r ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height } : null);
    setGalName(name);
    setGalShots([]);
    try {
      const list = await window.ferro.shots({ instanceName: name });
      setGalShots(list.map((s) => ({ ...s, thumb: null })));
      for (const s of list) {
        window.ferro.shotThumb({ instanceName: name, file: s.file })
          .then((t) => setGalShots((g) => g.map((x) => (x.file === s.file ? { ...x, thumb: t.dataUrl } : x))))
          .catch(() => {});
      }
    } catch (e2) { setLog((l) => l + `[error] ${e2.message}\n`); }
  };

  const closeGallery = () => { setGalClosing(true); setTimeout(() => { setGalName(''); setGalOrigin(null); setGalClosing(false); setGalShots([]); }, 280); };

  const saveSettings = async () => {
    if (!settingsFor || saving) return;
    setSaving(true);
    try {
      await window.ferro.updateSettings({ instanceName: settingsFor, patch: { ramMb: sRam, width: sW, height: sH, javaMode: sJavaMode, javaPath: sJavaPath, jvmPreset: sJvm } });
      setLog((l) => l + `[ferro] ajustes guardados en ${settingsFor}\n`);
      refresh();
    } catch (e) { setLog((l) => l + `[error] ${e.message}\n`); }
    finally { setSaving(false); }
  };

  return (
    <div className="layout">
      <Embers />
      <div className={`side${sideBig ? '' : ' collapsed'}`}>
        <div className="brand-swap" ref={sideLogoRef}>
          <img className="brand-logo brand-full" src={brand} alt="FerroLauncher" />
          <img className="brand-logo brand-mini" src={flMark} alt="FL" />
          <button className={`pin${sidePinned ? ' on' : ''}`} onClick={()=>{ springNav(); const v = !sidePinned; setSidePinned(v); setSideOpen(v); try { localStorage.setItem('ferro-sidepin', v ? '1' : '0'); } catch {} }} title="Pin">{sidePinned ? <PinOff size={14} /> : <Pin size={14} />}</button>
        </div>
        <button className={tab==='jugar'?'active':''} onClick={()=>setTab('jugar')}><Play size={16} /><span className="nav-label">{t('tab.play')}</span></button>
        <button className={tab==='versiones'?'active':''} onClick={()=>setTab('versiones')}><Layers size={16} /><span className="nav-label">{t('tab.versions')}</span></button>
        <button className={tab==='instancias'?'active':''} onClick={()=>setTab('instancias')}><Package size={16} /><span className="nav-label">{t('tab.instances')}</span></button>
        <button className={tab==='mods'?'active':''} onClick={()=>{setTab('mods'); if(modsFor) loadMods(modsFor);}}><LayoutGrid size={16} /><span className="nav-label">{t('tab.content')}</span></button>
        <button className={tab==='packs'?'active':''} onClick={()=>setTab('packs')}><Gift size={16} /><span className="nav-label">{t('tab.packs')}</span></button>
        <button className={tab==='cuenta'?'active':''} onClick={()=>{setTab('cuenta'); loadAuth();}}><User size={16} /><span className="nav-label">{t('tab.account')}</span></button>
        <button className={tab==='skin'?'active':''} onClick={()=>{setTab('skin'); loadSkin();}}><Palette size={16} /><span className="nav-label">{t('tab.skin')}</span></button>
        <button className={tab==='ajustes'?'active':''} onClick={()=>setTab('ajustes')}><Settings size={16} /><span className="nav-label">{t('tab.settings')}</span></button>
        <button className={tab==='servers'?'active':''} onClick={()=>{setTab('servers'); loadServers();}}><Server size={16} /><span className="nav-label">{t('tab.servers')}</span></button>
        <div className="player-chip" onClick={()=>setTab('cuenta')} title={t('tab.account')}>
          {playFace ? <img className="face" src={playFace} alt="" onError={()=>setPlayFace(null)} /> : <User size={18} />}
          <div className="pc-id"><b className={account ? 'premium-shine' : ''}>{account?.name || username || '—'}</b><span>{account ? t('play.online') : t('play.offline')}</span></div>
          <span className={`dot ${account ? 'on' : ''}`} />
        </div>
        <div className="ver">v{appVer || '?'} · {t('footerTag')}</div>
      </div>
      <div className="main" key={tab}>
        <div className="bounce">
        {tab==='jugar' && (<>
          <div className={`card hero hero-${(() => { const s = instances.find((i)=>i.name===launchInstance); return s ? s.type : 'vanilla'; })()}`}>
            {heroBg && <img className="hero-bg" src={heroBg} alt="" />}
            <div className="hero-top">
              {playFace && <img className="face xl" src={playFace} alt="" onError={()=>setPlayFace(null)} />}
              <div className="hero-id">
                <div className="hero-kicker">{account ? `${account.name} · ${t('play.online')}` : `${username || '—'} · ${t('play.offline')}`}</div>
                <div className="hero-title">{launchInstance || 'FerroLauncher'}</div>
                <div className="meta">
                  {(() => { const s = instances.find((i)=>i.name===launchInstance); return s ? (<>
                    <span className="pill">{s.versionId}</span>
                    <span className={`pill l-${s.type}`}>{s.type==='vanilla' ? 'vanilla' : `${s.type} ${s.loaderVersion||''}`}</span>
                    <span className="pill">{((s.settings?.ramMb||2048)/1024)} GB</span>
                    {(() => { const tt = instances.reduce((a, i) => a + (i.playSecs || 0), 0); return tt >= 60 ? (<span className="pill">{fmtPlay(tt)}</span>) : null; })()}
                  </>) : null; })()}
                  {running && <span className="pill green"><span className="spinner" />{t('play.running')}</span>}
                </div>
              </div>
              <div className="hero-play" data-tour="play">
                  {!running
                    ? <button className="primary" onClick={()=>play()} disabled={!launchInstance}><Play size={18} /> {t('play.play')}</button>
                  : <button className="primary" onClick={stop} style={{filter:'hue-rotate(140deg)'}}><Square size={18} /> {t('play.stop')}</button>}
              </div>
            </div>
            <div className="row hero-controls">
              <input value={username} onChange={(e)=>setUsername(e.target.value)} placeholder={t('play.userPh')} />
              <select value={launchInstance} onChange={(e)=>setLaunchInstance(e.target.value)}>
                {instances.map((i)=><option key={i.name} value={i.name}>{i.name} ({i.versionId}{i.type==='vanilla'?'':' · '+i.type})</option>)}
              </select>
              <button className="ghost" onClick={refresh}><RefreshCw size={14} /> {t('play.reload')}</button>
            </div>
            {!account && nameState.status !== 'idle' && (
              <div className="row" style={{marginTop:8}}>
                {nameState.status === 'checking' && <span className="pill"><span className="spinner" />{t('play.checkingName')}</span>}
                {nameState.status === 'free' && <span className="pill green"><Check size={12} /> {t('play.nameFree')}</span>}
                {nameState.status === 'invalid' && <span className="pill">{t('play.nameInvalid')}</span>}
                {nameState.status === 'unknown' && <span className="pill">{t('play.nameUnknown')}</span>}
                {nameState.status === 'taken' && <><span className="pill">{t('play.nameTaken')}</span>{nameState.suggestions.map((s)=><button key={s} className="mini" onClick={()=>setUsername(s)}>{s}</button>)}</>}
              </div>
            )}
            {instances.length===0 && <p>{t('play.noInst')}</p>}
          </div>
          {launchProg && launchProg.done != null && launchProg.total > 0 && (
            <div className="card" style={{marginTop:8}}>
              <div className="row"><span>{t('play.ph.' + launchProg.phase) || launchProg.phase}</span><span>{launchProg.done}/{launchProg.total}{launchProg.extra ? ` · ${launchProg.extra}` : ''}</span></div>
              <div style={{height:8, borderRadius:6, background:'rgba(255,255,255,.08)', overflow:'hidden', marginTop:6}}>
                <div style={{height:'100%', width:`${Math.min(100, Math.round(100 * launchProg.done / Math.max(1, launchProg.total)))}%`, background:'linear-gradient(90deg,#ffb62e,#f97316)', transition:'width .3s'}} />
              </div>
            </div>
          )}
          <div className="card">
            <h3>{t('play.console')}</h3>
            <div className="row" style={{marginBottom:8}}>
              <select value={logLevel} onChange={(e)=>setLogLevel(e.target.value)}>
                <option value="todo">{t('play.lvAll')}</option>
                <option value="ferro">{t('play.lvFerro')}</option>
                <option value="warn">{t('play.lvWarn')}</option>
                <option value="error">{t('play.lvError')}</option>
              </select>
              <input value={logSearch} onChange={(e)=>setLogSearch(e.target.value)} placeholder={t('play.filterPh')} />
              <button className="mini" onClick={()=>setAutoScroll(!autoScroll)}>{autoScroll ? '✓ Autoscroll' : 'Autoscroll'}</button>
              <button className="mini" onClick={()=>setLog('')}>{t('play.clear')}</button>
            </div>
            <div className="log" ref={logRef}>{filteredLog}</div>
          </div>
        </>)}
        {tab==='versiones' && (
          <div className="card">
            <h2>{t('ver.title')}</h2>
            <div className="row" style={{marginBottom:10}}>
              {['release','snapshot','all'].map((k)=><button key={k} className="mini" disabled={verKind===k} onClick={()=>loadVers(k)}>{t('ver.'+k)}</button>)}
            </div>
            <div className="grid">
              {versions.map((v)=><div key={v.id} className="card"><div className="card-title">{v.id}</div><div className="meta"><span className="pill">{v.type}</span><span className="pill">{new Date(v.releaseTime).toLocaleDateString()}</span></div></div>)}
            </div>
          </div>
        )}
        {tab==='instancias' && (
          <div className="card">
            <h2>{t('inst.createTitle')}</h2>
            <div className="row" data-tour="create">
              <input value={instanceName} onChange={(e)=>setInstanceName(e.target.value)} placeholder={t('inst.namePh')} />
              <select value={versionId} onChange={(e)=>{touchedVer.current.create=true; setVersionId(e.target.value);}}>
                {versions.map((v)=><option key={v.id} value={v.id}>{v.id}</option>)}
              </select>
              <select value={instanceType} onChange={(e)=>setInstanceType(e.target.value)}>
                <option value="vanilla">Vanilla</option>
                <option value="fabric">Fabric</option>
                <option value="quilt">Quilt</option>
                <option value="forge">Forge</option>
                <option value="neoforge">NeoForge</option>
              </select>
              {instanceType!=='vanilla' && (
                <select value={loaderVersion} onChange={(e)=>setLoaderVersion(e.target.value)}>
                  {loaders.map((l)=><option key={l.loader} value={l.loader}>{l.loader}{l.tag?` (${l.tag})`:''}{l.stable && !l.tag?(lang==='en'?' (stable)':' (estable)'):''}</option>)}
                </select>
              )}
              <button className="primary" onClick={create}><Plus size={14} /> {t('inst.create')}</button>
            </div>
            <h3>{t('inst.installed')} ({instances.length})</h3>
            <div className="row" style={{marginBottom:10}}>
              <input value={instFilter} onChange={(e)=>setInstFilter(e.target.value)} placeholder={t('inst.filterPh')} />
            </div>
            <div className="grid">
              {instances.filter((i)=>i.name.toLowerCase().includes(instFilter.toLowerCase())).map((i)=><div key={i.name} className={"card" + (exploding === i.name ? " exploding" : "")}><div className="card-title" title={i.name} onDoubleClick={()=>play(i.name)} style={{cursor:'pointer'}}>{i.name}</div><div className="meta"><span className="pill">{i.versionId}</span><span className={`pill l-${i.type}`}>{i.type==='vanilla' ? 'vanilla' : `${i.type} ${i.loaderVersion||''}`}</span><span className="pill">{(i.settings?.ramMb||2048)/1024} GB · {i.settings?.width||854}×{i.settings?.height||480}</span>{i.lastPlayed ? <span className="pill"><Play size={12} /> {new Date(i.lastPlayed).toLocaleDateString()}{i.plays ? ` · ${i.plays}×` : ''}{fmtPlay(i.playSecs) ? ` · ${fmtPlay(i.playSecs)}` : ''}</span> : <span className="pill">{t('inst.neverPlayed')}</span>}</div><div className="actions"><button className="ghost" onClick={(e)=>editSettings(i.name, e)}><Settings size={14} /> {t('inst.settings')}</button><button className="ghost" onClick={(e)=>openGallery(i.name, e)}><Camera size={14} /> {t('inst.shots')}</button><button className="ghost" onClick={async()=>{await window.ferro.exportInstance({instanceName:i.name});}}><Upload size={14} /> {t('inst.export')}</button><button className="ghost" onClick={async()=>{await window.ferro.openFolder({instanceName:i.name});}}><FolderOpen size={14} /> {t('inst.folder')}</button><button className="ghost" onClick={async()=>{await window.ferro.duplicateInstance({instanceName:i.name}); refresh();}}><Copy size={14} /> {t('inst.duplicate')}</button><button className="ghost" onClick={()=>askRename(i.name, async (n)=>{await window.ferro.renameInstance({instanceName:i.name, newName:n}); refresh();})}><Pencil size={14} /> {t('inst.rename')}</button><button className="ghost danger" onClick={(e)=>{ const card = e.currentTarget.closest('.card'); askConfirm(t('inst.delConfirm', {n:i.name}), ()=>explodeInstance(i.name, card)); }}><Trash2 size={14} /> {t('inst.delete')}</button></div>
</div>)}
            </div>
            <div className="row" style={{marginTop:12}}>
              <button className="primary" onClick={async()=>{const n=await window.ferro.importInstance(); if(n){setLog((l)=>l+`[ferro] importada ${n}\n`); refresh();}}}><Upload size={14} /> {t('inst.import')}</button>
              <button className="ghost" onClick={async()=>{try{setImpScan(await window.ferro.importScan());}catch(e){setLog((l)=>l+`[error] ${e.message}\n`);}}}><Download size={14} /> {t('inst.importOther')}</button>
            </div>
            {impScan && (<div className="card" style={{marginTop:8}}>
              {impScan.vanilla && (<><div className="subhead"><span>Vanilla ({impScan.vanilla.versions?.length||0})</span></div><div className="sublist">{(impScan.vanilla.versions||[]).slice(0,12).map((v)=><div key={v.id} className="subrow"><span className="grow">{v.id}</span><button className="mini" onClick={async()=>{try{const r=await window.ferro.importVanilla({versionId:v.id}); setLog((l)=>l+`[ferro] ${t('inst.imported')}: ${r.name}\n`); refresh();}catch(e){setLog((l)=>l+`[error] ${e.message}\n`);}}}>{t('inst.import')}</button></div>)}</div></>)}
              {['prism','multimc'].map((k)=>(impScan[k] && <div key={k}><div className="subhead"><span style={{textTransform:'capitalize'}}>{k} ({impScan[k].instances?.length||0})</span></div><div className="sublist">{(impScan[k].instances||[]).map((i)=><div key={i.name} className="subrow"><span className="grow" title={i.path}>{i.name} · {i.mc||'?'} {i.loader?`+ ${i.loader.type}`:''}</span><button className="mini" onClick={async()=>{try{const r=await window.ferro.importPrism({from:k, instPath:i.name}); setLog((l)=>l+`[ferro] ${t('inst.imported')}: ${r.name}\n`); refresh();}catch(e){setLog((l)=>l+`[error] ${e.message}\n`);}}}>{t('inst.import')}</button></div>)}</div></div>))}
              {!impScan.vanilla && !impScan.prism && !impScan.multimc && <p style={{opacity:.6}}>{t('inst.impNone')}</p>}
            </div>)}
          </div>
        )}
        {tab==='mods' && (
          <div className="card">
            <h2>{t('mods.title')}</h2>
            <div className="row" data-tour="mods-search">
              <select value={source} onChange={(e)=>{setSource(e.target.value); setModHits([]); setCfHits([]); setInstalledIds([]); if(e.target.value==='cf') loadCfKey();}} title="Fuente">
                <option value="mr">Modrinth</option>
                <option value="cf">CurseForge</option>
              </select>
              <select value={modsFor} onChange={(e)=>{setModsFor(e.target.value); setUpdMap({}); setUpdMsg(''); setRpOn(null); setShaderCur(null); loadMods(e.target.value);}}>
                {instances.map((i)=><option key={i.name} value={i.name}>{i.name} ({i.versionId}{i.type==='vanilla'?'':' '+i.type})</option>)}
              </select>
              <select value={kind} onChange={(e)=>{setKind(e.target.value); setModHits([]); setInstalledIds([]); setUpdMap({}); setUpdMsg(''); setRpOn(null); setShaderCur(null); loadMods(modsFor, e.target.value);}} title="Tipo">
                <option value="mod">{t('mods.tMods')}</option>
                <option value="shader">{t('mods.tShaders')}</option>
                <option value="resourcepack">{t('mods.tRp')}</option>
              </select>
              <input value={modQuery} onChange={(e)=>setModQuery(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter') doSearch();}} placeholder={`Buscar ${kindName}...`} />
              <select value={fVersion} onChange={(e)=>{touchedVer.current.filter=true; setFVersion(e.target.value);}} title="Versión de Minecraft">
                {versions.map((v)=><option key={v.id} value={v.id}>{v.id}</option>)}
              </select>
              {kind==='mod' && (
              <select value={fLoader} onChange={(e)=>setFLoader(e.target.value)} title="Loader">
                <option value="fabric">Fabric</option>
                <option value="quilt">Quilt</option>
                <option value="forge">Forge</option>
                <option value="neoforge">NeoForge</option>
              </select>
              )}
              <select value={fSort} onChange={(e)=>setFSort(e.target.value)} title="Orden">
                <option value="relevance">{t('mods.sRelevance')}</option>
                <option value="downloads">{t('mods.sDownloads')}</option>
                <option value="follows">{t('mods.sFollows')}</option>
                <option value="newest">{t('mods.sNewest')}</option>
                <option value="updated">{t('mods.sUpdated')}</option>
              </select>
              <button className="primary" onClick={()=>{source==='cf' ? doCfSearch() : doSearch();}} disabled={searching || !modsFor}>{searching ? t('mods.searching') : <><Search size={14} /> {t('mods.search')}</>}</button>
              {source==='cf' && <button className="ghost" onClick={doCfTrending} disabled={searching}>Tendencias</button>}
              <button className="mini" onClick={()=>loadMods(modsFor)} disabled={!modsFor}>{t('mods.viewInstalled')}</button>
            </div>
            {source==='cf' && (
            <div className="row" style={{marginTop:8}}>
              <input value={cfKeyInput} onChange={(e)=>setCfKeyInput(e.target.value)} type="password" placeholder="CurseForge API key…" style={{minWidth:260}} />
              <button className="mini" onClick={async()=>{await window.ferro.cfSetKey({key:cfKeyInput}); setCfKeyInput(''); loadCfKey(); setLog((l)=>l+'[ferro] CurseForge key guardada\n');}}>{t('acct.save')}</button>
              {cfKeySet ? <span className="pill green">key {cfKeySet}</span> : <span className="pill">console.curseforge.com → API Keys</span>}
            </div>
            )}
            {!modsFor && <p>{t('mods.needLoader')}</p>}
            <h3>{t('mods.results')}{modTotal>0 && ` (${modTotal.toLocaleString()})`} · {fVersion} · {fLoader}</h3>
            {modHits.length===0 && <p style={{opacity:.6}}>{t('mods.noResults')}</p>}
            <div className="grid">
              {modHits.map((m)=>{
                const busy = installingId===m.id;
                const done = installedIds.includes(m.id);
                return (
                <div key={m.id} className="card">
                  <div className="mod-head">{m.icon && <img className="mod-icon" src={m.icon} alt="" />}<b>{m.title}</b></div>
                  <div className="desc">{m.description?.slice(0,120)}</div>
                  <div className="meta"><span className="pill"><Download size={12} /> {m.downloads?.toLocaleString?.() || m.downloads}</span>{m.updated && <span className="pill">↻ {new Date(m.updated).toLocaleDateString()}</span>}{m.client==='required' && <span className="pill green">{t('mods.client')}</span>}</div>
                  <div className="actions">
                    <button className={done ? 'mini ok' : 'mini hot'} disabled={busy || done || !modsFor} onClick={()=>doInstall(m.id, m.title)}>
                      {busy ? <><span className="spinner" />{t('mods.installing')}</> : done ? <><Check size={12} /> {t('mods.installedDone')}</> : <><Download size={12} /> {t('mods.install')}</>}
                    </button>
                  </div>
                </div>);
              })}
            </div>
            {source==='cf' && kind==='shader' && <p style={{opacity:.65}}>CurseForge no lista shaders: cambia a Modrinth para esta pestaña.</p>}
            {source==='cf' && (<>
            <h3>CurseForge{cfTotal>0 && ` (${cfTotal.toLocaleString()})`} · {fVersion}</h3>
            {cfHits.length===0 && <p style={{opacity:.6}}>{t('mods.noResults')}</p>}
            <div className="grid">
              {cfHits.map((m)=>(
                <div key={m.id} className="card">
                  <div className="mod-head">{m.icon && <img className="mod-icon" src={m.icon} alt="" />}<b>{m.title}</b></div>
                  <div className="desc">{m.description?.slice(0,120)}</div>
                  <div className="meta"><span className="pill"><Download size={12} /> {m.downloads?.toLocaleString?.() || m.downloads}</span>{m.updated && <span className="pill">↻ {new Date(m.updated).toLocaleDateString()}</span>}</div>
                  <div className="actions"><button className="mini" onClick={()=>doCfFiles(m.id)}>{t('packs.versions')}</button></div>
                  {(cfFiles[m.id]||[]).map((f)=>(
                    <div className="meta" key={f.id}>
                      <span className="pill">{f.name.length > 26 ? f.name.slice(0,25)+'…' : f.name}</span>
                      <button className="mini hot" disabled={cfBusy===f.id || !modsFor} onClick={()=>doCfInstall(m, f)}>
                        {cfBusy===f.id ? <><span className="spinner" />{t('mods.installing')}</> : t('mods.install')}
                      </button>
                    </div>
                  ))}
                  {cfFiles[m.id] && cfFiles[m.id].length===0 && <p style={{opacity:.6}}>Sin archivos para {fVersion}.</p>}
                </div>
              ))}
            </div>
            </>)}
            <h3>{t('mods.installed')} ({mods.length})</h3>
            {kind==='shader' && (
            <div className="row" style={{marginBottom:10}}>
              {shaderCur?.iris
                ? <span className="pill green">Iris OK{shaderCur.pack ? ` · ${shaderCur.pack}` : ''}</span>
                : <span className="pill">{t('mods.needIris')}</span>}
              {shaderCur?.pack && <button className="mini" onClick={async()=>{await window.ferro.shaderSet({instanceName:modsFor, file:null}); loadMods(modsFor);}}>{t('mods.shadersOff')}</button>}
            </div>
            )}
            {kind==='resourcepack' && rpOn===null && mods.length>0 && <p style={{opacity:.6}}>{t('mods.playOnce')}</p>}
            {kind==='mod' && (
            <div className="row" style={{marginBottom:10}}>
              <button className="ghost" onClick={checkUpdates} disabled={checkingUpd || !modsFor}>{checkingUpd ? t('mods.updating') : t('mods.checkUpd')}</button>
              {updMsg && <span className="pill green">{updMsg}</span>}
            </div>
            )}
            <div className="grid">
              {mods.map((m)=>{ const u = updMap[m.file];
                const rpActive = kind==='resourcepack' && rpOn?.includes(m.file);
                const shaderActive = kind==='shader' && shaderCur?.pack===m.file && shaderCur?.enabled;
                return (<div key={m.file} className="card"><div className="card-title" title={m.file}>{m.file}</div><div className="meta"><span className="pill">{(m.size/1048576).toFixed(1)} MB{m.disabled?' · desactivado':''}</span>{u && <span className="pill green">→ {u.latest}</span>}{rpActive && <span className="pill green">activo</span>}{shaderActive && <span className="pill green">en uso</span>}</div><div className="actions">
                {kind==='mod' && u && <button className="primary" onClick={()=>doModUpdate(u)}>{t('mods.update')}</button>}
                {kind==='resourcepack'
                  ? <button className="mini" onClick={async()=>{await window.ferro.rpToggle({instanceName:modsFor, file:m.file, enable:!rpActive}); loadMods(modsFor);}}>{rpActive?t('mods.deactivate'):t('mods.activate')}</button>
                  : kind==='shader'
                    ? <button className="mini hot" onClick={async()=>{await window.ferro.shaderSet({instanceName:modsFor, file:m.file}); loadMods(modsFor);}} disabled={!shaderCur?.iris}>{t('mods.use')}</button>
                    : <button className="mini" onClick={async()=>{await window.ferro.modToggle({instanceName:modsFor, file:m.file, disable:!m.disabled, kind}); loadMods(modsFor);}}>{m.disabled?t('mods.activate'):t('mods.deactivate')}</button>}
                <button className="mini danger" onClick={async()=>{await window.ferro.modRemove({instanceName:modsFor, file:m.file, kind}); loadMods(modsFor);}}><X size={12} /> {t('mods.remove')}</button>
              </div></div>);})}
            </div>
          </div>
        )}
        {tab==='packs' && (
          <div className="card">
            <h2>{t('packs.title')}</h2>
            <div className="row">
              <select value={packSrc} onChange={(e)=>{setPackSrc(e.target.value); setPackHits([]); setPackTotal(0); setPackVers({}); setCfPackVers({});}} title="Fuente">
                <option value="mr">Modrinth</option>
                <option value="cf">CurseForge</option>
              </select>
              <select value={packMc} onChange={(e)=>{touchedVer.current.pack=true; setPackMc(e.target.value);}}>
                {versions.map((v)=><option key={v.id} value={v.id}>{v.id}</option>)}
              </select>
              <input value={packQuery} onChange={(e)=>setPackQuery(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter') doPackSearch();}} placeholder={t('packs.searchPh')} />
              <select value={packLoader} onChange={(e)=>setPackLoader(e.target.value)} title="Loader">
                <option value="">{t('packs.loaderAll')}</option>
                <option value="fabric">Fabric</option>
                <option value="quilt">Quilt</option>
                <option value="forge">Forge</option>
                <option value="neoforge">NeoForge</option>
              </select>
              <select value={packSort} onChange={(e)=>setPackSort(e.target.value)} title="Orden">
                <option value="relevance">{t('mods.sRelevance')}</option>
                <option value="downloads">{t('mods.sDownloads')}</option>
                <option value="follows">{t('mods.sFollows')}</option>
                <option value="newest">{t('mods.sNewest')}</option>
                <option value="updated">{t('mods.sUpdated')}</option>
              </select>
              <button className="primary" onClick={()=>{packSrc==='cf' ? doCfPackSearch() : doPackSearch();}}><Search size={14} /> {t('packs.search')}</button>
            </div>
            <p style={{opacity:.65}}>{packTotal>0 ? `${packTotal.toLocaleString()} resultados · ` : ''}{packMc}{packLoader ? ` · ${packLoader}` : ''}. Crea una instancia nueva con el MC + loader que pida el pack. El progreso sale en ▶ Jugar.</p>
            <div className="grid">
              {packHits.map((p)=>(
                <div key={p.id} className="card">
                  <div className="mod-head">{p.icon && <img className="mod-icon" src={p.icon} alt="" />}<b>{p.title}</b></div>
                  <div className="desc">{p.description?.slice(0,120)}</div>
                  <div className="meta"><span className="pill"><Download size={12} /> {p.downloads?.toLocaleString?.() || p.downloads}</span>{p.updated && <span className="pill">↻ {new Date(p.updated).toLocaleDateString()}</span>}</div>
                    <div className="actions"><button className="ghost" onClick={()=>{packSrc==='cf' ? doCfPackVers(p.id) : doPackVers(p.id)}}>{(packSrc==='cf' ? cfPackVers[p.id] : packVers[p.id]) ? t('mods.hide') : t('packs.versions')}</button></div>
                  {(packSrc==='cf' ? (cfPackVers[p.id]||[]) : (packVers[p.id]||[])).map((v)=>(
                    <div className="meta" key={v.id}>
                      <span className="pill">{v.number || v.name}</span>
                      {(v.loaders||[]).map((ld)=><span className="pill" key={ld}>{ld}</span>)}
                      {(v.game||[]).slice(0,3).map((g)=><span className="pill" key={g}>{g}</span>)}
                      {packSrc==='cf'
                        ? <button className="mini hot" disabled={!!cfPackBusy} onClick={()=>doCfPackInstall(p, v)}>{cfPackBusy===v.id ? <><span className="spinner" />{t('mods.installing')}</> : t('mods.install')}</button>
                        : null}
                    </div>
                  ))}
                  {packSrc==='mr' && (packVers[p.id]||[]).map((v)=>(
                    <div className="meta" key={v.id}>
                      <span className="pill">{v.number}</span>
                      {(v.loaders||[]).map((ld)=><span className="pill" key={ld}>{ld}</span>)}
                      {(v.game||[]).slice(0,3).map((g)=><span className="pill" key={g}>{g}</span>)}
                      <button className="mini hot" disabled={!!packBusy} onClick={()=>doPackInstall(p, v)}>
                        {packBusy===v.id ? <><span className="spinner" />{t('mods.installing')}</> : t('mods.install')}
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
        {tab==='cuenta' && (
          <div className="card">
            <h2>{t('acct.title')}</h2>
            <p>{t('acct.desc')}</p>
            {idInfo.configured
              ? <div className="row"><span className="pill green">✓ {t('acct.idOn')} {idInfo.masked}</span></div>
              : (<div className="row">
                <input value={clientId} onChange={(e)=>setClientId(e.target.value)} placeholder={t('acct.clientPh')} style={{minWidth:300}} />
                <button className="ghost" onClick={async()=>{ if (!clientId.trim()) return; await window.ferro.setClientId({ clientId }); setLog((l)=>l+'[ferro] client ID guardado\n'); loadAuth();}}>{t('acct.save')}</button>
              </div>)}
            <h3>{t('acct.accounts')} ({accts.length})</h3>
            {accts.length===0 && <p style={{opacity:.6}}>{t('acct.noAccounts')}</p>}
            <div className="grid">
              {accts.map((a)=><div key={a.uuid} className="card"><div className="mod-head"><img className="face" src={`https://visage.surgeplay.com/face/64/${a.uuid.replace(/-/g,'')}`} alt="" onError={(e)=>{e.currentTarget.src=`https://minotar.net/helm/${a.uuid.replace(/-/g,'')}/64.png`;}} /><div className="card-title">{a.name}</div></div><div className="meta">{a.active && <span className="pill green">✓ {t('acct.active')}</span>}</div><div className="actions">
                {!a.active && <button className="mini" onClick={async()=>{await window.ferro.authSelect({uuid:a.uuid}); loadAuth();}}>{t('acct.use')}</button>}
                <button className="mini danger" onClick={async()=>{await window.ferro.authRemove({uuid:a.uuid}); loadAuth();}}><X size={12} /> {t('acct.remove')}</button>
              </div></div>)}
            </div>
            <h3>{t('acct.status')}</h3>
            {account
              ? <><div className="row"><span key={loginFx} className={`pill green${loginFx ? ' login-pop' : ''}`}>✓ {account.name}</span><button className="ghost danger" onClick={doLogout}>{t('acct.logout')}</button></div>
                {!browserWaiting && !authStep && <p style={{marginTop:10}}><button className="ghost" onClick={doBrowserAuth}>{t('acct.addAnother')}</button></p>}</>
              : browserWaiting
                ? <div className="card">
                    <p><span className="spinner" />{t('acct.waitBrowser')}</p>
                    <button className="ghost" onClick={cancelBrowserAuth}>{t('acct.cancel')}</button>
                  </div>
                : !authStep
                  ? <div className="row" data-tour="account-login">
                      <button className="primary" onClick={doBrowserAuth}>{t('acct.login')}</button>
                    </div>
                  : null}
            {!account && !browserWaiting && (
              !authStep
                  ? <p style={{marginTop:12}}><button className="ghost" onClick={doAuthStart} disabled={!(idInfo.configured || clientId)}>{t('acct.altMethod')}</button></p>
                : <div className="card">
                    <p>1. {t('acct.step1')} <b>{authStep.verificationUri}</b></p>
                    <p>2. {t('acct.step2')} <b style={{fontSize:22, letterSpacing:2}}>{authStep.userCode}</b></p>
                    <p style={{opacity:.65}}><span className="spinner" />{t('acct.waiting')} ({t('acct.checkN')} {pollCount})</p>
                    <div className="row">
                      <button className="mini" onClick={()=>doAuthPollOnce()}>{t('acct.checkNow')}</button>
                      <button className="mini" onClick={()=>{stopPoll(); setAuthStep(null);}}>{t('acct.cancel')}</button>
                    </div>
                  </div>)}
          </div>
        )}
        {tab==='skin' && (
          <div className="card">
            <h2>{t('skin.title')}</h2>
            <div className="row">
              <input value={skinName} onChange={(e)=>setSkinName(e.target.value)} placeholder={t('skin.namePh')} />
              <button className="mini" onClick={()=>loadSkin()}>{t('skin.view')}</button>
              {skinInfo?.online && <span className="pill green">✓ {t('skin.online')}</span>}
            </div>
            {!skinInfo && <p style={{opacity:.65}}>{t('skin.pressView')}</p>}
            {skinInfo?.note && <p style={{opacity:.65}}>{skinInfo.note}</p>}
            {skinInfo?.renders && (
              <div className="row" style={{alignItems:'flex-start', marginTop:12}}>
                <div className="card" style={{margin:0}}><div className="card-title">{skinInfo.name}</div><div className="meta"><span className="pill">{skinInfo.variant || 'classic'}</span>{skinInfo.cape && <span className="pill">{skinInfo.cape.alias || t('skin.capeDef')}</span>}</div><img src={skinInfo.renders.face} alt="cara" width={64} height={64} style={{borderRadius:12}} /></div>
                <div className="card" style={{margin:0}}><div className="card-title">{t('skin.body')}</div><img src={skinInfo.renders.full} alt="cuerpo" style={{maxHeight:280}} onError={(e)=>{e.currentTarget.src=`https://minotar.net/armor/body/${skinInfo.uuid}/150.png`;}} /></div>
                {skinInfo.cape && <div className="card" style={{margin:0}}><div className="card-title">{t('skin.cape')}</div><img src={skinInfo.cape.url} alt="capa" style={{maxHeight:200}} /></div>}
              </div>
            )}
            <h3>{t('skin.changeTitle')}</h3>
            <p style={{opacity:.65}}>{t('skin.changeDesc')}</p>
            <div className="row">
              <input value={skinUrl} onChange={(e)=>setSkinUrl(e.target.value)} placeholder="https://…/skin.png" style={{minWidth:280}} />
              <select value={skinVariant} onChange={(e)=>setSkinVariant(e.target.value)}>
                <option value="classic">{t('skin.classic')}</option>
                <option value="slim">{t('skin.slim')}</option>
              </select>
              <button className="primary" onClick={applySkin} disabled={skinBusy || !skinUrl}>{skinBusy ? t('skin.applying') : t('skin.apply')}</button>
              <button className="mini danger" onClick={resetSkin}>{t('skin.reset')}</button>
            </div>
          </div>
        )}
        {tab==='servers' && (
          <div className="card">
            <h2>{t('srv.title')}</h2>
            <div className="row">
              <input value={srvName} onChange={(e)=>setSrvName(e.target.value)} placeholder={t('srv.namePh')} style={{width:140}} />
              <input value={srvHost} onChange={(e)=>setSrvHost(e.target.value)} placeholder={t('srv.hostPh')} style={{minWidth:200}} />
              <input value={srvPort} onChange={(e)=>setSrvPort(e.target.value)} placeholder="25565" style={{width:90}} />
              <button className="primary" onClick={addServer}><Plus size={14} /> {t('srv.add')}</button>
            </div>
            <div className="grid" style={{marginTop:10}}>
              {servers.map((s)=>{const k=`${s.host}:${s.port}`; const p=srvPing[k]; return (<div key={k} className="card"><div className="card-title">{s.name}</div><div className="meta"><span className="pill">{s.host}:{s.port}</span>{p ? (p.online ? <><span className="pill green">● {p.latencyMs} ms</span><span className="pill">{p.players.online}/{p.players.max}</span><span className="pill">{p.version}</span></> : <span className="pill">{t('srv.offline')}</span>) : <span className="pill"><span className="spinner" /></span>}</div>{p?.motd && <p style={{opacity:.7}}>{p.motd}</p>}<div className="actions"><button className="mini" onClick={()=>pingServer(s)}><RefreshCw size={12} /></button><button className="ghost" onClick={()=>playOn(s)} disabled={!launchInstance}><Play size={14} /> {t('srv.play')}</button><button className="ghost danger" onClick={async()=>{setServers(await window.ferro.serverRemove({host:s.host, port:s.port}));}}><Trash2 size={12} /></button></div></div>);})}
            </div>
            {servers.length===0 && <p style={{opacity:.6}}>{t('srv.none')}</p>}
          </div>
        )}
        {tab==='ajustes' && (
          <>
          <div className="card" data-tour="settings">
            <h2>{t('set.updates')} {appVer && <span className="pill">v{appVer}</span>}</h2>
            <div className="row">
              <button className="ghost" onClick={async()=>{setUpd({state:'checking'}); try{await window.ferro.checkUpdate();}catch(e){setUpd({state:'error',error:e.message});}}}>{t('set.checkUpd')}</button>
              {upd.state==='checking' && <span className="pill"><span className="spinner" />{t('set.upChecking')}</span>}
              {upd.state==='available' && <span className="pill">{t('set.upAvail', {v:upd.version})}</span>}
              {upd.state==='downloading' && <span className="pill"><span className="spinner" />{(upd.percent||0).toFixed(0)}%</span>}
              {upd.state==='downloaded' && <><span className="pill green">✓ v{upd.version} {t('set.upReady')}</span><button className="primary" onClick={()=>window.ferro.quitAndInstall()}>{t('set.restart')}</button></>}
              {upd.state==='error' && <span className="pill">{t('set.upErr')}{upd.error?`: ${upd.error.slice(0,80)}`:''}</span>}
              {upd.state==='dev' && <span className="pill">{t('set.upDev')}</span>}
            </div>
          </div>
          <div className="card">
            <h2>{t('set.lang')} / Theme</h2>
            <div className="row">
              <select value={lang} onChange={(e)=>setLangBoth(e.target.value)}>
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
              <select value={theme} onChange={(e)=>setTheme(e.target.value)} title={t('set.theme')}>
                <option value="ember">Brasa</option>
                <option value="midnight">Medianoche</option>
                <option value="forest">Bosque</option>
                <option value="sakura">Sakura</option>
              </select>
              <button className="ghost" onClick={startTour}>{t('tour.replay')}</button>
            </div>
          </div>
          <div className="card">
            <h2>{t('set.sound')}</h2>
            <div className="row">
              <button className="ghost" onClick={()=>{sfx.cfg.enabled=!sfx.cfg.enabled; sfx.save(); setSfxOn(sfx.cfg.enabled); if(sfx.cfg.enabled) sfx.play('success');}}>{sfxOn ? `✓ ${t('set.sfxOn')}` : t('set.sfxOff')}</button>
              <select value={sfxPack} onChange={(e)=>{sfx.cfg.pack=e.target.value; sfx.save(); setSfxPack(sfx.cfg.pack); sfx.play('success');}} title={t('set.pack')}>
                <option value="cristal">{t('set.packCristal')}</option>
                <option value="asmr">{t('set.packAsmr')}</option>
              </select>
              <button className="ghost" onClick={()=>{sfx.cfg.hover=!sfx.cfg.hover; sfx.save(); setSfxHover(sfx.cfg.hover);}}>{t('set.hover')}: {sfxHover ? t('set.yes') : t('set.no')}</button>
              <label>{t('set.volume')} <input type="range" min={0} max={1} step={0.05} value={sfxVol} onChange={(e)=>{sfx.cfg.volume=Number(e.target.value); sfx.save(); setSfxVol(sfx.cfg.volume);}} style={{width:130}} /></label>
              <button className="ghost" onClick={()=>sfx.play('launch')}>{t('set.test')}</button>
            </div>
          </div>
          <div className="card">
            <h2>{t('set.discord')}</h2>
            <div className="row">
              <button className="ghost" onClick={async()=>{const v=!dcOn; setDcOn(v); await window.ferro.setDiscord({enabled:v});}}>{dcOn ? `✓ ${t('set.sfxOn')}` : t('set.sfxOff')}</button>
              <button className="ghost" onClick={async()=>{try{await window.ferro.testWebhook(); setLog((l)=>l+'[ferro] webhook OK\n');}catch(e){setLog((l)=>l+`[error] ${e.message}\n`);}}}>Probar envío</button>
            </div>
          </div>
          <div className="card">
            <h2>{t('set.share')}</h2>
            <div className="row">
              {social.github && <button className="ghost" onClick={()=>window.ferro.openUrl({url:social.github})}><GithubIcon size={15} /> GitHub</button>}
              {social.discord && <button className="ghost" onClick={()=>window.ferro.openUrl({url:social.discord})}><DiscordIcon size={16} /> Discord</button>}
              {social.youtube && <button className="ghost" onClick={()=>window.ferro.openUrl({url:social.youtube})}><YoutubeIcon size={16} /> YouTube</button>}
            </div>
            <div className="row" style={{marginTop:10}}>
              <button className="ghost" onClick={()=>shareLinks('x')}><XIcon size={13} /> X</button>
              <button className="ghost" onClick={()=>shareLinks('telegram')}>Telegram</button>
              <button className="ghost" onClick={()=>shareLinks('copy')}>Copiar enlace</button>
            </div>
          </div>
          <div className="card">
            <h2>{t('set.profile')}</h2>
            <p style={{opacity:.65}}>{t('set.profileDesc')}</p>
            <div className="row">
              <button className="ghost" onClick={async()=>{await window.ferro.profileBackup();}}><Upload size={14} /> {t('set.profileBk')}</button>
              <button className="ghost danger" onClick={()=>askConfirm(t('set.profileRsConfirm'), async()=>{await window.ferro.profileRestore(); refresh(); loadAuth();})}>{t('set.profileRs')}</button>
            </div>
          </div>
          <div className="card">
            <h2>{t('set.java')}</h2>
            <pre>{JSON.stringify(java, null, 2) || 'no encontrado'}</pre>
            <p style={{opacity:.7}}>{t('set.javaDesc')}</p>
            <p style={{opacity:.5, fontSize:12}}>Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft. · Contact: github.com/4DRI4N-OFF/FerroLauncher/issues</p>
          </div>
          </>
        )}
        </div>
      </div>
      {intro && (
        <div className="intro-overlay" ref={overlayRef}>
          <div ref={introImgRef} className="intro-logo">
            <img className="intro-full" src={brand} alt="" />
            <img className="intro-mini" src={flMark} alt="FL" />
          </div>
        </div>
      )}
      {flashKey > 0 && <div key={flashKey} className="vignette" />}
      {tourIdx !== null && (() => {
        const steps = tourSteps();
        const st = steps[tourIdx];
        if (!st) return null;
        const last = tourIdx === steps.length - 1;
        const tipStyle = tourRect
          ? (tourRect.y + tourRect.h + 220 < window.innerHeight
            ? { left: Math.min(Math.max(12, tourRect.x), window.innerWidth - 332), top: tourRect.y + tourRect.h + 12 }
            : { left: Math.min(Math.max(12, tourRect.x), window.innerWidth - 332), top: Math.max(12, tourRect.y - 232) })
          : { left: '50%', top: '50%', transform: 'translate(-50%,-50%)' };
        return (<>
          <div className="tour-dim" onClick={endTour} />
          {tourRect && <div className="tour-ring" style={{ left: tourRect.x, top: tourRect.y, width: tourRect.w, height: tourRect.h }} />}
          <div className="tour-tip" style={tipStyle}>
            <div key={tourIdx} className="tour-body">
              <b>{st.title}</b>
              <p>{st.body}</p>
            </div>
            <div className="tour-dots">{steps.map((_, i) => <span key={i} className={i === tourIdx ? 'on' : ''} />)}<span className="tour-count">{tourIdx + 1}/{steps.length}</span></div>
            <div className="row">
              <button className="mini" onClick={endTour}>{t('tour.skip')}</button>
              <span style={{ flex: 1 }} />
              {tourIdx > 0 && <button className="mini" onClick={() => setTourIdx(tourIdx - 1)}>{t('tour.back')}</button>}
              <button className="mini hot" onClick={() => (last ? endTour() : setTourIdx(tourIdx + 1))}>{last ? t('tour.finish') : t('tour.next')}</button>
            </div>
          </div>
        </>);
      })()}
      {scare && (
        <div className="scare" onClick={() => setScare(null)}>
          <div className="scare-title">{t('scare.title')}</div>
          <div className="scare-sub">{t('scare.sub')} <b>{scare.name}</b></div>
          <div className="scare-case">{t('scare.report')} {scare.caseId} · {t('scare.filed')}</div>
          <div className="scare-warn">{t('scare.warn')}</div>
        </div>
      )}
      <DynamicIsland open={islandOpen} setOpen={setIslandOpen} t={t}
        aiMsgs={aiMsgs} aiBusy={aiBusy} aiInput={aiInput} setAiInput={setAiInput} sendAi={sendAi} aiEndRef={aiEndRef}
        aiBuiltIn={aiBuiltIn} aiKey={aiKey} aiKeyInput={aiKeyInput} setAiKeyInput={setAiKeyInput} saveAiKey={saveAiKey}
        aiModels={aiModels} aiModel={aiModel} setAiModel={setAiModel} loadAiModels={loadAiModels}
        attachLog={attachLog} clearAi={clearAi} />
      <div className="toasts">
        {toasts.map((t)=>(
          <div key={t.id} className={`toast ${t.type}`}>
            {t.type === 'error' ? <AlertTriangle size={16} /> : t.type === 'success' ? <Check size={16} /> : <Info size={16} />}
            <span>{t.msg}</span>
            {t.action && <button className="mini hot" onClick={() => { t.action.fn(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>{t.action.label}</button>}
            <div className="t-bar" />
          </div>
        ))}
      </div>
      {dragOn && (
        <div className="confirm-overlay">
          <div className="card" style={{textAlign:'center'}}>
            <div className="card-title">{t('inst.dropTitle')}</div>
            <p style={{opacity:.75}}>{t('inst.dropHint')}</p>
          </div>
        </div>
      )}
      {flashFx > 0 && <div key={flashFx} className="login-flash" />}
      {confirmDlg && (
        <div className="confirm-overlay" onClick={()=>setConfirmDlg(null)}>
          <div className="card" onClick={(e)=>e.stopPropagation()} style={{minWidth:320, maxWidth:440}}>
            <div className="card-title">{t('ui.confirmTitle')}</div>
            <p style={{opacity:.8}}>{confirmDlg.message}</p>
            {confirmDlg.input && <input autoFocus value={confirmInput} onChange={(e)=>setConfirmInput(e.target.value)} onKeyDown={(e)=>{ if (e.key==='Enter') confirmGo(); }} placeholder={t('ui.enterName')} style={{width:'100%', marginTop:8}} />}
            <div className="row" style={{marginTop:12, justifyContent:'flex-end'}}>
              <button className="ghost" onClick={()=>setConfirmDlg(null)}>{t('ui.cancel')}</button>
              <button className="primary" onClick={confirmGo}>{t('ui.confirm')}</button>
            </div>
          </div>
        </div>
      )}
      {settingsFor && (
        <MorphModal origin={modalOrigin} closing={modalClosing} onClose={closeModal} title={settingsFor}>
          <div className="subhead"><span>{t('inst.settings')}</span></div>
          <div className="row">
            <label>{t('inst.ram')} <input type="number" value={sRam} min={512} max={16384} step={512} onChange={(e)=>setSRam(e.target.value)} style={{width:100}} /></label>
            <label>{t('inst.width')} <input type="number" value={sW} min={320} max={7680} onChange={(e)=>setSW(e.target.value)} style={{width:80}} /></label>
            <label>{t('inst.height')} <input type="number" value={sH} min={240} max={4320} onChange={(e)=>setSH(e.target.value)} style={{width:80}} /></label>
            <select value={sJavaMode} onChange={(e)=>setSJavaMode(e.target.value)}><option value="auto">{t('inst.javaAuto')}</option><option value="custom">{t('inst.javaCustom')}</option></select>
            {sJavaMode==='custom' && <input value={sJavaPath} onChange={(e)=>setSJavaPath(e.target.value)} placeholder="C:\...\bin\java.exe" style={{minWidth:200}} />}
            <select value={sJvm} onChange={(e)=>setSJvm(e.target.value)} title={t('inst.jvm')}><option value="equilibrado">{t('inst.jvmEq')}</option><option value="rendimiento">{t('inst.jvmPerf')}</option><option value="patata">{t('inst.jvmPotato')}</option><option value="zgc">{t('inst.jvmZgc')}</option></select>
            <button className="mini" onClick={async()=>{try{const r=await window.ferro.ramSuggest(); setSRam(String(r.suggestedMb)); setLog((l)=>l+`[ferro] RAM sugerida: ${r.suggestedMb} MB\n`);}catch(e){setLog((l)=>l+`[error] ${e.message}\n`);}}}>{t('inst.ramSug')}</button>
            <button className="primary" onClick={saveSettings} disabled={saving}>{saving ? t('inst.saving') : t('inst.save')}</button>
          </div>
          <div className="subhead"><span>{t('inst.backupsOf')} {settingsFor}</span><button className="mini" onClick={async()=>{await window.ferro.backupCreate({instanceName:settingsFor}); loadBackups(settingsFor);}}>{t('inst.createBk')}</button></div>
          {bkList.length===0 ? <p style={{opacity:.6}}>{t('inst.noBk')}</p> : (<div className="sublist">{bkList.map((b)=><div key={b.file} className="subrow"><span className="grow" title={b.file}>{b.file}</span><span className="pill">{(b.size/1048576).toFixed(1)} MB</span><button className="mini" onClick={async()=>{await window.ferro.backupRestore({instanceName:settingsFor, file:b.file});}}>{t('inst.restore')}</button><button className="mini danger" onClick={async()=>{await window.ferro.backupDelete({instanceName:settingsFor, file:b.file}); loadBackups(settingsFor);}}><Trash2 size={12} /></button></div>)}</div>)}
            <div className="subhead"><span>{t('inst.crashesOf')} {settingsFor}</span><button className="mini" onClick={async()=>{await window.ferro.openCrashes({instanceName:settingsFor});}}><FolderOpen size={12} /> {t('inst.folder')}</button><button className="mini" onClick={async()=>{try{setDiag(await window.ferro.diagnose({instanceName:settingsFor}));}catch(e){setLog((l)=>l+`[error] ${e.message}\n`);}}}><AlertTriangle size={12} /> {t('inst.diagnose')}</button></div>
            {diag && (diag.list.length===0 ? <p style={{opacity:.6}}>{t('inst.diagNone')}</p> : (<div className="sublist">{diag.list.map((d)=><div key={d.id} className="subrow"><span className="grow" title={d.desc}><b>{d.title}</b> — {d.desc}</span>{d.fix && <button className="mini" onClick={async()=>{try{await window.ferro.doctorFix({instanceName:settingsFor, fix:d.fix}); setLog((l)=>l+`[ferro] ${t('inst.fixed')}: ${d.title}\n`); setDiag(await window.ferro.diagnose({instanceName:settingsFor})); refresh();}catch(e){setLog((l)=>l+`[error] ${e.message}\n`);}}}>{d.fix.label || t('inst.applyFix')}</button>}</div>)}</div>))}
          {crList.length===0 ? <p style={{opacity:.6}}>{t('inst.noCrashes')}</p> : (<div className="sublist">{crList.map((c)=><div key={c.file} className="subrow"><span className="grow" title={c.description||c.file}>{c.description||c.file}</span><button className="mini" onClick={async()=>{const r = crOpen?.file===c.file ? null : await window.ferro.crashRead({instanceName:settingsFor, file:c.file}); setCrOpen(r);}}>{crOpen?.file===c.file ? t('mods.hide') : t('inst.view')}</button></div>)}</div>)}
          {crOpen && <pre style={{marginTop:4}}>{crOpen.content}{crOpen.truncated ? '\n…(truncado)' : ''}</pre>}
        </MorphModal>
      )}
      {galName && (
        <MorphModal origin={galOrigin} closing={galClosing} onClose={closeGallery} title={`${t('inst.shotsOf')} ${galName} (${galShots.length})`}>
          {galShots.length===0
            ? <p style={{opacity:.6}}>{t('inst.noShots')}</p>
            : (<div className="gal-grid">
              {galShots.map((s)=>(
                <div key={s.file} className="gal-item">
                  {s.thumb
                    ? <img src={s.thumb} alt={s.file} loading="lazy" onClick={async()=>{await window.ferro.shotView({instanceName:galName, file:s.file});}} />
                    : <div className="gal-ph"><span className="spinner" /></div>}
                  <div className="gal-foot"><span className="grow" title={s.file}>{s.file}</span></div>
                  <div className="actions">
                    <button className="mini" onClick={async()=>{await window.ferro.shotView({instanceName:galName, file:s.file});}}>{t('inst.view')}</button>
                    <button className="mini danger" onClick={async()=>{await window.ferro.shotDelete({instanceName:galName, file:s.file}); setGalShots((g)=>g.filter((x)=>x.file!==s.file));}}><Trash2 size={12} /></button>
                  </div>
                </div>
              ))}
            </div>)}
        </MorphModal>
      )}
    </div>
  );
}
