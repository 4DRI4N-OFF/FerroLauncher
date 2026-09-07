const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { getDataDir, dirs } = require('../core/constants');
const { ensureDirs, listInstances, createInstance, updateInstanceSettings } = require('../core/instanceManager');
const { listVersions, getVersionDetails, downloadClientJar } = require('../core/mojangService');
const { findJava, ensureJava } = require('../core/javaManager');
const { resolveLibraries, launch } = require('../core/launcher');
const { resolveNatives } = require('../core/nativesService');
const { downloadAssets, downloadLoggingConfig } = require('../core/assetsService');
const { listLoaders, getLoaderMeta, resolveFabricLibraries } = require('../core/fabricService');
const { searchMods, listMods, installMod, removeMod, toggleMod } = require('../core/modrinthService');
const { searchModpacks, packVersions, getPackVersion, installMrpack } = require('../core/modpackService');
const auth = require('../core/authService');

function findInstance(d, name) {
  const inst = listInstances(d.instances).find((i) => i.name === name);
  if (!inst) throw new Error('Instancia no encontrada');
  return inst;
}

let win = null;
let D = null;
let activeChild = null;
let activeInstance = null;

function getDirs() {
  if (!D) {
    const base = getDataDir(app);
    D = dirs(base);
    ensureDirs(D);
  }
  return D;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 700,
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
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
}

