// Fire-and-forget explicito, en vez de un `catch {}` que se come el error sin
// dejar rastro. Este launcher traga errores a proposito (Discord RPC sin
// cliente, escritura de progreso cuando la ventana ya no esta, limpieza de
// logs que alguien tiene abierto), pero "a proposito" no significa "sin poder
// saber que pasó": con FERRO_DEBUG=1 esto sale por consola y se puede
// diagnosticar el caso raro. Sin el flag no cuesta nada.
//
//   FERRO_DEBUG=1 npx electron .        # ver todo lo que se traga
//   FERRO_DEBUG=1 npm run electron:dev  # idem en desarrollo
//
// Se lee en cada llamada (no al cargar el modulo) para que los tests puedan
// cambiarlo sin recargar. "0"/"false"/"no" cuentan como apagado: en JS el
// string '0' es truthy y `FERRO_DEBUG=0` no debería encender nada.
const OFF = new Set(['', '0', 'false', 'no', 'off']);

function enabled() {
  try { return !OFF.has(String(process.env.FERRO_DEBUG ?? '').trim().toLowerCase()); } catch { return false; }
}

function swallow(where, err) {
  if (!enabled()) return false;
  const msg = (err && err.message) || (typeof err === 'string' ? err : String(err ?? 'sin mensaje'));
  console.warn(`[ferro] tragado en ${where}: ${msg}`);
  return true;
}

module.exports = { swallow, enabled };