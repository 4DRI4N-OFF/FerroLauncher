const { app, BrowserWindow, ipcMain, shell, dialog, screen } = require('electron');
if (process.platform === 'win32') {
  try { app.setAppUserModelId('com.ferro.launcher'); } catch {}
}
const path = require('path');
const fs = require('fs');
const { getDataDir, dirs } = require('../core/constants');
const { ensureDirs, listInstances, createInstance, updateInstanceSettings, setForgeProfile, duplicateInstance, deleteInstance, renameInstance, touchPlayed, addPlayTime } = require('../core/instanceManager');
const { listVersions, getVersionDetails, downloadClientJar } = require('../core/mojangService');
const { findJava, ensureJava } = require('../core/javaManager');
const { resolveLibraries, launch } = require('../core/launcher');
const { resolveNatives } = require('../core/nativesService');
const { downloadAssets, downloadLoggingConfig } = require('../core/assetsService');
const { listLoaders, getLoaderMeta, resolveFabricLibraries } = require('../core/fabricService');
const quilt = require('../core/quiltService');
const { listForge, forgeInstallerUrl, listNeoForge, neoInstallerUrl, runInstaller, downloadInstaller } = require('../core/forgeService');

function loaderApi(type) {
  if (type === 'quilt') return { list: quilt.listLoaders, meta: quilt.getLoaderMeta, resolve: quilt.resolveQuiltLibraries, label: 'quilt' };
  return { list: listLoaders, meta: getLoaderMeta, resolve: resolveFabricLibraries, label: 'fabric' };
}
const { searchMods, listMods, installMod, removeMod, toggleMod, checkModUpdates, updateMod } = require('../core/modrinthService');
const { searchModpacks, packVersions, getPackVersion, installMrpack } = require('../core/modpackService');
const auth = require('../core/authService');
const skins = require('../core/skinService');
const backups = require('../core/backupService');
const discord = require('../core/discordService');
const crashes = require('../core/crashService');
const gallery = require('../core/galleryService');
const notify = require('../core/notifyService');
const cf = require('../core/curseforgeService');
const res = require('../core/resourceService');

function findInstance(d, name) {
  const inst = listInstances(d.instances).find((i) => i.name === name);
  if (!inst) throw new Error('Instancia no encontrada');
  return inst;
}

