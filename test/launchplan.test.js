const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildLaunchPlan, offlineUuid, ruleAllows, splitArgs, flattenArgs } = require('../core/launcher');
const { createInstance, listInstances, updateInstanceSettings, safeName } = require('../core/instanceManager');
const { safeSegment } = require('../core/modrinthService');
const { majorOf, compatible } = require('../core/javaManager');

// --- argumentos de arranque ------------------------------------------------

const VERSION = {
  id: '1.21.4',
  mainClass: 'net.minecraft.client.main.Main',
  assetIndex: { id: '17' },
  type: 'release',
  arguments: {
    jvm: [
      '-p',
      '${natives_directory}',
      { value: ['-Xmx1G'], rules: [{ action: 'allow', os: { name: 'windows' } }] },
      { value: ['-Dis_mac'], rules: [{ action: 'allow', os: { name: 'osx' } }] },
    ],
    game: [
      '--username', '${auth_player_name}',
      '--version', '${version_name}',
      '--gameDir', '${game_directory}',
      '--assetsDir', '${assets_root}',
      '--assetIndex', '${assets_index_name}',
      '--uuid', '${auth_uuid}',
      '--accessToken', '${auth_access_token}',
      '--userType', '${user_type}',
      '--versionType', '${version_type}',
      { value: ['--demo'], rules: [{ action: 'allow', features: { is_demo_user: {} } }] },
    ],
  },
};

function planFor(over = {}) {
  const base = {
    versionDetails: VERSION,
    clientJar: 'C:/mc/versions/1.21.4/1.21.4.jar',
    librariesCp: ['C:/mc/libraries/a.jar'],
    nativesDir: 'C:/mc/natives',
    loggingPath: null,
    instanceDir: 'C:/mc/inst',
    dataDirs: { assets: 'C:/mc/assets', libraries: 'C:/mc/libraries' },
    username: 'Ferro',
  };
  return buildLaunchPlan({ ...base, ...over });
}