app.whenReady().then(() => {
  getDirs();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('ferro:versions', async () => {
  const all = await listVersions();
  return all.filter((v) => v.type === 'release').slice(0, 30);
});

ipcMain.handle('ferro:instances', async () => listInstances(getDirs().instances));
ipcMain.handle('ferro:createInstance', async (_, { name, versionId, type, loaderVersion }) => createInstance(getDirs().instances, name, versionId, { type, loaderVersion }));
ipcMain.handle('ferro:fabricLoaders', async (_, mcVersion) => listLoaders(mcVersion));

ipcMain.handle('ferro:modSearch', async (_, { query, mcVersion }) => searchMods(query || '', mcVersion, 'fabric'));
ipcMain.handle('ferro:mods', async (_, { instanceName }) => listMods(findInstance(getDirs(), instanceName).path));
ipcMain.handle('ferro:modInstall', async (event, { instanceName, projectId }) => {
  const inst = findInstance(getDirs(), instanceName);
  if (inst.type !== 'fabric') throw new Error('Los mods requieren instancia Fabric');
  const send = (t) => win && win.webContents.send('ferro:log', t);
  return installMod(inst.path, projectId, inst.versionId, 'fabric', send);
});
ipcMain.handle('ferro:modRemove', async (_, { instanceName, file }) => {
  removeMod(findInstance(getDirs(), instanceName).path, file);
  return true;
});
ipcMain.handle('ferro:modToggle', async (_, { instanceName, file, disable }) => toggleMod(findInstance(getDirs(), instanceName).path, file, disable));
ipcMain.handle('ferro:packSearch', async (_, { query, mcVersion }) => searchModpacks(query || '', mcVersion, 12));
ipcMain.handle('ferro:packVersions', async (_, { projectId, mcVersion }) => {
  const vers = await packVersions(projectId, mcVersion);
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
  cfg.type = 'fabric';
  cfg.modpack = { projectId, packVersionId, packName: info.name };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  send(`[ferro] modpack listo: ${info.files} archivos, MC ${cfg.versionId} + fabric ${cfg.loaderVersion}\n`);
  return { name: inst.name, ...cfg };
});
ipcMain.handle('ferro:java', async () => (await findJava()) || null);

ipcMain.handle('ferro:clientId', async () => auth.getClientId(getDirs().base));
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

let browserAuth = null;
ipcMain.handle('ferro:authBrowser', async () => {
  const d = getDirs();
  if (browserAuth) browserAuth.cancel();
  const { url, cancel } = await auth.browserLogin({
    clientId: auth.getClientId(d.base),
    baseDir: d.base,
    onDone: (acc) => {
      browserAuth = null;
      win && win.webContents.send('ferro:auth-done', { name: acc.profile.name, uuid: acc.profile.uuid });
    },
    onError: (e) => {
      browserAuth = null;
      win && win.webContents.send('ferro:auth-error', { error: e.message });
    },
  });
  browserAuth = { cancel };
  await shell.openExternal(url);
  return true;
});
ipcMain.handle('ferro:authBrowserCancel', async () => { if (browserAuth) browserAuth.cancel(); browserAuth = null; return true; });
ipcMain.handle('ferro:authWindowCancel', async () => { try { if (authWin && !authWin.isDestroyed()) authWin.close(); } catch {} authWin = null; return true; });

let authWin = null;
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
ipcMain.handle('ferro:stop', async () => {
  if (!activeChild || activeChild.killed || activeChild.exitCode !== null) return false;
  const send = (t) => win && win.webContents.send('ferro:log', t);
  send(`[ferro] deteniendo ${activeInstance || 'juego'}...\n`);
  activeChild.kill();
  setTimeout(() => { try { if (activeChild && activeChild.exitCode === null) activeChild.kill('SIGKILL'); } catch {} }, 5000);
  return true;
});
ipcMain.handle('ferro:status', async () => ({ running: !!activeChild && activeChild.exitCode === null && !activeChild.killed, instance: activeInstance }));

ipcMain.handle('ferro:launch', async (event, { instanceName, username, ramMb, width, height }) => {
  if (activeChild && activeChild.exitCode === null && !activeChild.killed) throw new Error('Ya hay una instancia en ejecución. Deténla primero.');
  const d = getDirs();
  const path = require('path');
  const instances = listInstances(d.instances);
  const inst = instances.find((i) => i.name === instanceName);
  if (!inst) throw new Error('Instancia no encontrada');
  const send = (t) => win && win.webContents.send('ferro:log', t);

  send(`[ferro] resolviendo ${inst.versionId}...\n`);
  const details = await getVersionDetails(inst.versionId);
  const requiredJava = details.javaVersion?.majorVersion || null;
  if (requiredJava) send(`[ferro] esta versión pide Java ${requiredJava}\n`);
  const clientJar = await downloadClientJar(details, d.versions, (p) => send(`[ferro] client ${(p*100).toFixed(0)}%\n`));
  const cp = await resolveLibraries(details, d.libraries, (s) => send(`[ferro] lib ${s.done}/${s.total} ${s.lib}\n`));
  const nativesDir = path.join(d.versions, details.id, 'natives-windows');
  await resolveNatives(details, d.libraries, nativesDir, (s) => send(`[ferro] natives ${s.done}/${s.total}\n`));
  await downloadAssets(details, d.assets, (s) => send(`[ferro] assets ${s.done}/${s.total}\n`));
  const loggingPath = await downloadLoggingConfig(details, d.base || d.versions);
  // Fabric: resuelve loader + intermediary y pisa mainClass
  let mainClassOverride = null, extraClasspath = [];
  if (inst.type === 'fabric') {
    const loaders = await listLoaders(inst.versionId);
    const pick = inst.loaderVersion || loaders[0]?.loader;
    if (!pick) throw new Error(`Fabric sin loader para ${inst.versionId}`);
    send(`[ferro] fabric loader ${pick}...\n`);
    const meta = await getLoaderMeta(inst.versionId, pick);
    const fab = await resolveFabricLibraries(meta, d.libraries, (s) => send(`[ferro] fabric ${s.done}/${s.total} ${s.lib}\n`));
    mainClassOverride = fab.mainClass;
    extraClasspath = fab.classpathExtra;
    send(`[ferro] fabric: ${fab.count} libs, main ${fab.mainClass}\n`);
  }
  const { checkJava } = require('../core/javaManager');
  let java;
  if (inst.settings?.javaMode === 'custom' && inst.settings?.javaPath) {
    const custom = await checkJava(inst.settings.javaPath);
    if (!custom) throw new Error(`Java personalizado no válido: ${inst.settings.javaPath}`);
    if (requiredJava && custom.major !== null && requiredJava > 8 && custom.major < requiredJava) {
      send(`[ferro] aviso: tu java personalizado es ${custom.major} y se pide ${requiredJava}\n`);
    }
    java = custom;
  } else {
    java = await ensureJava(requiredJava, d.runtimes, send);
  }
  send(`[ferro] Java ${java.version} (major ${java.major}) en ${java.path}${java.managed ? ' [gestionado]' : ''}\n[ferro] lanzando...\n`);
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
  activeChild = await launch({ javaPath: java.path === 'java' ? 'java' : java.path, versionDetails: details, clientJar, librariesCp: cp, nativesDir, loggingPath, instanceDir: inst.path, dataDirs: d, username: username || 'Ferro', ramMb: effRam, width: effW, height: effH, onLog: send, mainClassOverride, extraClasspath, auth: authArg });
  activeInstance = inst.name;
  activeChild.on('close', () => { activeChild = null; activeInstance = null; });
  return true;
});
