const fs = require('fs');
const path = require('path');

// Cada regla: qué buscar (log o código de salida) -> diagnóstico + arreglo opcional
const RULES = [
  {
    id: 'oom', title: 'Sin memoria (OutOfMemory)',
    match: /OutOfMemoryError|Could not reserve enough space|insufficient memory|malloc|commit_memory/i,
    exit: [-805306369],
    desc: 'Minecraft se quedó sin RAM. Sube la memoria asignada.',
    fix: { type: 'ram', mb: 6144, label: 'Subir RAM a 6 GB' },
  },
  {
    id: 'ram32', title: 'RAM imposible (32 bits)',
    match: /Could not reserve enough space for.*heap|exceeds maximum representable/i,
    desc: 'Pide más RAM de la que tu Java permite. Usa Java 64 bits o baja la RAM.',
    fix: { type: 'ram', mb: 2048, label: 'Bajar RAM a 2 GB' },
  },
  {
    id: 'natives', title: 'Nativas rotas (DLL)',
    match: /UnsatisfiedLinkError|Failed to load library|natives|EXCEPTION_.*0x/i,
    desc: 'Las librerías nativas están corruptas o mezcladas. Se re-descargan al lanzar.',
    fix: { type: 'wipeNatives', label: 'Limpiar natives y reintentar' },
  },
  {
    id: 'javaversion', title: 'Java incorrecto',
    match: /UnsupportedClassVersionError|class file version|Unsupported major\.minor/i,
    desc: 'La versión necesita otro Java. El launcher lo resuelve solo al lanzar.',
    fix: null,
  },
  {
    id: 'driver', title: 'Controlador gráfico',
    match: /EXCEPTION_ACCESS_VIOLATION|Pixel format not accelerated|org\.lwjgl.*GL|ig7icd|nvogl/i,
    desc: 'Fallo en el driver de vídeo. Actualiza los drivers de tu GPU (Intel/NVIDIA/AMD).',
    fix: null,
  },
  {
    id: 'moddep', title: 'Mod con dependencias',
    match: /Missing Mods|Dependency|mods\.toml|NoClassDefFoundError|NoSuchMethodError|MixinApplyError|mixin/i,
    desc: 'Un mod falla (falta dependencia, versión incompatible o mezcla de loaders). Revisa los últimos mods instalados.',
    fix: null,
  },
  {
    id: 'acceso', title: 'Sin permiso / antivirus',
    match: /AccessDeniedException|Permission denied|java\.nio\.file\.AccessDenied/i,
    desc: 'Windows o el antivirus bloqueó archivos del juego. Excluye la carpeta del launcher.',
    fix: null,
  },
];

const EXIT_HINTS = {
  '-1073741819': 'driver',
  '-805306369': 'oom',
  '-1': null,
  1: null,
};

function diagnose({ logTail = '', exitCode = null, crashDesc = '' }) {
  const text = `${logTail}\n${crashDesc}`;
  const out = [];
  const seen = new Set();
  const push = (r) => { if (!seen.has(r.id)) { seen.add(r.id); out.push({ id: r.id, title: r.title, desc: r.desc, fix: r.fix || null }); } };
  for (const r of RULES) {
    if (r.match && r.match.test(text)) push(r);
    if (r.exit && exitCode !== null && r.exit.includes(Number(exitCode))) push(r);
  }
  if (exitCode !== null && EXIT_HINTS[String(exitCode)] && out.length === 0) {
    const r = RULES.find((x) => x.id === EXIT_HINTS[String(exitCode)]);
    if (r) push(r);
  }
  return out;
}

function readTail(p, maxLines = 120) {
  try {
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    return lines.slice(-maxLines).join('\n');
  } catch { return ''; }
}

function latestLogTail(instanceDir) {
  return readTail(path.join(instanceDir, 'logs', 'latest.log'));
}

function lastCrashDesc(instanceDir) {
  try {
    const dir = path.join(instanceDir, 'crash-reports');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt'))
      .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (!files.length) return '';
    const head = fs.readFileSync(path.join(dir, files[0].f), 'utf8').slice(0, 3000);
    const m = head.match(/Description:\s*(.+)/);
    return m ? m[1].trim().slice(0, 200) : '';
  } catch { return ''; }
}

module.exports = { diagnose, latestLogTail, lastCrashDesc, RULES };
