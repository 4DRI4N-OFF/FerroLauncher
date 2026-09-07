const path = require('path');
const { fetchJson, downloadFile } = require('./downloader');

const FABRIC_META = 'https://meta.fabricmc.net/v2/versions';
const FABRIC_MAVEN = 'https://maven.fabricmc.net';

async function listLoaders(mcVersion) {
  const data = await fetchJson(`${FABRIC_META}/loader/${mcVersion}`);
  return data.map((e) => ({ loader: e.loader.version, intermediary: e.intermediary.version, stable: e.loader.stable }));
}

async function getLoaderMeta(mcVersion, loaderVersion) {
  return fetchJson(`${FABRIC_META}/loader/${mcVersion}/${loaderVersion}`);
}

function mavenToUrl(name, base = FABRIC_MAVEN) {
  // group:artifact:version[:classifier] -> base/group/path/artifact/version/file.jar
  const parts = name.split(':');
  const [group, artifact, version, classifier] = parts;
  const file = classifier ? `${artifact}-${version}-${classifier}.jar` : `${artifact}-${version}.jar`;
  return `${base}/${group.replace(/\./g, '/')}/${artifact}/${version}/${file}`;
}

function mavenToPath(name) {
  const parts = name.split(':');
  const [group, artifact, version, classifier] = parts;
  const file = classifier ? `${artifact}-${version}-${classifier}.jar` : `${artifact}-${version}.jar`;
  return path.join(...group.split('.'), artifact, version, file);
}

async function resolveFabricLibraries(loaderMeta, librariesDir, onProgress) {
  // loaderMeta trae loader/intermediary como coordenadas maven + libs en launcherMeta
  const extra = [];
  if (loaderMeta.intermediary?.maven) extra.push({ name: loaderMeta.intermediary.maven, url: FABRIC_MAVEN + '/' });
  if (loaderMeta.loader?.maven) extra.push({ name: loaderMeta.loader.maven, url: FABRIC_MAVEN + '/' });
  const libs = [
    ...extra,
    ...(loaderMeta.launcherMeta?.libraries?.client || []),
    ...(loaderMeta.launcherMeta?.libraries?.common || []),
  ];
  const cp = [];
  let done = 0;
  for (const lib of libs) {
    const url = lib.url ? `${lib.url}${mavenToPath(lib.name).replace(/\\/g, '/')}` : mavenToUrl(lib.name);
    // Nota: meta da "url" base del maven; el path se deriva de las coordenadas
    const dest = path.join(librariesDir, mavenToPath(lib.name));
    await downloadFile(url, dest);
    cp.push(dest);
    done++;
    onProgress && onProgress({ done, total: libs.length, lib: lib.name });
  }
  const mainClass = loaderMeta.launcherMeta?.mainClass?.client;
  if (!mainClass) throw new Error('Fabric meta sin mainClass client');
  return { classpathExtra: cp, mainClass, count: libs.length };
}

module.exports = { listLoaders, getLoaderMeta, resolveFabricLibraries, mavenToUrl, mavenToPath };