// Caché de nombres premium (sesión): name.lower -> uuid | null | 'unknown' (sin red)
const premiumCache = new Map();
async function premiumUuidOf(name) {
  const key = String(name || '').toLowerCase();
  if (premiumCache.has(key)) return premiumCache.get(key);
  let out = null;
  try {
    const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`);
    if (res.status === 200) out = (await res.json()).id || null;
    else if (res.status === 404 || res.status === 204 || res.status === 400) out = null;
    else out = 'unknown';
  } catch {
    out = 'unknown';
  }
  premiumCache.set(key, out);
  return out;
}

// Susto teatral: sacude la ventana unos ms (solo si no está maximizada)
function shakeWindow() {
  try {
    if (!win || win.isDestroyed() || win.isMaximized() || win.isMinimized() || win.isFullScreen()) return;
    const [x0, y0] = win.getPosition();
    [[-9, 4], [8, -6], [-6, 3], [5, -2], [-3, 1], [0, 0]].forEach(([dx, dy], i) => {
      setTimeout(() => { try { win.setPosition(x0 + dx, y0 + dy); } catch {} }, i * 55);
    });
  } catch {}
}

let win = null;
let splash = null;
let D = null;
let activeChild = null;
let activeInstance = null;
let activeT0 = null;

function fmtPlay(totalSecs) {
  const m = Math.floor((totalSecs || 0) / 60);
  if (m < 60) return `${m} min`;
  return `${(m / 60).toFixed(m < 600 ? 1 : 0)} h`;
}

function getDirs() {
  if (!D) {
    const base = getDataDir(app);
    D = dirs(base);
    ensureDirs(D);
  }
  return D;
}

function createSplash() {
  splash = new BrowserWindow({
    width: 380, height: 430,
    frame: false, transparent: true, alwaysOnTop: true,
    resizable: false, skipTaskbar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  splash._t0 = Date.now();
}

// Expande la ventana desde un rect inicial hasta el final con fade-in (morph splash -> app).
// El centro queda clavado: solo crece el tamaño, así el logo centrado no deriva.
function morphWindow(target, from, to, ms, done) {
  const t0 = Date.now();
  const cx = from.x + from.width / 2;
  const cy = from.y + from.height / 2;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const timer = setInterval(() => {
    const t = Math.min(1, (Date.now() - t0) / ms);
    const e = ease(t);
    try {
      const w = Math.round(from.width + (to.width - from.width) * e);
      const h = Math.round(from.height + (to.height - from.height) * e);
      target.setBounds({ x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), width: w, height: h });
      target.setOpacity(Math.max(0, Math.min(1, e)));
    } catch { clearInterval(timer); return; }
    if (t >= 1) {
      clearInterval(timer);
      try { target.setOpacity(1); } catch {}
      done && done();
    }
  }, 16);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 700,
    autoHideMenuBar: true,
    backgroundColor: '#0d0908',
    show: false,
    icon: path.join(__dirname, '../build/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const dev = !app.isPackaged;
  if (dev) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, '../dist/index.html'));
  win.once('ready-to-show', () => {
    // Tiempo mínimo para que la animación del splash se aprecie
    const wait = Math.max(0, 2400 - (Date.now() - ((splash && splash._t0) || Date.now())));
    setTimeout(() => {
      try {
        if (win && !win.isDestroyed()) {
          // La ventana nace con el tamaño del splash y crece hasta la app (morph)
          let from = null;
          const target = { width: 1100, height: 700, x: undefined, y: undefined };
          try {
            if (splash && !splash.isDestroyed()) {
              from = splash.getBounds();
              const area = screen.getDisplayMatching(from).workArea;
              target.x = Math.round(area.x + (area.width - 1100) / 2);
              target.y = Math.round(area.y + (area.height - 700) / 2);
              win.setBounds(from);
            }
          } catch {}
          win.setOpacity(0);
          win.show();
          win.webContents.send('ferro:shown');
          const settled = () => { try { win.webContents.send('ferro:settled'); } catch {} };
          if (from) morphWindow(win, from, target, 650, settled);
          else { try { win.setOpacity(1); } catch {} settled(); }
          // Solape: el splash tapa el primer tramo para que no haya corte
          setTimeout(() => {
            try { if (splash && !splash.isDestroyed()) splash.close(); } catch {}
            splash = null;
          }, 250);
        }
      } catch {}
    }, wait);
  });
  // Seguridad: si la ventana no carga (p. ej. sin servidor dev), no dejar el splash colgado
  setTimeout(() => {
    try {
      if (splash && !splash.isDestroyed() && win && !win.isVisible()) {
        splash.close(); splash = null; win.show(); win.webContents.send('ferro:shown'); win.webContents.send('ferro:settled');
      }
    } catch {}
  }, 25000);
}

app.whenReady().then(() => {
  getDirs();
  createSplash();
  createWindow();
  initUpdater();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// Auto-update desde GitHub Releases (solo en builds empaquetados)
let updater = null;
function initUpdater() {
  if (!app.isPackaged) return;
  try {
    updater = require('electron-updater').autoUpdater;
  } catch { return; }
  updater.autoDownload = true;
  const push = (state, data) => win && win.webContents.send('ferro:update', { state, ...(data || {}) });
  updater.on('checking-for-update', () => push('checking'));
  updater.on('update-available', (info) => push('available', { version: info?.version }));
  updater.on('update-not-available', () => push('idle'));
  updater.on('download-progress', (p) => push('downloading', { percent: p?.percent || 0 }));
  updater.on('update-downloaded', (info) => push('downloaded', { version: info?.version }));
  updater.on('error', (e) => push('error', { error: String((e && e.message) || e) }));
  updater.checkForUpdates().catch(() => {});
}

ipcMain.handle('ferro:appVersion', async () => app.getVersion());
ipcMain.handle('ferro:checkUpdate', async () => {
  if (!app.isPackaged || !updater) return { state: 'dev', version: app.getVersion() };
  await updater.checkForUpdates();
  return true;
});
ipcMain.handle('ferro:quitAndInstall', async () => {
  if (updater) updater.quitAndInstall(false, true);
  return true;
});

ipcMain.handle('ferro:versions', async () => {
  const all = await listVersions();
  return all.filter((v) => v.type === 'release').slice(0, 30);
});

ipcMain.handle('ferro:instances', async () => listInstances(getDirs().instances));
ipcMain.handle('ferro:createInstance', async (_, { name, versionId, type, loaderVersion }) => createInstance(getDirs().instances, name, versionId, { type, loaderVersion }));
ipcMain.handle('ferro:loaders', async (_, { mcVersion, type }) => {
  if (type === 'forge') return (await listForge(mcVersion)).map((f) => ({ loader: f.version, tag: f.tag }));
  if (type === 'neoforge') return (await listNeoForge(mcVersion)).map((v) => ({ loader: v, stable: true }));
  return loaderApi(type).list(mcVersion);
});

ipcMain.handle('ferro:modSearch', async (_, { query, mcVersion, loader, sort, kind }) => searchMods(query || '', mcVersion, ['quilt', 'forge', 'neoforge'].includes(loader) ? loader : 'fabric', { sort, kind: ['shader', 'resourcepack'].includes(kind) ? kind : 'mod' }));
ipcMain.handle('ferro:mods', async (_, { instanceName, kind }) => listMods(findInstance(getDirs(), instanceName).path, kind));
ipcMain.handle('ferro:modInstall', async (event, { instanceName, projectId, kind }) => {
  const k = ['shader', 'resourcepack'].includes(kind) ? kind : 'mod';
  const inst = findInstance(getDirs(), instanceName);
  if (k === 'mod' && inst.type === 'vanilla') throw new Error('Los mods requieren instancia con loader');
  const send = (t) => win && win.webContents.send('ferro:log', t);
  const r = await installMod(inst.path, projectId, inst.versionId, inst.type, send, k);
  notify(getDirs().base, 'ok', `Contenido instalado`, `${r.file} → ${instanceName}`);
  return r;
});
ipcMain.handle('ferro:modRemove', async (_, { instanceName, file, kind }) => {
  removeMod(findInstance(getDirs(), instanceName).path, file, kind);
  return true;
});
ipcMain.handle('ferro:modToggle', async (_, { instanceName, file, disable, kind }) => toggleMod(findInstance(getDirs(), instanceName).path, file, disable, kind));
ipcMain.handle('ferro:modUpdates', async (event, { instanceName }) => {
  const inst = findInstance(getDirs(), instanceName);
  const send = (t) => win && win.webContents.send('ferro:log', t);
  return checkModUpdates(inst.path, inst.versionId, inst.type === 'vanilla' ? 'fabric' : inst.type, (s) => send(`[ferro] revisando mods ${s.done}/${s.total}\n`));
});
ipcMain.handle('ferro:modUpdate', async (_, { instanceName, file, projectId }) => {
  const d = getDirs();
  const inst = findInstance(d, instanceName);
  const send = (t) => win && win.webContents.send('ferro:log', t);
  return updateMod(inst.path, projectId, inst.versionId, inst.type === 'vanilla' ? 'fabric' : inst.type, file, send);
});
ipcMain.handle('ferro:cfKey', async () => (cf.getKey(getDirs().base) ? '••••' + cf.getKey(getDirs().base).slice(-4) : ''));
ipcMain.handle('ferro:cfSetKey', async (_, { key }) => cf.setKey(getDirs().base, key));
ipcMain.handle('ferro:cfSearch', async (_, { query, mcVersion, kind, sort }) => cf.search(getDirs().base, query || '', mcVersion, kind, sort));
ipcMain.handle('ferro:cfFiles', async (_, { modId, mcVersion, loader }) => cf.files(getDirs().base, modId, mcVersion, loader));
ipcMain.handle('ferro:cfInstall', async (_, { instanceName, modId, fileId, kind }) => {
  const inst = findInstance(getDirs(), instanceName);
  const send = (t) => win && win.webContents.send('ferro:log', t);
  return cf.installFile(getDirs().base, inst.path, modId, fileId, kind, send);
});
ipcMain.handle('ferro:rp', async (_, { instanceName }) => {
  const inst = findInstance(getDirs(), instanceName);
  return { enabled: res.getEnabledRP(inst.path), iris: res.hasIris(inst.path) };
});
ipcMain.handle('ferro:rpToggle', async (_, { instanceName, file, enable }) => {
  const inst = findInstance(getDirs(), instanceName);
  return res.setRPEnabled(inst.path, file, enable);
});
ipcMain.handle('ferro:shader', async (_, { instanceName }) => {
  const inst = findInstance(getDirs(), instanceName);
  return { ...res.getShader(inst.path), iris: res.hasIris(inst.path) };
});
ipcMain.handle('ferro:shaderSet', async (_, { instanceName, file }) => {
  const inst = findInstance(getDirs(), instanceName);
  return res.setShader(inst.path, file || null);
});
ipcMain.handle('ferro:packSearch', async (_, { query, mcVersion, loader, sort }) => searchModpacks(query || '', mcVersion, { loader: ['fabric', 'forge', 'neoforge', 'quilt'].includes(loader) ? loader : null, sort }));
ipcMain.handle('ferro:packVersions', async (_, { projectId, mcVersion, loader }) => {
  const vers = await packVersions(projectId, mcVersion, ['fabric', 'forge', 'neoforge', 'quilt'].includes(loader) ? [loader] : undefined);
  return vers.map((v) => ({ id: v.id, number: v.version_number, type: v.version_type, loaders: v.loaders, game: v.game_versions, files: v.files?.length || 0 }));
});
ipcMain.handle('ferro:packInstall', async (_, { name, projectId, packVersionId, mcVersion }) => {
  const d = getDirs();
  const send = (t) => win && win.webContents.send('ferro:log', t);
  const ver = await getPackVersion(packVersionId);
  const mrpack = (ver.files || []).find((f) => f.filename.endsWith('.mrpack')) || ver.files?.[0];
  if (!mrpack?.url) throw new Error('Versión sin .mrpack');
  const inst = createInstance(d.instances, name || `${ver.name || 'Modpack'}`, mcVersion, { type: 'fabric' });
  send(`[ferro] instalando modpack en ${inst.name}...\n`);
  const info = await installMrpack(inst.path, mrpack.url, send);
  // Ajusta la instancia a lo que pide el pack (MC + loader exactos)
  const fs = require('fs');
  const cfgPath = require('path').join(inst.path, 'ferro.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  if (info.mcVersion) cfg.versionId = info.mcVersion;
  if (info.loaderVersion) cfg.loaderVersion = info.loaderVersion;
  cfg.type = info.loaderType || 'fabric';
  cfg.modpack = { projectId, packVersionId, packName: info.name };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  send(`[ferro] modpack listo: ${info.files} archivos, MC ${cfg.versionId} + ${cfg.type} ${cfg.loaderVersion || ''}\n`);
  return { name: inst.name, ...cfg };
});
ipcMain.handle('ferro:java', async () => (await findJava()) || null);

ipcMain.handle('ferro:clientId', async () => auth.getClientId(getDirs().base));
ipcMain.handle('ferro:discord', async () => ({ ...auth.getDiscord(getDirs().base), webhook: readWebhook(getDirs().base) }));
ipcMain.handle('ferro:setDiscord', async (_, patch) => {
  const d = writeWebhook(getDirs().base, patch || {});
  return { ...auth.setDiscord(getDirs().base, patch || {}), webhook: d };
});
ipcMain.handle('ferro:testWebhook', async () => {
  const ok = await notify(getDirs().base, 'ok', 'FerroLauncher conectado', 'Webhook funcionando. Avisaré de partidas, crashes e instalaciones.');
  if (!ok) throw new Error('No se pudo enviar (URL inválida o sin conexión)');
  return true;
});
ipcMain.handle('ferro:openUrl', async (_, { url }) => {
  const u = String(url || '');
  if (!/^https:\/\/(x\.com|www\.reddit\.com|wa\.me|t\.me|github\.com|discord\.gg|discord\.com|www\.youtube\.com|youtu\.be|www\.tiktok\.com)\//.test(u)) throw new Error('URL no permitida');
  await shell.openExternal(u);
  return true;
});
ipcMain.handle('ferro:social', async () => ({
  github: 'https://github.com/4DRI4N-OFF/FerroLauncher',
  discord: readSocial(getDirs().base).discord || '',
  youtube: readSocial(getDirs().base).youtube || '',
}));

function readSocial(base) {
  try {
    const s = JSON.parse(require('fs').readFileSync(require('path').join(base, 'ferro-config.json'), 'utf8')).social || {};
    return { discord: 'https://discord.gg/vTujTm3hE', youtube: 'https://www.youtube.com/@4dri4n-08', ...s };
  }
  catch { return { discord: 'https://discord.gg/vTujTm3hE', youtube: 'https://www.youtube.com/@4dri4n-08' }; }
}
function readWebhook(base) {
  try { return JSON.parse(require('fs').readFileSync(require('path').join(base, 'ferro-config.json'), 'utf8')).discordWebhook || ''; }
  catch { return ''; }
}
function writeWebhook(base, patch) {
  const fs = require('fs');
  const path = require('path');
  const p = path.join(base, 'ferro-config.json');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
  if (patch.webhook !== undefined) cfg.discordWebhook = String(patch.webhook || '').trim();
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return cfg.discordWebhook || '';
}
ipcMain.handle('ferro:setClientId', async (_, { clientId }) => auth.setClientId(getDirs().base, clientId));
ipcMain.handle('ferro:authStatus', async () => {
  const acc = auth.loadAccount(getDirs().base);
  return acc ? { name: acc.profile?.name, uuid: acc.profile?.uuid } : null;
});
ipcMain.handle('ferro:authStart', async () => auth.deviceStart(auth.getClientId(getDirs().base)));
ipcMain.handle('ferro:authPoll', async (_, { deviceCode }) => {
  const d = getDirs();
  const r = await auth.devicePollOnce(auth.getClientId(d.base), deviceCode);
  if (r.status !== 'done') return r;
  const acc = await auth.completeLogin(d.base, r.accessToken, r.refreshToken);
  return { status: 'done', name: acc.profile.name, uuid: acc.profile.uuid };
});
ipcMain.handle('ferro:authLogout', async () => { auth.clearAccount(getDirs().base); return true; });
ipcMain.handle('ferro:accounts', async () => auth.listAccounts(getDirs().base));
ipcMain.handle('ferro:authSelect', async (_, { uuid }) => auth.setActive(getDirs().base, uuid));
ipcMain.handle('ferro:authRemove', async (_, { uuid }) => auth.removeAccount(getDirs().base, uuid));

async function mcTokenOrThrow() {
  const d = getDirs();
  const acc = await auth.validAccount(d.base, auth.getClientId(d.base));
  if (!acc) throw new Error('Inicia sesión Microsoft primero (👤 Cuenta)');
  return acc;
}
ipcMain.handle('ferro:skin', async (_, { name }) => {
  const d = getDirs();
  const acc = await auth.validAccount(d.base, auth.getClientId(d.base)).catch(() => null);
  if (acc) {
    const res = await fetch('https://api.minecraftservices.com/minecraft/profile', { headers: { Authorization: `Bearer ${acc.mcToken}` } });
    if (!res.ok) throw new Error(`Mojang HTTP ${res.status}`);
    return { online: true, ...skins.summarize(await res.json()) };
  }
  const uuid = await skins.resolveUuid(name || 'Ferro');
  if (!uuid) return { online: false, name: name || 'Ferro', uuid: null, renders: null, note: 'Sin sesión y nombre no premium: vista previa no disponible' };
  return { online: false, name, uuid, renders: skins.renders(uuid), note: 'Vista previa (offline: el juego usará Steve/Alex)' };
});
ipcMain.handle('ferro:skinApply', async (_, { variant, url }) => {
  const acc = await mcTokenOrThrow();
  return skins.applySkin(acc.mcToken, { variant, url });
});
ipcMain.handle('ferro:skinReset', async () => {
  const acc = await mcTokenOrThrow();
  return skins.resetSkin(acc.mcToken);
});

let authWin = null;
ipcMain.handle('ferro:authWindowCancel', async () => { try { if (authWin && !authWin.isDestroyed()) authWin.close(); } catch {} authWin = null; return true; });
ipcMain.handle('ferro:authWindow', async () => {
  const d = getDirs();
  const clientId = auth.getClientId(d.base);
  if (!clientId) throw new Error('Falta el client ID');
  if (authWin && !authWin.isDestroyed()) { authWin.focus(); return true; }
  const crypto = require('crypto');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(8).toString('hex');
  const url = auth.authorizeUrl({ clientId, redirectUri: auth.NATIVE_REDIRECT, challenge, state });

  authWin = new BrowserWindow({
    width: 480, height: 700, parent: win, modal: false,
    autoHideMenuBar: true, title: 'Iniciar sesión con Microsoft',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  authWin.loadURL(url);

  const done = (err, acc) => {
    try { if (authWin && !authWin.isDestroyed()) authWin.close(); } catch {}
    authWin = null;
    if (err) win && win.webContents.send('ferro:auth-error', { error: err.message || String(err) });
    else win && win.webContents.send('ferro:auth-done', { name: acc.profile.name, uuid: acc.profile.uuid });
  };

  let handled = false;
  const intercept = async (navUrl) => {
    if (!navUrl.startsWith(auth.NATIVE_REDIRECT)) return false;
    if (handled) return true; // la redirección ya se está procesando: ignora el duplicado
    handled = true;
    win && win.webContents.send('ferro:log', '[ferro] respuesta de Microsoft recibida, canjeando…\n');
    try {
      const u = new URL(navUrl);
      if (u.searchParams.get('state') !== state) throw new Error('state inválido');
      if (u.searchParams.get('error')) throw new Error(u.searchParams.get('error_description') || u.searchParams.get('error'));
      const code = u.searchParams.get('code');
      if (!code) throw new Error('Sin código de Microsoft');
      const acc = await auth.exchangeCode({ clientId, code, redirectUri: auth.NATIVE_REDIRECT, verifier, baseDir: d.base });
      done(null, acc);
    } catch (err) { done(err); }
    return true;
  };

  authWin.webContents.on('will-redirect', (e, navUrl) => {
    if (!navUrl.startsWith(auth.NATIVE_REDIRECT)) return;
    e.preventDefault(); // síncrono: frena la navegación antes de procesar
    intercept(navUrl);
  });
  // Red de seguridad: algunas navegaciones no pasan por will-redirect
  authWin.webContents.on('did-navigate', async (_, navUrl) => { await intercept(navUrl); });
  authWin.webContents.on('did-fail-load', (_, code, desc, navUrl) => {
    if (navUrl.startsWith(auth.NATIVE_REDIRECT)) return; // esperado: esa URL no es una página real
    win && win.webContents.send('ferro:log', `[ferro] la ventana de login falló al cargar (${code} ${desc})\n`);
  });
  authWin.on('closed', () => { authWin = null; });
  return true;
});

ipcMain.handle('ferro:updateSettings', async (_, { instanceName, patch }) => updateInstanceSettings(getDirs().instances, instanceName, patch || {}));
ipcMain.handle('ferro:openFolder', async (_, { instanceName }) => {
  const p = findInstance(getDirs(), instanceName).path;
  await shell.openPath(p);
  return true;
});
ipcMain.handle('ferro:duplicateInstance', async (_, { instanceName }) => duplicateInstance(getDirs().instances, instanceName));
ipcMain.handle('ferro:deleteInstance', async (_, { instanceName }) => deleteInstance(getDirs().instances, instanceName));
ipcMain.handle('ferro:renameInstance', async (_, { instanceName, newName }) => renameInstance(getDirs().instances, instanceName, newName));

ipcMain.handle('ferro:exportInstance', async (_, { instanceName }) => {
  const d = getDirs();
  const inst = findInstance(d, instanceName);
  const send = (t) => win && win.webContents.send('ferro:log', t);
  const { filePath } = await dialog.showSaveDialog(win, { title: 'Exportar instancia', defaultPath: `${instanceName}.ferro`, filters: [{ name: 'Ferro pack', extensions: ['ferro'] }] });
  if (!filePath) return null;
  return backups.exportInstance(inst.path, filePath, send);
});
ipcMain.handle('ferro:importInstance', async () => {
  const d = getDirs();
  const send = (t) => win && win.webContents.send('ferro:log', t);
  const { filePaths } = await dialog.showOpenDialog(win, { title: 'Importar instancia', filters: [{ name: 'Ferro pack', extensions: ['ferro'] }], properties: ['openFile'] });
  if (!filePaths?.[0]) return null;
  return backups.importPack(filePaths[0], d.instances, send);
});
ipcMain.handle('ferro:backups', async (_, { instanceName }) => backups.listBackups(getDirs().base, instanceName));
ipcMain.handle('ferro:backupCreate', async (_, { instanceName }) => {
  const d = getDirs();
  const send = (t) => win && win.webContents.send('ferro:log', t);
  return backups.createBackup(d.base, findInstance(d, instanceName).path, instanceName, send);
});
ipcMain.handle('ferro:backupRestore', async (_, { instanceName, file }) => {
  const d = getDirs();
  const send = (t) => win && win.webContents.send('ferro:log', t);
  return backups.restoreBackup(d.base, d.instances, instanceName, file, send);
});
ipcMain.handle('ferro:backupDelete', async (_, { instanceName, file }) => backups.deleteBackup(getDirs().base, instanceName, file));
ipcMain.handle('ferro:profileBackup', async () => {
  const d = getDirs();
  const send = (t) => win && win.webContents.send('ferro:log', t);
  const stamp = new Date().toISOString().slice(0, 10);
  const { filePath } = await dialog.showSaveDialog(win, { title: 'Copia total del perfil', defaultPath: `ferro-perfil-${stamp}.ferro`, filters: [{ name: 'Ferro perfil', extensions: ['ferro'] }] });
  if (!filePath) return null;
  return backups.profileBackup(d.base, filePath, send);
});
ipcMain.handle('ferro:profileRestore', async () => {
  const d = getDirs();
  const send = (t) => win && win.webContents.send('ferro:log', t);
  const { filePaths } = await dialog.showOpenDialog(win, { title: 'Restaurar perfil', filters: [{ name: 'Ferro perfil', extensions: ['ferro'] }], properties: ['openFile'] });
  if (!filePaths?.[0]) return null;
  return backups.profileRestore(filePaths[0], d.base, send);
});
ipcMain.handle('ferro:crashes', async (_, { instanceName }) => crashes.listCrashes(findInstance(getDirs(), instanceName).path));
ipcMain.handle('ferro:crashRead', async (_, { instanceName, file }) => crashes.readCrash(findInstance(getDirs(), instanceName).path, file));
ipcMain.handle('ferro:openCrashes', async (_, { instanceName }) => {
  const dir = crashes.crashDir(findInstance(getDirs(), instanceName).path);
  require('fs').mkdirSync(dir, { recursive: true });
  await shell.openPath(dir);
  return true;
});
ipcMain.handle('ferro:shots', async (_, { instanceName }) => gallery.listShots(findInstance(getDirs(), instanceName).path));
ipcMain.handle('ferro:shotThumb', async (_, { instanceName, file }) => {
  const list = gallery.listShots(findInstance(getDirs(), instanceName).path);
  const hit = list.find((s) => s.file === path.basename(file));
  if (!hit) throw new Error('Captura no encontrada');
  if (hit.size > 15 * 1048576) throw new Error('Imagen demasiado grande');
  return { file: hit.file, dataUrl: 'data:image/png;base64,' + require('fs').readFileSync(hit.path).toString('base64') };
});
ipcMain.handle('ferro:shotView', async (_, { instanceName, file }) => {
  const list = gallery.listShots(findInstance(getDirs(), instanceName).path);
  const hit = list.find((s) => s.file === path.basename(file));
  if (!hit) throw new Error('Captura no encontrada');
  await shell.openPath(hit.path);
  return true;
});
ipcMain.handle('ferro:shotDelete', async (_, { instanceName, file }) => gallery.deleteShot(findInstance(getDirs(), instanceName).path, file));
ipcMain.handle('ferro:openShots', async (_, { instanceName }) => {
  const dir = gallery.shotsDir(findInstance(getDirs(), instanceName).path);
  require('fs').mkdirSync(dir, { recursive: true });
  await shell.openPath(dir);
  return true;
});
ipcMain.handle('ferro:stop', async () => {
  if (!activeChild || activeChild.killed || activeChild.exitCode !== null) return false;
  const send = (t) => win && win.webContents.send('ferro:log', t);
  send(`[ferro] deteniendo ${activeInstance || 'juego'}...\n`);
  activeChild.kill();
  setTimeout(() => { try { if (activeChild && activeChild.exitCode === null) activeChild.kill('SIGKILL'); } catch {} }, 5000);
  return true;
});
ipcMain.handle('ferro:status', async () => ({ running: !!activeChild && activeChild.exitCode === null && !activeChild.killed, instance: activeInstance }));

const NAME_RE = /^[a-zA-Z0-9_]{3,16}$/;
ipcMain.handle('ferro:nameCheck', async (_, { name }) => {
  const clean = String(name || '').trim();
  if (!NAME_RE.test(clean)) return { name: clean, valid: false };
  const uuid = await premiumUuidOf(clean).catch(() => 'unknown');
  return { name: clean, valid: true, premium: !!uuid && uuid !== 'unknown', unknown: uuid === 'unknown' };
});
ipcMain.handle('ferro:nameSuggest', async (_, { base }) => {
  const b = String(base || '').trim().replace(/[^a-zA-Z0-9_]/g, '').slice(0, 12) || 'Ferro';
  const cap = b.charAt(0).toUpperCase() + b.slice(1);
  const r2 = () => String(Math.floor(Math.random() * 90) + 10);
  const raw = [`${b}_`, `_${b}`, `${b}${r2()}`, `${b}HD`, `${b}YT`, `${b}MC`, `${b}GG`, `${b}Pro`, `xX${b}Xx`.slice(0, 16), `The${cap}`.slice(0, 16), `${b}x`, `${cap}Gamer`.slice(0, 16)];
  const cands = [...new Set(raw)].filter((n) => NAME_RE.test(n) && n.toLowerCase() !== b.toLowerCase()).slice(0, 10);
  const out = [];
  await Promise.all(cands.map(async (n) => {
    const u = await premiumUuidOf(n).catch(() => 'unknown');
    if (u === null) out.push(n);
  }));
  return out.slice(0, 4);
});

ipcMain.handle('ferro:launch', async (event, { instanceName, username, ramMb, width, height }) => {
  if (activeChild && activeChild.exitCode === null && !activeChild.killed) throw new Error('Ya hay una instancia en ejecución. Deténla primero.');
  const d = getDirs();
  const path = require('path');
  const instances = listInstances(d.instances);
  const inst = instances.find((i) => i.name === instanceName);
  if (!inst) throw new Error('Instancia no encontrada');
  const send = (t) => win && win.webContents.send('ferro:log', t);

  send(`[ferro] resolviendo ${inst.versionId}...\n`);
  const vanilla = await getVersionDetails(inst.versionId);
  const requiredJavaVanilla = vanilla.javaVersion?.majorVersion || null;
  if (requiredJavaVanilla) send(`[ferro] esta versión pide Java ${requiredJavaVanilla}\n`);

  // Java antes: el instalador Forge/NeoForge también lo necesita
  const { checkJava } = require('../core/javaManager');
  let java;
  if (inst.settings?.javaMode === 'custom' && inst.settings?.javaPath) {
    const custom = await checkJava(inst.settings.javaPath);
    if (!custom) throw new Error(`Java personalizado no válido: ${inst.settings.javaPath}`);
    if (requiredJavaVanilla && custom.major !== null && requiredJavaVanilla > 8 && custom.major < requiredJavaVanilla) {
      send(`[ferro] aviso: tu java personalizado es ${custom.major} y se pide ${requiredJavaVanilla}\n`);
    }
    java = custom;
  } else {
    java = await ensureJava(requiredJavaVanilla, d.runtimes, send);
  }
  const javaBin = java.path === 'java' ? 'java' : java.path;
  send(`[ferro] Java ${java.version} (major ${java.major}) en ${java.path}${java.managed ? ' [gestionado]' : ''}\n`);

  // Perfil efectivo: vanilla, modloader ligero, o el generado por el instalador Forge/NeoForge
  let details = vanilla;
  let profileDir = path.join(d.versions, vanilla.id);
  let mainClassOverride = null, extraClasspath = [];
  if (inst.type === 'forge' || inst.type === 'neoforge') {
    const isForge = inst.type === 'forge';
    const ver = inst.loaderVersion;
    if (!ver) throw new Error(`Crea la instancia eligiendo versión de ${inst.type}`);
    const installerJar = path.join(d.versions, '_installers', `${inst.type}-${inst.versionId}-${ver}-installer.jar`);
    await downloadInstaller(isForge ? forgeInstallerUrl(inst.versionId, ver) : neoInstallerUrl(ver), installerJar);
    send(`[ferro] instalador ${inst.type} ${ver} listo\n`);
    let profileJson = inst.forgeProfileId ? path.join(d.versions, inst.forgeProfileId, `${inst.forgeProfileId}.json`) : null;
    if (!profileJson || !fs.existsSync(profileJson)) {
      profileJson = await runInstaller(javaBin, installerJar, d.base, d.versions, send);
      const pid = path.basename(path.dirname(profileJson));
      setForgeProfile(d.instances, inst.name, { forgeProfileId: pid });
      send(`[ferro] perfil ${inst.type} instalado: ${pid}\n`);
    } else {
      send(`[ferro] perfil ${inst.type} ya instalado\n`);
    }
    profileDir = path.dirname(profileJson);
    details = JSON.parse(fs.readFileSync(profileJson, 'utf8'));
  } else if (inst.type === 'fabric' || inst.type === 'quilt') {
    const api = loaderApi(inst.type);
    const loaders = await api.list(inst.versionId);
    const pick = inst.loaderVersion || loaders[0]?.loader;
    if (!pick) throw new Error(`${api.label} sin loader para ${inst.versionId}`);
    send(`[ferro] ${api.label} loader ${pick}...\n`);
    const meta = await api.meta(inst.versionId, pick);
    const fab = await api.resolve(meta, d.libraries, (s) => send(`[ferro] ${api.label} ${s.done}/${s.total} ${s.lib}\n`));
    mainClassOverride = fab.mainClass;
    extraClasspath = fab.classpathExtra;
    send(`[ferro] ${api.label}: ${fab.count} libs, main ${fab.mainClass}\n`);
  }
  const requiredJava = details.javaVersion?.majorVersion || requiredJavaVanilla;

  const forClient = details.downloads?.client?.url ? details : vanilla;
  const clientJar = await downloadClientJar(forClient, d.versions, (p) => send(`[ferro] client ${(p*100).toFixed(0)}%\n`));
  const cp = await resolveLibraries(details, d.libraries, (s) => send(`[ferro] lib ${s.done}/${s.total} ${s.lib}\n`));
  const nativesDir = path.join(profileDir, 'natives-windows');
  await resolveNatives(details, d.libraries, nativesDir, (s) => send(`[ferro] natives ${s.done}/${s.total}\n`));
  await downloadAssets(details, d.assets, (s) => send(`[ferro] assets ${s.done}/${s.total}\n`));
  const loggingPath = await downloadLoggingConfig(details, d.base || d.versions);
  send('[ferro] lanzando...\n');
  const effRam = ramMb || inst.settings?.ramMb || 2048;
  const effW = width || inst.settings?.width || null;
  const effH = height || inst.settings?.height || null;
  // Online si hay cuenta Microsoft válida; si no, offline con el nombre escrito
  let authArg = null;
  try {
    const acc = await auth.validAccount(d.base, auth.getClientId(d.base));
    if (acc) {
      authArg = { uuid: acc.profile.uuid, token: acc.mcToken, username: acc.profile.name, xuid: acc.uhs };
      send(`[ferro] cuenta online: ${acc.profile.name}\n`);
    } else {
      send('[ferro] sin cuenta: modo offline\n');
    }
  } catch (e) {
    send(`[ferro] refresh falló, modo offline (${e.message})\n`);
  }
  if (!authArg) {
    // Anti-suplantación: en offline no se permite un nombre premium (de nadie)
    const uname = (username || 'Ferro').trim();
    const premiumUuid = await premiumUuidOf(uname).catch(() => null);
    if (premiumUuid === 'unknown') {
      send('[ferro] aviso: sin conexión, no se pudo verificar si el nombre es premium\n');
    } else if (premiumUuid) {
      const caseId = 'F-' + require('crypto').randomBytes(2).toString('hex').toUpperCase();
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      send(`[ferro] !! NOMBRE PREMIUM DETECTADO: ${uname} !!\n`);
      await sleep(450);
      send('[ferro] Iniciando protocolo anti-suplantación…\n');
      shakeWindow();
      await sleep(700);
      send(`[ferro] Identidad comprobada. Evidencia guardada en este equipo. Caso ${caseId}.\n`);
      await sleep(700);
      send('[ferro] Acceso DENEGADO. Usa tu propia cuenta o inicia sesión con Microsoft.\n');
      await sleep(300);
      throw new Error(`"${uname}" es premium (${caseId}). Ni lo intentes.`);
    }
  }
  activeChild = await launch({ javaPath: javaBin, versionDetails: details, clientJar, librariesCp: cp, nativesDir, loggingPath, instanceDir: inst.path, dataDirs: d, username: username || 'Ferro', ramMb: effRam, width: effW, height: effH, onLog: send, mainClassOverride, extraClasspath, auth: authArg });
  activeInstance = inst.name;
  activeT0 = Date.now();
  touchPlayed(d.instances, inst.name);
  notify(d.base, 'info', `Jugando ${details.id}`, `${inst.name} · ${inst.type === 'vanilla' ? 'vanilla' : inst.type} · ${(authArg && authArg.username) || username || 'Ferro'}`);
  // Discord RPC (no bloquea; falla en silencio sin cliente Discord)
  try {
    const dc = auth.getDiscord(d.base);
    if (dc.enabled && dc.clientId) {
      discord.setPlaying(dc.clientId, { version: details.id, instance: inst.name, loader: inst.type, username: (authArg && authArg.username) || username || 'Ferro' }, send);
    }
  } catch {}
  activeChild.on('close', () => {
    const secs = activeT0 ? Math.round((Date.now() - activeT0) / 1000) : 0;
    if (activeInstance && secs >= 60) {
      const total = addPlayTime(d.instances, activeInstance, secs);
      if (total) send(`[ferro] sesión de ${Math.floor(secs / 60)} min (total ${fmtPlay(total)})\n`);
    }
    activeChild = null; activeInstance = null; activeT0 = null;
    try { discord.clear(); } catch {}
  });
  activeChild.on('close', (code) => {
    if (code !== 0 && code !== null) {
      send(`[ferro] crash detectado en ${inst.name} (código ${code})\n`);
      notify(d.base, 'error', `Crash en ${inst.name}`, `Código ${code}. Informe disponible en Instancias.`);
    }
  });
  return true;
});
