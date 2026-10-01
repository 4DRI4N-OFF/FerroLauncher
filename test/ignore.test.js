const test = require('node:test');
const assert = require('node:assert/strict');

const { swallow, enabled } = require('../core/ignore');

function withFlag(t, value) {
  const prev = process.env.FERRO_DEBUG;
  if (value === undefined) delete process.env.FERRO_DEBUG;
  else process.env.FERRO_DEBUG = value;
  t.after(() => { if (prev === undefined) delete process.env.FERRO_DEBUG; else process.env.FERRO_DEBUG = prev; });
}

// swallow() existe para que un fallo silenciado se pueda diagnosticar. Si esto
// falla, el launcher vuelve a ser un caja negra.
test('swallow: sin FERRO_DEBUG es un no-op y no escribe nada', (t) => {
  withFlag(t, undefined);
  const seen = [];
  const real = console.warn;
  console.warn = (...a) => seen.push(a);
  t.after(() => { console.warn = real; });

  assert.equal(enabled(), false);
  assert.equal(swallow('sitio', new Error('boom')), false, 'devuelve false = no hizo nada');
  assert.deepEqual(seen, [], 'ni una linea por consola');
});

test('swallow: con FERRO_DEBUG=1 dice qué se tragó y por qué', (t) => {
  withFlag(t, '1');
  const seen = [];
  const real = console.warn;
  console.warn = (...a) => seen.push(a.join(' '));
  t.after(() => { console.warn = real; });

  assert.equal(enabled(), true);
  assert.equal(swallow('touchPlayed(MiInstancia)', new Error('EACCES')), true);
  assert.equal(seen.length, 1);
  assert.match(seen[0], /\[ferro\] tragado en touchPlayed\(MiInstancia\): EACCES/);
});

test('swallow: un error sin mensaje, o un string, no rompen el log', (t) => {
  withFlag(t, '1');
  const seen = [];
  const real = console.warn;
  console.warn = (...a) => seen.push(a.join(' '));
  t.after(() => { console.warn = real; });

  swallow('a', new Error());            // Error() vacío -> message ''
  swallow('b', 'texto plano');
  swallow('c', undefined);
  swallow('d', null);
  assert.equal(seen.length, 4);
  assert.match(seen[0], /tragado en a: /);
  assert.match(seen[1], /tragado en b: texto plano/);
  assert.match(seen[2], /tragado en c: sin mensaje/);
  assert.match(seen[3], /tragado en d: sin mensaje/);
});

test('swallow: lee el flag en cada llamada, no al cargar el modulo', (t) => {
  withFlag(t, undefined);
  assert.equal(enabled(), false, 'al empezar no');
  process.env.FERRO_DEBUG = '1';
  assert.equal(enabled(), true, 'y sí tras tocarlo en caliente');
  delete process.env.FERRO_DEBUG;
  assert.equal(enabled(), false);
});

test('swallow: un flag vacío o a cero no cuenta como activado', (t) => {
  withFlag(t, '');
  assert.equal(enabled(), false);
  withFlag(t, '0');
  assert.equal(enabled(), false);
  withFlag(t, 'false');
  assert.equal(enabled(), false);
});