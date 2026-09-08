const fs = require('fs');
const path = require('path');

function readLines(p) {
  try { return fs.readFileSync(p, 'utf8').split('\n'); } catch { return null; }
}

function optionsPath(instanceDir) {
  return path.join(instanceDir, 'options.txt');
}

// resourcePacks:["vanilla","fabric","file/A.zip"] — gestionamos solo las file/*
function getEnabledRP(instanceDir) {
  const lines = readLines(optionsPath(instanceDir));
  if (!lines) return null; // nunca se ha jugado: sin options.txt
  const line = lines.find((l) => l.startsWith('resourcePacks:'));
  if (!line) return [];
  const m = line.match(/\[(.*)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).filter((v) => v.startsWith('file/')).map((v) => v.slice(5));
}

function setRPEnabled(instanceDir, file, enable) {
  const p = optionsPath(instanceDir);
  let lines = readLines(p) || [];
  const idx = lines.findIndex((l) => l.startsWith('resourcePacks:'));
  const cur = getEnabledRP(instanceDir) || [];
  let next = cur.filter((f) => f !== file);
  if (enable) next.push(file);
  const kept = (() => {
    if (idx < 0) return ['"vanilla"'];
    const m = (lines[idx].match(/\[(.*)\]/) || [])[1] || '';
    const base = [...m.matchAll(/"([^"]+)"/g)].map((x) => x[1]).filter((v) => !v.startsWith('file/'));
    return base.length ? base : ['"vanilla"'];
  })();
  const val = `resourcePacks:[${[...kept.map((v) => `"${v}"`), ...next.map((f) => `"file/${f}"`)].join(',')}]`;
  if (idx < 0) lines.push(val);
  else lines[idx] = val;
  fs.mkdirSync(instanceDir, { recursive: true });
  fs.writeFileSync(p, lines.join('\n'));
  return next;
}

function irisPropsPath(instanceDir) {
  return path.join(instanceDir, 'config', 'iris.properties');
}

function readProps(p) {
  const lines = readLines(p);
  if (!lines) return { lines: [], map: {} };
  const map = {};
  for (const l of lines) {
    const m = l.match(/^\s*([^#!\s][^=]*?)\s*=\s*(.*)\s*$/);
    if (m) map[m[1]] = m[2];
  }
  return { lines, map };
}

function getShader(instanceDir) {
  const { map } = readProps(irisPropsPath(instanceDir));
  const pack = map.shaderPack || '';
  const enabled = map.enableShaders !== 'false';
  if (!pack || pack === '(internal)') return { pack: null, enabled: false, configured: 'enableShaders' in map };
  return { pack, enabled, configured: true };
}

function setShader(instanceDir, file) {
  const p = irisPropsPath(instanceDir);
  const { lines, map } = readProps(p);
  const next = { ...map };
  if (file) {
    next.shaderPack = file;
    next.enableShaders = 'true';
  } else {
    next.enableShaders = 'false';
  }
  const out = [...lines];
  const setLine = (k, v) => {
    const i = out.findIndex((l) => l.match(new RegExp(`^\\s*${k}\\s*=`)));
    if (i < 0) out.push(`${k}=${v}`);
    else out[i] = `${k}=${v}`;
  };
  setLine('shaderPack', next.shaderPack !== undefined ? next.shaderPack : (map.shaderPack || ''));
  setLine('enableShaders', next.enableShaders);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, out.join('\n'));
  return getShader(instanceDir);
}

function hasIris(instanceDir) {
  try {
    return fs.readdirSync(path.join(instanceDir, 'mods')).some((f) => /^iris-.*\.jar$/i.test(f));
  } catch { return false; }
}

module.exports = { getEnabledRP, setRPEnabled, getShader, setShader, hasIris };
