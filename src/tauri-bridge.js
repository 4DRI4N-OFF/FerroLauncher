// Puente Tauri: en la app de escritorio Tauri recrea `window.ferro` (lo que antes
// ponía electron/preload.js). Cada método llama al comando único `ferro` del
// motor Rust. En Electron no hace nada (window.ferro ya existe).
(function installTauriBridge() {
  const T = typeof window !== 'undefined' ? window.__TAURI__ : null;
  if (!T || window.ferro) return;
  const invoke = T.core.invoke;
  const listen = T.event.listen;
  const METHODS = ['versions', 'instances', 'createInstance', 'loaders', 'modSearch', 'mods', 'modInstall', 'modRemove', 'modToggle', 'modUpdates', 'modUpdate', 'cfKey', 'cfSetKey', 'cfSearch', 'cfTrending', 'cfFiles', 'cfInstall', 'cfPackInstall', 'rp', 'rpToggle', 'shader', 'shaderSet', 'packSearch', 'packVersions', 'packInstall', 'clientId', 'discord', 'setDiscord', 'testWebhook', 'openUrl', 'social', 'setClientId', 'authStatus', 'authStart', 'authPoll', 'authLogout', 'accounts', 'authSelect', 'authRemove', 'authWindow', 'authWindowCancel', 'appVersion', 'checkUpdate', 'quitAndInstall', 'skin', 'skinApply', 'skinReset', 'exportInstance', 'importInstance', 'backups', 'backupCreate', 'backupRestore', 'backupDelete', 'autoBackupGet', 'autoBackupSet', 'autoBackupRun', 'autoBackupOnce', 'profileBackup', 'profileRestore', 'crashes', 'crashRead', 'openCrashes', 'shots', 'shotThumb', 'shotView', 'shotDelete', 'java', 'launch', 'ramSuggest', 'diagnose', 'doctorFix', 'importScan', 'importVanilla', 'importPrism', 'importDrop', 'servers', 'serverAdd', 'serverRemove', 'serverPing', 'worlds', 'friendAdd', 'friendRemove', 'friendsPresence', 'essentialScan', 'news', 'stop', 'status', 'nameCheck', 'nameSuggest', 'updateSettings', 'openFolder', 'duplicateInstance', 'deleteInstance', 'renameInstance', 'instSize', 'instClean', 'loaderUpdate', 'loaderCheck', 'wallpaper', 'wallpaperSet', 'wallpaperClear'];
  const api = {};
  for (const name of METHODS) api[name] = (data) => invoke('ferro', { name, data: data === undefined ? null : data });
  const on = (event, cb) => { try { listen(event, (e) => cb(e.payload)); } catch { /* ignorado */ } };
  const once = (cb, ms) => { setTimeout(() => { try { cb(); } catch { /* ignorado */ } }, ms); };
  api.onLog = (cb) => on('ferro:log', cb);
  api.onProgress = (cb) => on('ferro:progress', cb);
  api.onUpdate = (cb) => on('ferro:update', cb);
  api.onAuthResult = (cb) => {
    on('ferro:auth-done', (d) => cb(null, d));
    on('ferro:auth-error', (e) => cb(e, null));
  };
  // Electron mostraba la ventana tras cargar y avisaba con estos eventos.
  api.onShown = (cb) => once(cb, 0);
  api.onSettled = (cb) => once(cb, 600);
  window.ferro = api;
})();
