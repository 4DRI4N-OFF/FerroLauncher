// Mantiene a raya la versión que la landing declara a Google (JSON-LD).
//   node scripts/docs-version.js           -> escribe la versión de package.json en docs/index.html
//   node scripts/docs-version.js --check   -> sale 1 si hay deriva (lo usa la CI)
// El <p id="ver"> de la página NO se toca: se rellena en runtime contra la API
// de GitHub (releases/latest). El "Novedades vX" es historia de un release, no
// tiene por qué seguir a la última versión.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const DOC = path.join(ROOT, 'docs', 'index.html');
const RE = /("softwareVersion"\s*:\s*")(\d+\.\d+\.\d+)(")/;

const html = fs.readFileSync(DOC, 'utf8');
const hit = html.match(RE);
if (!hit) {
  console.error('docs-version FAIL: no encuentro "softwareVersion" en docs/index.html (¿cambió el JSON-LD?)');
  process.exit(1);
}

if (hit[2] === pkg.version) {
  console.log(`docs-version OK (${pkg.version})`);
  process.exit(0);
}

if (process.argv.includes('--check')) {
  console.error(`docs-version FAIL: docs/index.html declara ${hit[2]} y package.json va por ${pkg.version}.`);
  console.error('Arreglo: npm run docs:version  (o a mano, el JSON-LD de la línea ' + (html.slice(0, hit.index).split('\n').length) + ')');
  process.exit(1);
}

fs.writeFileSync(DOC, html.replace(RE, `$1${pkg.version}$3`));
console.log(`docs-version: ${hit[2]} -> ${pkg.version}`);
