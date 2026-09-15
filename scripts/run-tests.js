// Lanza node --test sobre test/*.test.(m)js sin depender de que la shell expanda
// glob (en Windows/cmd no expande, y `node --test test/` no acepta directorios).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.join(__dirname, '..', 'test');
const files = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => /\.test\.m?js$/.test(f)).sort().map((f) => path.join(dir, f))
  : [];
if (!files.length) {
  console.error('run-tests: no hay archivos *.test.js / *.test.mjs en test/');
  process.exit(1);
}
console.log(`run-tests: ${files.length} archivo(s)`);
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
