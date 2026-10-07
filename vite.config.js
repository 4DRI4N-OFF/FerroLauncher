import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// CSP solo en el build: en dev el cliente de Vite mete script inline (react
// refresh + HMR) y una CSP estricta rompería el hot reload.
//
// Lo que cierra de verdad es script-src 'self' (mata la inyección de scripts, la
// vía típica de XSS -> IPC) y connect-src 'none': el renderer NO hace fetch
// (0 fetch() en src/), todo sale por IPC, así que sin connect-src no hay forma
// de que una inyección se lleve nada a la red. img/media quedan abiertos a
// propósito: los iconos de Modrinth/CurseForge y las skins son remotos, y el
// documento se sirve desde file://, donde 'self' no resuelve del todo.
const TAURI = !!process.env.FERRO_TAURI;
const CSP = [
  "default-src 'self' file: data:",
  "script-src 'self' file:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' file: data: blob: https:",
  "media-src 'self' file: data: blob:",
  "font-src 'self' data:",
  TAURI ? "connect-src 'self' ipc: http://ipc.localhost" : "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "form-action 'none'",
].join('; ');

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'ferro-csp',
      apply: 'build',
      transformIndexHtml: (html) =>
        html.replace('</head>', `  <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n</head>`),
    },
  ],
  base: './',
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist' }
});