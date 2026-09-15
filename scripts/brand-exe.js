// Aplica icono + metadatos Windows al exe desempaquetado.
// Uso: npm run dist:full (build -> --dir -> brand-exe -> nsis/portable --prepackaged)
// (signAndEditExecutable está desactivado porque winCodeSign exige symlinks con privilegios;
//  sin este paso el exe conserva icono y metadatos de Electron)
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'release', 'win-unpacked', 'FerroLauncher.exe');
const ICON = path.join(ROOT, 'build', 'icon.ico');

// Dónde está rcedit. Antes era una ruta absoluta de un %TEMP% concreto de un PC:
// en cualquier otra máquina (o tras limpiar el temporal) el script moría sin explicación.
// Orden: variable de entorno > rcedit del proyecto (devDependency) > rcedit en el PATH.
function resolveRcEdit() {
  const local = path.join(ROOT, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
  if (process.env.FERRO_RCDIT && fs.existsSync(process.env.FERRO_RCDIT)) return process.env.FERRO_RCDIT;
  if (fs.existsSync(local)) return local;
  return 'rcedit-x64.exe'; // que lo encuentre Windows por el PATH
}

const RCEDIT = resolveRcEdit();

if (!fs.existsSync(EXE)) {
  console.error(`brand-exe FAIL: no existe ${EXE}. Ejecuta antes: electron-builder --win --dir`);
  process.exit(1);
}

try {
  execFileSync(RCEDIT, [
    EXE,
    '--set-icon', ICON,
    '--set-version-string', 'FileDescription', 'FerroLauncher',
    '--set-version-string', 'ProductName', 'FerroLauncher',
    '--set-version-string', 'CompanyName', 'Adrian Garcia Martinez',
    '--set-version-string', 'LegalCopyright', 'Copyright (c) 2026 Adrian Garcia Martinez',
  ], { stdio: 'inherit' });
  console.log(`brand-exe OK (rcedit: ${RCEDIT})`);
} catch (e) {
  console.error('brand-exe FAIL:', e.message);
  console.error('rcedit usado:', RCEDIT);
  console.error('Instálalo con `npm i -D rcedit` o señala tu copia con FERRO_RCDIT=<ruta>');
  process.exit(1);
}
