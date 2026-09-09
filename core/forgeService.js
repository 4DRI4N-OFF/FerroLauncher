const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { fetchJson, downloadFile } = require('./downloader');

const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const FORGE_MAVEN = 'https://maven.minecraftforge.net';
const NEO_META = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml';
const NEO_MAVEN = 'https://maven.neoforged.net/releases';

async function listForge(mcVersion) {
  const data = await fetchJson(FORGE_PROMOS);
  const p = data.promos || {};
  const out = [];
  if (p[`${mcVersion}-recommended`]) out.push({ version: p[`${mcVersion}-recommended`], tag: 'recomendado' });
  if (p[`${mcVersion}-latest`] && p[`${mcVersion}-latest`] !== p[`${mcVersion}-recommended`]) {
    out.push({ version: p[`${mcVersion}-latest`], tag: 'latest' });
  }
  return out;
}

function forgeInstallerUrl(mcVersion, forgeVersion) {
  const v = `${mcVersion}-${forgeVersion}`;
  return `${FORGE_MAVEN}/net/minecraftforge/forge/${v}/forge-${v}-installer.jar`;
}

function mcToNeoPrefix(mcVersion) {
  const parts = String(mcVersion).split('.').map(Number);
  if (parts.length <= 2) return String(parts[1]); // "1.21" -> "21"
  return `${parts[1]}.${parts[2]}`;
}

async function listNeoForge(mcVersion) {
  const res = await fetch(NEO_META);
  if (!res.ok) throw new Error(`NeoForge HTTP ${res.status}`);
  const xml = await res.text();
  const prefix = mcToNeoPrefix(mcVersion);
  return [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
    .map((m) => m[1])
    .filter((v) => v.startsWith(prefix + '.'))
    .slice(-10)
    .reverse();
}

function neoInstallerUrl(neoVersion) {
  return `${NEO_MAVEN}/net/neoforged/neoforge/${neoVersion}/neoforge-${neoVersion}-installer.jar`;
}

function snapshotProfiles(versionsDir) {
  const set = new Set();
  if (!fs.existsSync(versionsDir)) return set;
  for (const dir of fs.readdirSync(versionsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
    const j = path.join(versionsDir, dir, `${dir}.json`);
    if (fs.existsSync(j)) set.add(j);
  }
  return set;
}

// Ejecuta el instalador oficial en modo headless contra el dir de datos.
// Devuelve la ruta del profile JSON nuevo que generó.
function runInstaller(javaPath, installerJar, targetDir, versionsDir, onLog) {
  const before = snapshotProfiles(versionsDir);
  return new Promise((resolve, reject) => {
    fs.mkdirSync(targetDir, { recursive: true });
    onLog && onLog(`[ferro] instalador: ${path.basename(installerJar)} (puede tardar varios minutos)…\n`);
    const child = spawn(javaPath, ['-jar', installerJar, '--installClient', targetDir], { cwd: targetDir, timeout: 15 * 60 * 1000 });
    let tail = '';
    const feed = (d) => {
      const t = d.toString();
      tail = (tail + t).slice(-2000);
      onLog && onLog(t);
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', (e) => reject(new Error(`Instalador no arrancó: ${e.message}`)));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Instalador salió con código ${code}\n${tail}`));
      const after = snapshotProfiles(versionsDir);
      const fresh = [...after].filter((j) => !before.has(j));
      if (fresh.length === 0) return reject(new Error('El instalador no generó ningún perfil nuevo'));
      // Prefiere el perfil cuyo id mencione forge/neoforge
      fresh.sort((a, b) => {
        const score = (p) => /forge/i.test(fs.readFileSync(p, 'utf8').slice(0, 2000)) ? 0 : 1;
        return score(a) - score(b);
      });
      resolve(fresh[0]);
    });
  });
}

module.exports = { listForge, forgeInstallerUrl, listNeoForge, neoInstallerUrl, runInstaller, downloadInstaller: downloadFile };
