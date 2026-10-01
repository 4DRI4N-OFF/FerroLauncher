const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { copyIfExists, reportSkipped } = require('../core/importService');

function tmp(t, tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `ferro-import-${tag}-`));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

// El bug que motivó esto: el try envolvía el bucle entero, así que un único
// archivo que fallaba abortaba el resto del árbol y la importación se
// reportaba como buena. Se comprueba que los hermanos SIGUEN copiándose.
//
// El que falla se llama "0-..." a propósito: readdirSync no garantiza orden, y
// si el conflicto cayera al final el test pasaría también con el bug viejo.
test('copyIfExists: un archivo que falla no aborta el resto del árbol', (t) => {
  const root = tmp(t, 'partial');
  const src = path.join(root, 'src');
  const dest = path.join(root, 'dest');
  fs.mkdirSync(src, { recursive: true });
  for (const f of ['0-bloqueado.dat', 'a.dat', 'b.dat', 'c.dat', 'd.dat']) {
    fs.writeFileSync(path.join(src, f), f);
  }
  // en el destino YA hay un directorio donde debería ir 0-bloqueado.dat: copiar
  // el archivo encima de un directorio falla, y ese es el fallo que antes se
  // comía el árbol entero en silencio
  fs.mkdirSync(path.join(dest, '0-bloqueado.dat'), { recursive: true });

  const skipped = copyIfExists(src, dest, []);

  for (const f of ['a.dat', 'b.dat', 'c.dat', 'd.dat']) {
    assert.equal(fs.readFileSync(path.join(dest, f), 'utf8'), f, `${f} debería estar copiado`);
  }
  assert.equal(skipped.length, 1, 'y el que falló queda anotado');
  assert.match(skipped[0], /0-bloqueado\.dat$/);
});

test('copyIfExists: recurre y un fallo en un subdirectorio no corta los demás', (t) => {
  const root = tmp(t, 'deep');
  const src = path.join(root, 'src');
  const dest = path.join(root, 'dest');
  fs.mkdirSync(path.join(src, 'roto'), { recursive: true });
  fs.mkdirSync(path.join(src, 'sano'), { recursive: true });
  fs.writeFileSync(path.join(src, 'roto', 'x.dat'), 'x');
  fs.writeFileSync(path.join(src, 'sano', 'y.dat'), 'y');
  // colisión DENTRO del subdirectorio: x.dat es un directorio en el destino
  fs.mkdirSync(path.join(dest, 'roto', 'x.dat'), { recursive: true });

  const skipped = copyIfExists(src, dest, []);

  assert.equal(fs.readFileSync(path.join(dest, 'sano', 'y.dat'), 'utf8'), 'y', 'la rama sana se copia entera');
  assert.equal(skipped.length, 1);
  assert.match(skipped[0], /x\.dat$/);
});

test('copyIfExists: origen inexistente no es un fallo ni un ruido', (t) => {
  const root = tmp(t, 'missing');
  const dest = path.join(root, 'dest');
  const skipped = copyIfExists(path.join(root, 'no-existe'), dest, []);
  assert.deepEqual(skipped, []);
});

test('copyIfExists: origen ilegible se anota en vez de tragarselo', (t) => {
  const root = tmp(t, 'unreadable');
  const src = path.join(root, 'src');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'z.txt'), 'z');
  // el destino es un archivo, no un directorio: mkdirSync de dentro falla y el
  // catch externo tiene que avisar, no quedarse mudo
  const dest = path.join(root, 'dest.txt');
  fs.writeFileSync(dest, 'soy un archivo');

  const skipped = copyIfExists(src, dest, []);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0], /src$/);
});

test('copyIfExists: sin lista previa, devuelve la suya y no revienta', (t) => {
  const root = tmp(t, 'nolist');
  const src = path.join(root, 'src');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'a.txt'), 'a');
  const skipped = copyIfExists(src, path.join(root, 'dest'));
  assert.ok(Array.isArray(skipped));
  assert.deepEqual(skipped, []);
});

test('reportSkipped: avisa con el recuento y recorta la lista larga', (t) => {
  const lines = [];
  const onLog = (s) => lines.push(s);

  assert.equal(reportSkipped([], onLog), 0);
  assert.deepEqual(lines, [], 'sin fallos, no hay que decir nada');

  assert.equal(reportSkipped(['a.dat'], onLog), 1);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /1 archivo\(s\) no se pudieron copiar: a\.dat/);
  assert.equal(lines[0].includes('+'), false, 'con uno solo no hay "más"');

  const many = Array.from({ length: 9 }, (_, i) => `f${i}.dat`);
  assert.equal(reportSkipped(many, onLog), 9);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /\+4 más/, 'solo enseña 5 y resume el resto');
  assert.equal(lines[1].includes('f8.dat'), false, 'el resto no se escupe entero');
});

test('reportSkipped: sin log (llamada desde un test) no revienta', () => {
  assert.equal(reportSkipped(['a.dat'], null), 1);
  assert.equal(reportSkipped(['a.dat'], undefined), 1);
});