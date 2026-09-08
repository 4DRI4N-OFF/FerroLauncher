// Aplica metadatos Windows (FileDescription, etc.) al exe desempaquetado.
// Uso: npm run dist -> node scripts/brand-exe.js -> dist:pack
// (signAndEditExecutable está desactivado porque winCodeSign exige symlinks con privilegios)
const { execFileSync } = require('child_process');
const path = require('path');

const RCEDIT = 'C:\\Users\\4DRI4N\\AppData\\Local\\Temp\\opencode\\rcedit.exe';
const EXE = path.join(__dirname, '..', 'release', 'win-unpacked', 'FerroLauncher.exe');

try {
  execFileSync(RCEDIT, [
    EXE,
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
