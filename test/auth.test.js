const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const auth = require('../core/authService');

function tmpBase(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ferro-auth-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

// safeStorage de mentira: reversible y ruidoso si alguien lee el disco a mano
function fakeSafe() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (b) => {
      const t = Buffer.from(b).toString('utf8');
      if (!t.startsWith('enc:')) throw new Error('no es un blob de este cifrador');
      return t.slice(4);
    },
  };
}

const ACCOUNT = {
  mcToken: 'MC-TOKEN-SECRETO',
  mcExpiry: Date.now() + 3600_000,
  msRefresh: 'REFRESH-SECRETO',
  uhs: 'UHS-SECRETO',
  profile: { uuid: 'abc123', name: 'Adrian', skins: [], capes: [] },
};

test('con cifrado disponible, los tokens no quedan en claro en el disco', (t) => {
  const base = tmpBase(t);
  auth.setSafeStorageForTest(fakeSafe());
  t.after(() => auth.setSafeStorageForTest(null));

  auth.saveAccount(base, ACCOUNT);
  const raw = fs.readFileSync(path.join(base, 'accounts.json'), 'utf8');
  for (const secret of ['MC-TOKEN-SECRETO', 'REFRESH-SECRETO', 'UHS-SECRETO']) {
    assert.equal(raw.includes(secret), false, `el disco no debería contener ${secret}`);
  }
  assert.match(raw, /"secrets"/);
  // el perfil sigue legible para la UI (nombre/uuid sin descifrar nada)
  assert.match(raw, /"name": "Adrian"/);

  const acc = auth.loadAccount(base);
  assert.equal(acc.mcToken, 'MC-TOKEN-SECRETO', 'loadAccount devuelve la sesión completa');
  assert.equal(acc.msRefresh, 'REFRESH-SECRETO');
  assert.equal(acc.profile.name, 'Adrian');
});

test('migra sesiones antiguas en claro sin perder el login', (t) => {
  const base = tmpBase(t);
  fs.writeFileSync(path.join(base, 'accounts.json'), JSON.stringify({ active: 'abc123', accounts: { abc123: ACCOUNT } }, null, 2));
  assert.equal(fs.readFileSync(path.join(base, 'accounts.json'), 'utf8').includes('MC-TOKEN-SECRETO'), true);

  auth.setSafeStorageForTest(fakeSafe());
  t.after(() => auth.setSafeStorageForTest(null));

  const acc = auth.loadAccount(base); // leer dispara la migración
  assert.equal(acc && acc.mcToken, 'MC-TOKEN-SECRETO');
  const raw = fs.readFileSync(path.join(base, 'accounts.json'), 'utf8');
  assert.equal(raw.includes('MC-TOKEN-SECRETO'), false, 'tras leer, el archivo ya está cifrado');
});

test('sin safeStorage se mantiene el comportamiento de siempre (no rompe)', (t) => {
  const base = tmpBase(t);
  auth.setSafeStorageForTest(null); // sin electron (modo node puro) => null
  auth.saveAccount(base, ACCOUNT);
  const acc = auth.loadAccount(base);
  assert.equal(acc.mcToken, 'MC-TOKEN-SECRETO');
});

test('un blob ilegible descarta la sesión en vez de reventar el arranque', (t) => {
  const base = tmpBase(t);
  fs.writeFileSync(path.join(base, 'accounts.json'), JSON.stringify({
    active: 'abc123',
    accounts: { abc123: { profile: ACCOUNT.profile, secrets: '!!!!no-base64!!!!' } },
  }));
  auth.setSafeStorageForTest(fakeSafe());
  t.after(() => auth.setSafeStorageForTest(null));
  assert.equal(auth.loadAccount(base), null);
  assert.deepEqual(auth.listAccounts(base), []);
});

test('listAccounts/setActive/removeAccount no necesitan descifrar', (t) => {
  const base = tmpBase(t);
  auth.setSafeStorageForTest(fakeSafe());
  t.after(() => auth.setSafeStorageForTest(null));
  auth.saveAccount(base, ACCOUNT);
  auth.saveAccount(base, { ...ACCOUNT, profile: { uuid: 'def456', name: 'Otro' } });
  const list = auth.listAccounts(base).map((a) => a.name).sort();
  assert.deepEqual(list, ['Adrian', 'Otro']);
  assert.equal(auth.setActive(base, 'abc123'), true);
  assert.equal(auth.loadAccount(base).profile.name, 'Adrian');
  auth.removeAccount(base, 'abc123');
  assert.equal(auth.loadAccount(base).profile.name, 'Otro', 'al borrar la activa cae a la siguiente');
});

test('maskId: la UI ve el final del id, nunca el id entero', () => {
  assert.equal(auth.maskId('e38aa735-6b06-4111-9d58-5190f3d754db'), '••••54db');
  assert.equal(auth.maskId(''), '');
  assert.equal(auth.maskId('abc'), '••••abc');
});

test('getClientId: config de usuario > variable de entorno', (t) => {
  const base = tmpBase(t);
  const prev = process.env.FERRO_CLIENT_ID;
  t.after(() => { if (prev === undefined) delete process.env.FERRO_CLIENT_ID; else process.env.FERRO_CLIENT_ID = prev; });

  auth.setClientId(base, 'id-de-la-ui');
  process.env.FERRO_CLIENT_ID = 'id-del-entorno';
  assert.equal(auth.getClientId(base), 'id-de-la-ui', 'lo que puso el usuario manda');

  fs.rmSync(path.join(base, 'ferro-config.json'));
  assert.equal(auth.getClientId(base), 'id-del-entorno');
  const pub = auth.getClientIdPublic(base);
  assert.equal(pub.configured, true);
  assert.equal(pub.masked.includes('id-del-entorno'), false, 'la API pública no devuelve el id completo');
});

test('ferro-config.json corrupto no tumba el launcher', (t) => {
  const base = tmpBase(t);
  fs.writeFileSync(path.join(base, 'ferro-config.json'), '{ esto no es json');
  assert.equal(typeof auth.getClientId(base), 'string');
  assert.equal(auth.getClientIdPublic(base).configured, !!auth.getClientId(base));
  assert.deepEqual(auth.getDiscord(base), { clientId: auth.getDiscord(base).clientId, enabled: true });
});
