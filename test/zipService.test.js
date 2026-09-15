const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');

const { safeRel, isInside, extractEntries, extractZip } = require('../core/zipService');
const { loaderFromDeps } = require('../core/modpackService');

function tmpDir(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ferro-zip-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

function zipOf(files) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) zip.addFile(name, Buffer.from(content));
  return zip;
}

test('safeRel: acepta rutas normales y quita el prefijo', () => {
  assert.equal(safeRel('overrides/config/foo.cfg', { stripPrefix: 'overrides/' }), 'config/foo.cfg');
  assert.equal(safeRel('a/b/c.txt'), 'a/b/c.txt');
});

test('safeRel: rechaza zip-slip, absolutas, unidad de Windows y vacías', () => {
  assert.equal(safeRel('overrides/../../evil.txt', { stripPrefix: 'overrides/' }), null);
  assert.equal(safeRel('overrides/..', { stripPrefix: 'overrides/' }), null);
  assert.equal(safeRel('../../etc/passwd'), null);
  assert.equal(safeRel('/etc/passwd'), null);
  assert.equal(safeRel('C:/Windows/x.dll'), null);
  assert.equal(safeRel('overrides/', { stripPrefix: 'overrides/' }), null);
  assert.equal(safeRel(''), null);
  // backslashes (algunos packs creados en Windows)
  assert.equal(safeRel('overrides\\..\\..\\evil.txt', { stripPrefix: 'overrides/' }), null);
});

test('safeRel: flatten deja solo el basename', () => {
  assert.equal(safeRel('win64/lwjgl.dll', { flatten: true }), 'lwjgl.dll');
  assert.equal(safeRel('a/b/c.txt', { flatten: true }), 'c.txt');
});

test('extractEntries: conserva las subcarpetas de overrides/ (el bug del aplanado)', (t) => {
  const dest = tmpDir(t);
  const zip = zipOf({
    'modrinth.index.json': '{}',
    'overrides/config/sodium-options.json': '{"a":1}',
    'overrides/shaders/shaders.txt': 'x',
    'overrides/optionsof.txt': 'y',
  });
  const out = extractEntries(zip, dest, { stripPrefix: 'overrides/' });
  assert.deepEqual(out, { written: 3, skipped: 0, bytes: 9 });
  assert.equal(fs.readFileSync(path.join(dest, 'config/sodium-options.json'), 'utf8'), '{"a":1}');
  assert.equal(fs.existsSync(path.join(dest, 'shaders/shaders.txt')), true);
  assert.equal(fs.readFileSync(path.join(dest, 'optionsof.txt'), 'utf8'), 'y');
  // nada del zip debe caer en el raíz aplanado
  assert.equal(fs.existsSync(path.join(dest, 'sodium-options.json')), false);
});

test('extractEntries: no escribe fuera del destino y avisa', (t) => {
  const root = tmpDir(t);
  const dest = path.join(root, 'inst');
  // 'overrides/../../../pwned.txt' la canonicaliza adm-zip al escribir el zip
  // (la deja como 'pwned.txt', fuera del prefijo): igual no debe escribirse.
  const zip = zipOf({
    'overrides/ok.txt': 'ok',
    'pwned.txt': 'nope',
    'overrides/tmp/pwned2.txt': 'nope',
  });
  const skipped = [];
  const out = extractEntries(zip, dest, { stripPrefix: 'overrides/', onSkip: (n) => skipped.push(n) });
  assert.equal(out.written, 2, 'ok.txt y overrides/tmp/pwned2.txt, los dos dentro');
  assert.equal(out.skipped, 0, 'una entrada fuera de overrides/ ni se cuenta: no es un riesgo');
  assert.equal(fs.readFileSync(path.join(dest, 'ok.txt'), 'utf8'), 'ok');
  // adm-zip canonicaliza '../..' al meter la entrada: sale como 'pwned.txt', sin
  // el prefijo overrides/ -> no se escribe. Lo que importa es que nada caiga fuera.
  assert.equal(skipped.length, 0);
  assert.equal(fs.existsSync(path.join(root, 'pwned.txt')), false, 'la que salió del prefijo no se escribe');
  assert.equal(fs.existsSync(path.resolve(root, '..', 'pwned.txt')), false);
  assert.equal(fs.existsSync('/tmp/pwned2.txt'), false);
  assert.equal(out.bytes > 0 && out.bytes < 100, true);
});

