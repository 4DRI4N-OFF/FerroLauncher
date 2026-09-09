const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { downloadFile } = require('./downloader');
const PKG_VER = require('../package.json').version;

function ruleAllows(rules) {
  if (!rules || rules.length === 0) return true;
  let allowed = false;
  for (const r of rules) {
    let osOk = true;
    if (r.os) {
      if (r.os.name && r.os.name !== 'windows') osOk = false;
      if (r.os.arch && r.os.arch === 'x86' && ['x64', 'arm64'].includes(process.arch)) osOk = false;
    }
    if (r.features) continue; // is_demo_user / resolución custom -> se ignora
    if (r.action === 'allow' && osOk) allowed = true;
    if (r.action === 'disallow' && osOk) allowed = false;
  }
  return allowed;
}

// Parte por flags (--x): los valores con espacios (rutas) quedan intactos
function splitArgs(str) {
  const out = [];
  for (const chunk of String(str || '').split(/\s+(?=--)/)) {
    const t = chunk.trim();
    if (!t) continue;
    const sp = t.indexOf(' ');
    if (sp < 0) out.push(t);
    else { out.push(t.slice(0, sp)); out.push(t.slice(sp + 1)); }
  }
  return out;
}

function flattenArgs(list) {  const out = [];
  for (const a of list || []) {
    if (typeof a === 'string') { out.push(a); continue; }
    if (a && typeof a === 'object' && ruleAllows(a.rules)) {
      if (Array.isArray(a.value)) out.push(...a.value);
      else if (typeof a.value === 'string') out.push(a.value);
    }
  }
  return out;
}

function libArtifact(lib) {
  return lib.downloads?.artifact; // { path, url, sha1, size }
}

async function resolveLibraries(versionDetails, librariesDir, onProgress) {
  const cp = [];
  let done = 0;
  const libs = (versionDetails.libraries || []).filter((l) => ruleAllows(l.rules));
  for (const lib of libs) {
    // Los natives modernos (:natives-windows) NO van al classpath, se extraen aparte
    if (/:natives-/.test(lib.name)) { done++; continue; }
    const art = libArtifact(lib);
    if (!art) continue;
    const dest = path.join(librariesDir, art.path);
    await downloadFile(art.url, dest, (p) => onProgress && onProgress({ lib: lib.name, done: ++done, total: libs.length, p }), art.size, art.sha1);
    cp.push(dest);
  }
  return cp;
}

