const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');

const { exportInstance, importPack, createBackup, restoreBackup, listBackups, profileBackup, profileRestore } = require('../core/backupService');

function tmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ferro-backup-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

function fakeInstance(root, name = 'MiPack') {
  const dir = path.join(root, 'instances', name);
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'saves', 'Mundo'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'ferro.json'), JSON.stringify({ name, versionId: '1.21.4', type: 'fabric' }));
  fs.writeFileSync(path.join(dir, 'config', 'sodium-options.json'), '{"ok":true}');
  fs.writeFileSync(path.join(dir, 'saves', 'Mundo', 'level.dat'), 'NBT');
  fs.writeFileSync(path.join(dir, 'logs', 'latest.log'), 'hola');
  return { root, dir, instances: path.join(root, 'instances') };
}

test('exportar e importar una instancia conserva las subcarpetas', (t) => {
  const { root, dir } = fakeInstance(tmp(t));
  const zip = path.join(root, 'fuera', 'MiPack.ferro');
  exportInstance(dir, zip);
  // en otra carpeta de instancias: si importas junto al original, uniqueDir
  // numera a propósito ('MiPack (2)'), y aquí lo que se prueba es el layout
  const other = path.join(root, 'otras-instancias');
  const name = importPack(zip, other);
  assert.equal(name, 'MiPack');
  const back = path.join(other, name);
  assert.equal(fs.readFileSync(path.join(back, 'config', 'sodium-options.json'), 'utf8'), '{"ok":true}');
  assert.equal(fs.existsSync(path.join(back, 'saves', 'Mundo', 'level.dat')), true);
});

test('.ferro malicioso no escribe fuera de la carpeta de instancias', (t) => {
  const root = tmp(t);
  const instances = path.join(root, 'instances');
  fs.mkdirSync(instances, { recursive: true });
  const evil = path.join(root, 'evil.ferro');
  const zip = new AdmZip();
  zip.addFile('ferro.json', Buffer.from(JSON.stringify({ name: 'mi-instance', versionId: '1.21.4' })));
  zip.addFile('escape.txt', Buffer.from('dentro, ok'));
  zip.addFile('../../../pwned1.txt', Buffer.from('FUERA'));
  zip.addFile('../../pwned2.txt', Buffer.from('FUERA'));
  zip.writeZip(evil);

  const name = importPack(evil, instances);
  const base = path.join(root, 'pwned1.txt');
  for (const p of [base, path.resolve(instances, '..', '..', 'pwned1.txt'), '/tmp/pwned1.txt']) {
    assert.equal(fs.existsSync(p), false, `no debería existir ${p}`);
  }
  assert.equal(fs.existsSync(path.join(instances, name, 'escape.txt')), true);
});

test('backup + restore: la instancia vuelve entera y el nombre interno se mantiene', (t) => {
  const { root, dir, instances } = fakeInstance(tmp(t));
  const base = path.join(root, 'perfil');
  fs.mkdirSync(base, { recursive: true });
  const { file } = createBackup(base, dir, 'MiPack');
  assert.deepEqual(listBackups(base, 'MiPack').map((b) => b.file), [file]);

  // se carga la instancia y se restaura
  fs.rmSync(path.join(dir, 'config'), { recursive: true, force: true });
  fs.writeFileSync(path.join(dir, 'logs', 'latest.log'), 'BORRADO');
  restoreBackup(base, instances, 'MiPack', file);
  assert.equal(fs.readFileSync(path.join(dir, 'config', 'sodium-options.json'), 'utf8'), '{"ok":true}');
  assert.equal(fs.readFileSync(path.join(dir, 'logs', 'latest.log'), 'utf8'), 'hola');
});

test('una copia corrupta no destruye la instancia (valida antes de borrar)', (t) => {
  const { root, dir, instances } = fakeInstance(tmp(t));
  const base = path.join(root, 'perfil');
  const badDir = path.join(base, 'backups', 'MiPack');
  fs.mkdirSync(badDir, { recursive: true });
  fs.writeFileSync(path.join(badDir, 'roto.ferro'), 'esto no es un zip');
  assert.throws(() => restoreBackup(base, instances, 'MiPack', 'roto.ferro'), /Copia no válida/);
  assert.equal(fs.existsSync(path.join(dir, 'config', 'sodium-options.json')), true, 'la instancia sigue ahí');
});

test('copia y restaurado del perfil completo (sin lo re-descargable)', (t) => {
  const root = tmp(t);
  fs.mkdirSync(path.join(root, 'instances', 'a'), { recursive: true });
  fs.writeFileSync(path.join(root, 'instances', 'a', 'ferro.json'), '{}');
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets', 'grande.bin'), 'NO VA EN LA COPIA');
  const zip = path.join(root, 'perfil.ferro');
  profileBackup(root, zip);

  const dest = path.join(root, 'restore');
  fs.mkdirSync(dest, { recursive: true });
  profileRestore(zip, dest);
  assert.equal(fs.existsSync(path.join(dest, 'instances', 'a', 'ferro.json')), true);
  assert.equal(fs.existsSync(path.join(dest, 'assets')), false, 'libraries/assets/versions no se copian');
});