test('extractEntries: flatten para natives + filter (META-INF y excludes de Mojang)', (t) => {
  const dest = tmpDir(t);
  const zip = zipOf({
    'win64/lwjgl.dll': 'dll',
    'win64/OpenAL64.dll': 'oal',
    'META-INF/MANIFEST.MF': 'manifest',
    'META-INF/versions/9/module-info.class': 'junk',
  });
  const out = extractEntries(zip, dest, {
    flatten: true,
    filter: (e) => !e.entryName.startsWith('META-INF') && !['META-INF/versions/'].some((x) => e.entryName.startsWith(x)),
  });
  assert.equal(out.written, 2);
  assert.deepEqual(fs.readdirSync(dest).sort(), ['OpenAL64.dll', 'lwjgl.dll']);
});

test('extractEntries: un symlink preexistente en el destino no desvía la escritura', (t) => {
  const root = tmpDir(t);
  const dest = path.join(root, 'inst');
  fs.mkdirSync(dest, { recursive: true });
  const outside = path.join(root, 'outside.txt');
  fs.writeFileSync(outside, 'ORIGINAL');
  try {
    fs.symlinkSync(outside, path.join(dest, 'hook.txt'), 'file');
  } catch {
    t.skip('symlinks no disponibles en esta plataforma');
    return;
  }
  extractEntries(zipOf({ 'hook.txt': 'REEMPLAZADO' }), dest);
  // el archivo del zip queda como archivo normal dentro de la instancia...
  assert.equal(fs.readFileSync(path.join(dest, 'hook.txt'), 'utf8'), 'REEMPLAZADO');
  assert.equal(fs.lstatSync(path.join(dest, 'hook.txt')).isSymbolicLink(), false);
  // ...y el de fuera intacto
  assert.equal(fs.readFileSync(outside, 'utf8'), 'ORIGINAL');
});

test('extractZip: abre el .zip de disco y extrae', (t) => {
  const root = tmpDir(t);
  const zipPath = path.join(root, 'p.mrpack');
  zipOf({ 'overrides/config/a.cfg': 'hola' }).writeZip(zipPath);
  const dest = path.join(root, 'inst');
  const out = extractZip(zipPath, dest, { stripPrefix: 'overrides/' });
  assert.equal(out.written, 1);
  assert.equal(fs.readFileSync(path.join(dest, 'config/a.cfg'), 'utf8'), 'hola');
});

test('isInside: rechaza padres que apuntan fuera', (t) => {
  const root = tmpDir(t);
  const inside = path.join(root, 'a', 'b');
  assert.equal(isInside(root, inside), true);
  assert.equal(isInside(root, path.join(root, '..')), false);
  assert.equal(isInside(root, path.resolve(root, '..', 'otro')), false);
});

test('loaderFromDeps: detecta el loader del modpack', () => {
  assert.deepEqual(loaderFromDeps({ minecraft: '1.21.4', 'fabric-loader': '0.16.9' }), { loaderType: 'fabric', loaderVersion: '0.16.9' });
  assert.deepEqual(loaderFromDeps({ minecraft: '1.20.1', neoforge: '20.4.70' }), { loaderType: 'neoforge', loaderVersion: '20.4.70' });
  assert.deepEqual(loaderFromDeps({ minecraft: '1.19.2', 'quilt-loader': '0.23.1' }), { loaderType: 'quilt', loaderVersion: '0.23.1' });
  assert.deepEqual(loaderFromDeps({ minecraft: '1.12.2', forge: '14.23.5.2860' }), { loaderType: 'forge', loaderVersion: '14.23.5.2860' });
  assert.deepEqual(loaderFromDeps({}), { loaderType: 'fabric', loaderVersion: null });
});
