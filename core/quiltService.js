const path = require('path');
const { fetchJson, downloadFile } = require('./downloader');

const QUILT_META = 'https://meta.quiltmc.org/v3/versions';
const QUILT_MAVEN = 'https://maven.quiltmc.org/repository/release';
const FABRIC_MAVEN = 'https://maven.fabricmc.net';

function defaultMaven(name) {
  // Quilt reutiliza artefactos de Fabric (intermediary, mixin, asm…)
  if (/^(net\.fabricmc|org\.ow2)/.test(name)) return FABRIC_MAVEN + '/';
  return QUILT_MAVEN + '/';
}

async function listLoaders(mcVersion) {
  const data = await fetchJson(`${QUILT_META}/loader/${mcVersion}`);
  return data.map((e) => ({ loader: e.loader.version, stable: !/beta|alpha|rc/i.test(e.loader.version) }));
}

async function getLoaderMeta(mcVersion, loaderVersion) {
  return fetchJson(`${QUILT_META}/loader/${mcVersion}/${loaderVersion}`);
}

function mavenToPath(name) {
  const [group, artifact, version, classifier] = name.split(':');
  const file = classifier ? `${artifact}-${version}-${classifier}.jar` : `${artifact}-${version}.jar`;
  return path.join(...group.split('.'), artifact, version, file);
}

async function resolveQuiltLibraries(loaderMeta, librariesDir, onProgress) {
  const extra = [];
  for (const key of ['hashed', 'intermediary', 'loader']) {
    const m = loaderMeta[key];
    const coord = typeof m === 'string' ? m : m?.maven;
    if (coord) extra.push({ name: coord }); // sin url: se deduce por grupo
  }
  const libs = [
    ...extra,
    ...(loaderMeta.launcherMeta?.libraries?.client || []),
    ...(loaderMeta.launcherMeta?.libraries?.common || []),
  ];
  const cp = [];
  let done = 0;
  for (const lib of libs) {
    const base = (lib.url || defaultMaven(lib.name)).replace(/\/?$/, '/');
    const url = base + mavenToPath(lib.name).replace(/\\/g, '/');
    const dest = path.join(librariesDir, mavenToPath(lib.name));
    await downloadFile(url, dest);
    cp.push(dest);
    done++;
    onProgress && onProgress({ done, total: libs.length, lib: lib.name });
  }
  const mainClass = loaderMeta.launcherMeta?.mainClass?.client;
  if (!mainClass) throw new Error('Quilt meta sin mainClass client');
  return { classpathExtra: cp, mainClass, count: libs.length };
}

module.exports = { listLoaders, getLoaderMeta, resolveQuiltLibraries, mavenToPath };