function offlineUuid(username) {
  const crypto = require('crypto');
  const h = crypto.createHash('md5').update('OfflinePlayer:' + username).digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

async function launch({ javaPath, versionDetails, clientJar, librariesCp, nativesDir, loggingPath, instanceDir, dataDirs, username, ramMb = 2048, onLog, mainClassOverride = null, extraClasspath = [], width = null, height = null, auth = null, jvmPreset = null, javaMajor = null, serverHost = null, serverPort = null }) {
  const plan = buildLaunchPlan({ versionDetails, clientJar, librariesCp, nativesDir, loggingPath, instanceDir, dataDirs, username, ramMb, mainClassOverride, extraClasspath, width, height, auth, jvmPreset, javaMajor, serverHost, serverPort });
  onLog && onLog(`[ferro] java: ${javaPath}\n[ferro] mainClass: ${plan.mainClass}\n[ferro] libs: ${librariesCp.length} natives: ${nativesDir}\n`);
  const full = [...plan.jvmArgs, plan.mainClass, ...plan.gameArgs];
  const shown = [...full];
  const ti = shown.indexOf('--accessToken');
  if (ti >= 0 && shown[ti + 1]) shown[ti + 1] = String(shown[ti + 1]).slice(0, 4) + '…';
  onLog && onLog(`[ferro] cmd: "${javaPath}" ${shown.join(' ')}\n`);
  const child = spawn(javaPath, full, { cwd: instanceDir });

  child.stdout.on('data', (d) => onLog && onLog(d.toString()));
  child.stderr.on('data', (d) => onLog && onLog(d.toString()));
  child.on('error', (err) => onLog && onLog(`\n[ferro] error al arrancar java: ${err.message}`));
  child.on('close', (code) => onLog && onLog(`\n[ferro] proceso terminado con código ${code}`));
  return child;
}

function buildLaunchPlan({ versionDetails, clientJar, librariesCp, nativesDir, loggingPath, instanceDir, dataDirs, username, ramMb = 2048, mainClassOverride = null, extraClasspath = [], width = null, height = null, auth = null, jvmPreset = null, javaMajor = null, serverHost = null, serverPort = null }) {
  const online = !!(auth && auth.token && auth.uuid);
  const effName = online ? auth.username : username;
  const uuidDashed = online ? auth.uuid : offlineUuid(username);
  const uuid = String(uuidDashed).replace(/-/g, '');
  const versionId = versionDetails.id;
  const assetIndex = versionDetails.assetIndex?.id || 'legacy';
  const mainClass = mainClassOverride || versionDetails.mainClass;
  const classpath = [clientJar, ...extraClasspath, ...librariesCp].join(';');

  const map = {
    auth_player_name: effName,
    version_name: versionId,
    // OJO: sin comillas — spawn() no usa shell, las comillas llegarían literales a la ruta y rompen el arranque (exit 1)
    game_directory: instanceDir,
    game_directory_raw: instanceDir,
    assets_root: dataDirs.assets,
    assets_root_raw: dataDirs.assets,
    assets_index_name: assetIndex,
    auth_uuid: uuid,
    auth_access_token: online ? auth.token : '0',
    clientid: 'ferro',
    auth_xuid: online ? (auth.xuid || '0') : '0',
    user_type: online ? 'msa' : 'legacy',
    version_type: versionDetails.type || 'release',
    natives_directory: nativesDir,
    natives_directory_raw: nativesDir,
    launcher_name: 'FerroLauncher',
    launcher_version: PKG_VER,
    classpath,
    library_directory: dataDirs.libraries,
    classpath_separator: ';',
  };
  const sub = (s) => String(s).replace(/\$\{(\w+)\}/g, (_, k) => (map[k] !== undefined ? map[k] : `\${${k}}`));

  // JVM args
  let jvmArgs;
  if (versionDetails.arguments?.jvm) {
    jvmArgs = flattenArgs(versionDetails.arguments.jvm).map(sub);
  } else {
    jvmArgs = ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'].map(sub);
  }
  // RAM + logging + jar info (vanilla moderno lo espera)
  jvmArgs = [`-Xmx${ramMb}M`, `-Xms512M`, `-Dminecraft.client.jar=${clientJar}`, ...(loggingPath ? [`-Dlog4j.configurationFile=${loggingPath}`] : []), ...jvmArgs];
  try {
    const { flagsFor } = require('./perfService');
    jvmArgs.push(...flagsFor(jvmPreset, javaMajor));
  } catch {}

  // Game args
  let gameArgs;
  if (versionDetails.arguments?.game) {
    gameArgs = flattenArgs(versionDetails.arguments.game).map(sub);
  } else if (versionDetails.minecraftArguments) {
    gameArgs = splitArgs(versionDetails.minecraftArguments).map(sub);
  } else {
    gameArgs = ['--username', '${auth_player_name}', '--version', '${version_name}', '--gameDir', '${game_directory}', '--assetsDir', '${assets_root}', '--assetIndex', '${assets_index_name}', '--uuid', '${auth_uuid}', '--accessToken', '${auth_access_token}', '--userType', '${user_type}', '--versionType', '${version_type}'].map(sub);
  }
  if (width && height) gameArgs.push('--width', String(width), '--height', String(height));
  if (serverHost) {
    gameArgs.push('--server', String(serverHost));
    if (serverPort) gameArgs.push('--port', String(serverPort));
  }

  return { jvmArgs, gameArgs, mainClass, classpath, uuid };
}

module.exports = { resolveLibraries, launch, buildLaunchPlan, offlineUuid };