test('offlineUuid: determinista, v3 y variante del esquema de Mojang', () => {
  const a = offlineUuid('Steve');
  assert.equal(a, offlineUuid('Steve'));
  assert.notEqual(a, offlineUuid('steve '));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('buildLaunchPlan: offline va con token 0 y userType legacy', () => {
  const p = planFor();
  const game = p.gameArgs.join(' ');
  assert.match(game, /--username Ferro/);
  assert.match(game, /--accessToken 0( |$)/, 'offline: token 0 y nada de credenciales');
  assert.match(game, /--userType legacy/);
  assert.match(game, /--uuid [0-9a-f]{32}/);
  assert.equal(game.includes('--demo'), false, 'las features que no damos se descartan');
  assert.equal(p.uuid.length, 32, 'el uuid va sin guiones');
  assert.equal(p.mainClass, 'net.minecraft.client.main.Main');
});

test('buildLaunchPlan: online usa el perfil de Microsoft', () => {
  const p = planFor({ auth: { token: 'abc.def', uuid: '11111111-2222-3333-4444-555555555555', username: 'Adrian', xuid: 'X1' } });
  const game = p.gameArgs.join(' ');
  assert.match(game, /--username Adrian/);
  assert.match(game, /--userType msa/);
  assert.match(game, /--accessToken abc\.def/);
  assert.equal(p.uuid, '11111111222233334444555555555555');
});

test('buildLaunchPlan: classpath con clientJar primero y separador ;', () => {
  const p = planFor({ extraClasspath: ['C:/mc/extra.jar'] });
  assert.equal(p.classpath.split(';')[0], 'C:/mc/versions/1.21.4/1.21.4.jar');
  assert.match(p.classpath, /extra\.jar;C:\/mc\/libraries\/a\.jar$/);
});

test('buildLaunchPlan: -Xms nunca supera a -Xmx', () => {
  const low = planFor({ ramMb: 512 });
  const xmx = Number(low.jvmArgs.find((a) => a.startsWith('-Xmx')).slice(4, -1));
  const xms = Number(low.jvmArgs.find((a) => a.startsWith('-Xms')).slice(4, -1));
  assert.ok(xms <= xmx, `-Xms${xms} no puede ser mayor que -Xmx${xmx}`);
  const def = planFor({ ramMb: 2048 });
  assert.equal(def.jvmArgs[1], '-Xms512M', 'el valor de siempre se mantiene con 2G');
});

test('buildLaunchPlan: --server/--port y resolución', () => {
  const p = planFor({ width: 1280, height: 720, serverHost: 'mc.example.com', serverPort: 25565 });
  const game = p.gameArgs.join(' ');
  assert.match(game, /--width 1280 --height 720/);
  assert.match(game, /--server mc\.example\.com --port 25565/);
});

test('buildLaunchPlan: el log4j2 solo se pasa si existe', () => {
  assert.equal(planFor().jvmArgs.some((a) => a.startsWith('-Dlog4j')), false);
  assert.match(planFor({ loggingPath: 'C:/mc/log.json' }).jvmArgs.join(' '), /-Dlog4j\.configurationFile=C:\/mc\/log\.json/);
});

test('ruleAllows/flattenArgs: filtros de SO y de features', () => {
  assert.equal(ruleAllows([{ action: 'allow', os: { name: 'windows' } }]), true);
  assert.equal(ruleAllows([{ action: 'allow', os: { name: 'osx' } }]), false);
  assert.equal(ruleAllows([{ action: 'disallow', os: { name: 'windows' } }]), false);
  assert.equal(ruleAllows([]), true);
  assert.equal(ruleAllows([{ action: 'allow', features: { is_demo_user: {} } }]), false, 'sin features: la regla no aplica');
  assert.deepEqual(flattenArgs(['a', { value: ['b'], rules: [{ action: 'allow', os: { name: 'linux' } }] }]), ['a']);
});

test('splitArgs: no rompe las rutas con espacios y parte por flags --x', () => {
  assert.deepEqual(splitArgs('--gameDir C:/Mi Carpeta/inst --username x'), ['--gameDir', 'C:/Mi Carpeta/inst', '--username', 'x']);
  assert.deepEqual(splitArgs(''), []);
});

test('buildLaunchPlan: versiones viejas (minecraftArguments) siguen el mismo camino', () => {
  const p = buildLaunchPlan({
    versionDetails: { id: '1.7.10', mainClass: 'net.minecraft.launchwrapper.Launch', minecraftArguments: '--username ${auth_player_name} --version ${version_name} --gameDir "${game_directory}" --assetsDir ${assets_root}' },
    clientJar: 'j.jar', librariesCp: [], nativesDir: 'n', loggingPath: null, instanceDir: 'i',
    dataDirs: { assets: 'a', libraries: 'l' }, username: 'Ferro',
  });
  assert.equal(p.gameArgs[0], '--username');
  assert.equal(p.gameArgs[1], 'Ferro');
  assert.match(p.jvmArgs.join(' '), /-cp/);
});

// --- instancias ------------------------------------------------------------

function tmpDir(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ferro-inst-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

test('createInstance: sanitiza el nombre y no escribe fuera del dir', (t) => {
  const dir = tmpDir(t);
  const inst = createInstance(dir, '../../escape');
  assert.equal(inst.name, '.._.._escape', 'los separadores se convierten en _');
  assert.equal(fs.existsSync(path.join(dir, inst.name, 'ferro.json')), true);
  assert.equal(fs.existsSync(path.resolve(dir, '..', 'escape')), false);
});

test('createInstance: "." y ".." no escriben en el padre del dir de instancias', (t) => {
  const root = tmpDir(t);
  const dir = path.join(root, 'instances');
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(createInstance(dir, '..').name, 'Instancia');
  assert.equal(createInstance(dir, '.').name, 'Instancia (2)');
  assert.equal(fs.existsSync(path.join(root, 'ferro.json')), false, 'el raíz no se toca');
  assert.equal(fs.existsSync(path.join(dir, 'Instancia', 'ferro.json')), true);
});

test('createInstance: no pisa una existente, numera', (t) => {
  const dir = tmpDir(t);
  const a = createInstance(dir, 'Pack');
  const b = createInstance(dir, 'Pack');
  assert.equal(a.name, 'Pack');
  assert.equal(b.name, 'Pack (2)');
  assert.equal(listInstances(dir).length, 2);
});

test('createInstance: valida el loader', (t) => {
  const dir = tmpDir(t);
  assert.equal(createInstance(dir, 'a', '1.21.4', { type: 'neoforge' }).type, 'neoforge');
  assert.equal(createInstance(dir, 'b', '1.21.4', { type: 'loquesea' }).type, 'vanilla');
});

test('updateInstanceSettings: límites de RAM/resolución y preset', (t) => {
  const dir = tmpDir(t);
  createInstance(dir, 'x', '1.21.4');
  let s = updateInstanceSettings(dir, 'x', { ramMb: 999999, width: 10, jvmPreset: 'turbo' });
  assert.equal(s.settings.ramMb, 16384);
  assert.equal(s.settings.width, 320);
  assert.equal(s.settings.jvmPreset, 'equilibrado', 'preset desconocido cae al por defecto');
  s = updateInstanceSettings(dir, 'x', { ramMb: 1 });
  assert.equal(s.settings.ramMb, 512);
});

test('safeName: se queda con el basename (en / y en \\) y rechaza ..', () => {
  assert.equal(safeName('C:\\inst\\Mi Pack'), 'Mi Pack');
  assert.equal(safeName('a/../b'), 'b');
  assert.throws(() => safeName('..\\'), /Nombre no válido/);
  assert.equal(safeName('a/b/inst'), 'inst');
  assert.throws(() => safeName('..'), /Nombre no válido/);
  assert.throws(() => safeName(''), /Nombre no válido/);
});

test('safeSegment (modrinth): archivos y mundos no escapan de la instancia', () => {
  assert.equal(safeSegment('sodium.jar'), 'sodium.jar');
  assert.equal(safeSegment('../../etc/passwd'), 'passwd');
  assert.throws(() => safeSegment('..'), /Nombre no válido/);
});

test('javaManager: majorOf y compatible', () => {
  assert.equal(majorOf('17.0.2'), 17);
  assert.equal(majorOf('1.8.0_402'), 8, 'el 1.x de Java 8 es trampa');
  assert.equal(majorOf('21'), 21);
  assert.equal(majorOf(null), null);
  assert.equal(compatible(17, 17), true);
  assert.equal(compatible(21, 17), true, 'Java más nuevo vale para 17+');
  assert.equal(compatible(21, 8), false, 'Java 21 NO vale para MC 1.8');
  assert.equal(compatible(null, 17), false);
});

// --- persistence: ferro.json no se corrompe con settings parciales ---------

test('listInstances: completa settings por defecto en instancias antiguas', (t) => {
  const dir = tmpDir(t);
  const p = path.join(dir, 'vieja');
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, 'ferro.json'), JSON.stringify({ name: 'vieja', versionId: '1.20.1', type: 'vanilla' }));
  const [inst] = listInstances(dir);
  assert.equal(inst.settings.ramMb, 2048);
  assert.equal(inst.settings.javaMode, 'auto');
  assert.equal(inst.settings.height, 480);
});
