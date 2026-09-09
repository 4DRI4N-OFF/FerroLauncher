// Aplica icono + metadatos Windows al exe desempaquetado.
// Uso: npm run dist:full (build -> --dir -> brand-exe -> nsis/portable --prepackaged)
// (signAndEditExecutable está desactivado porque winCodeSign exige symlinks con privilegios;
//  sin este paso el exe conserva icono y metadatos de Electron)
const { execFileSync } = require('child_process');
const path = require('path');

const RCEDIT = 'C:\\Users\\4DRI4N\\AppData\\Local\\Temp\\opencode\\rcedit.exe';
const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'release', 'win-unpacked', 'FerroLauncher.exe');
const ICON = path.join(ROOT, 'build', 'icon.ico');

try {
  execFileSync(RCEDIT, [
    EXE,
    '--set-icon', ICON,
    '--set-version-string', 'FileDescription', 'FerroLauncher',
    '--set-version-string', 'ProductName', 'FerroLauncher',
    '--set-version-string', 'CompanyName', 'Adrian Garcia Martinez',
    '--set-version-string', 'LegalCopyright', 'Copyright (c) 2026 Adrian Garcia Martinez',
  ], { stdio: 'inherit' });
  console.log('brand-exe OK');
} catch (e) {
  console.error('brand-exe FAIL:', e.message);
  process.exit(1);
}
