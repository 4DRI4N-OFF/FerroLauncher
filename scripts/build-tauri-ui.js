// Build de la UI para la app Tauri (CSP con el canal IPC de Tauri permitido).
const { execSync } = require('child_process');
execSync('npx vite build', { stdio: 'inherit', env: { ...process.env, FERRO_TAURI: '1' } });
