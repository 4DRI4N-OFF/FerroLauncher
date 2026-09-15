// Config mínima, pensada para CI: caza errores reales (sin definir, código
// muerto, hooks mal usados) y actúa de "cierre" (ratchet) sobre los avisos:
// el presupuesto de --max-warnings en package.json no se sube, se baja.
const js = require('@eslint/js');
const reactHooks = require('eslint-plugin-react-hooks');

const nodeGlobals = {
  require: 'readonly', module: 'writable', exports: 'writable', __dirname: 'readonly', __filename: 'readonly',
  process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
  fetch: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly',
  clearInterval: 'readonly', AbortController: 'readonly', AbortSignal: 'readonly', TextDecoder: 'readonly',
  Intl: 'readonly', globalThis: 'readonly', structuredClone: 'readonly', ReadableStream: 'readonly',
};
const browserGlobals = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly', history: 'readonly',
  localStorage: 'readonly', sessionStorage: 'readonly', Element: 'readonly', HTMLElement: 'readonly',
  HTMLInputElement: 'readonly', HTMLCanvasElement: 'readonly', Event: 'readonly', CustomEvent: 'readonly',
  KeyboardEvent: 'readonly', MouseEvent: 'readonly', WheelEvent: 'readonly', DragEvent: 'readonly',
  Node: 'readonly', Image: 'readonly', Audio: 'readonly', AudioContext: 'readonly', Blob: 'readonly',
  File: 'readonly', FileReader: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', Intl: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', setTimeout: 'readonly',
  clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', fetch: 'readonly',
  matchMedia: 'readonly', getComputedStyle: 'readonly', ResizeObserver: 'readonly', IntersectionObserver: 'readonly',
  MutationObserver: 'readonly', addEventListener: 'readonly', removeEventListener: 'readonly',
  console: 'readonly', structuredClone: 'readonly', performance: 'readonly', innerWidth: 'readonly',
  innerHeight: 'readonly', devicePixelRatio: 'readonly', crypto: 'readonly', DataTransfer: 'readonly',
};

const sharedRules = {
  ...js.configs.recommended.rules,
  'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }],
  // los ~140 "catch {}" del proyecto son intencionados (fire-and-forget); que se
  // vean en CI pero que no bloqueen: el presupuesto de warnings los va recortando
  'no-empty': ['warn', { allowEmptyCatch: false }],
  'preserve-caught-error': 'off',
  'no-prototype-builtins': 'off',
  'no-useless-escape': 'off',
  'no-control-regex': 'off',
};

module.exports = [
  { ignores: ['node_modules/**', 'dist/**', 'dist-electron/**', 'release/**', '.ferro*/**', 'docs/**', 'build/**', 'src/assets/**', 'coverage/**'] },
  {
    files: ['core/**/*.js', 'electron/**/*.js', 'scripts/**/*.js', 'test/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: nodeGlobals },
    rules: sharedRules,
  },
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2024, sourceType: 'module', globals: browserGlobals,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...sharedRules,
      'no-extra-boolean-cast': 'off',
      // ya cazó un TDZ real en este proyecto (el "pantalla en blanco" de 0.9.3):
      // usar una const antes de su declaración en módulo es error, no estilo
      'no-use-before-define': ['warn', { variables: true, functions: false, classes: true }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
