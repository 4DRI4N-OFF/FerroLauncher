const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

// Client ID integrado (el de tu app Azure): los usuarios finales no registran nada.
// Se puede sobreescribir desde la UI (pestaña Cuentas) y se guarda en ferro-config.json.
const DEFAULT_CLIENT_ID = 'e38aa735-6b06-4111-9d58-5190f3d754db';

const MS_DEVICE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode';
const MS_TOKEN = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const MS_AUTHORIZE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize';
const NATIVE_REDIRECT = 'https://login.microsoftonline.com/common/oauth2/nativeclient';
const SCOPE = 'XboxLive.signin offline_access';
const XBL_AUTH = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS_AUTH = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const MC_LOGIN = 'https://api.minecraftservices.com/authentication/login_with_xbox';
const MC_PROFILE = 'https://api.minecraftservices.com/minecraft/profile';

function authPaths(baseDir) {
  return {
    config: path.join(baseDir, 'ferro-config.json'),
    account: path.join(baseDir, 'account.json'),
  };
}

function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function getClientId(baseDir) {
  return readJson(authPaths(baseDir).config, {}).clientId || process.env.FERRO_CLIENT_ID || DEFAULT_CLIENT_ID;
}

function setClientId(baseDir, clientId) {
  const p = authPaths(baseDir).config;
  const cfg = readJson(p, {});
  cfg.clientId = String(clientId || '').trim();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return cfg.clientId;
}

async function form(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  return res.json();
}

async function json(url, body, token) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// Paso 1: pide el código para microsoft.com/link
async function deviceStart(clientId) {
  if (!clientId) throw new Error('Falta el client ID (pestaña Cuentas)');
  const data = await form(MS_DEVICE, { client_id: clientId, scope: SCOPE });
  if (data.error) throw new Error(`Microsoft: ${data.error_description || data.error}`);
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: (data.interval || 5) * 1000,
  };
}

// Paso 2: un intento de canje (el renderer lo llama cada `interval`)
async function devicePollOnce(clientId, deviceCode) {
  const data = await form(MS_TOKEN, {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    client_id: clientId,
    device_code: deviceCode,
  });
  if (data.error === 'authorization_pending') return { status: 'pending' };
  if (data.error) return { status: 'error', error: data.error_description || data.error };
  return { status: 'done', accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
}

const XSTS_ERRORS = {
  2148916233: 'Esta cuenta Microsoft no tiene perfil de Xbox. Crea uno gratis en xbox.com.',
  2148916238: 'Cuenta infantil: necesita permiso familiar para jugar online.',
};

async function xboxLogin(msAccessToken) {
  const { status, data } = await json(XBL_AUTH, {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });
  if (status !== 200 || !data.Token) throw new Error('Xbox Live rechazó el token Microsoft');
  const uhs = data.DisplayClaims?.xui?.[0]?.uhs;
  const { status: s2, data: d2 } = await json(XSTS_AUTH, {
    Properties: { SandboxId: 'RETAIL', UserTokens: [data.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT',
  });
  if (s2 !== 200 || !d2.Token) {
    const xerr = Number(d2?.XErr);
    throw new Error(XSTS_ERRORS[xerr] || `XSTS error ${xerr || s2}`);
  }
  const outUhs = d2.DisplayClaims?.xui?.[0]?.uhs || uhs;
  if (!outUhs || !d2.Token) throw new Error('Xbox no devolvió identidad completa (uhs)');
  return { uhs: outUhs, xstsToken: d2.Token };
}

async function minecraftLogin(uhs, xstsToken) {
  const { status, data } = await json(MC_LOGIN, { identityToken: `XBL3.0 x=${uhs};${xstsToken}` });
  if (status !== 200 || !data.access_token) {
    const detail = data?.errorMessage || data?.error || '';
    if (status === 401) throw new Error('Xbox válido pero Mojang lo rechazó (HTTP 401): entra con la cuenta que compró Minecraft Java');
    throw new Error(`Mojang HTTP ${status}${detail ? ` (${detail})` : ''}: no ve licencia Java en esta identidad Xbox`);
  }
  return { mcToken: data.access_token, expiresIn: data.expires_in };
}

async function fetchProfile(mcToken) {
  const res = await fetch(MC_PROFILE, { headers: { Authorization: `Bearer ${mcToken}` } });
  if (res.status === 404) throw new Error('Esta cuenta no tiene Minecraft Java comprado');
  if (!res.ok) throw new Error(`Mojang HTTP ${res.status}`);
  const p = await res.json();
  return { uuid: p.id, name: p.name, skins: p.skins || [], capes: p.capes || [] };
}

function saveAccount(baseDir, account) {
  const p = authPaths(baseDir).account;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ ...account, savedAt: Date.now() }, null, 2));
}

function loadAccount(baseDir) {
  return readJson(authPaths(baseDir).account, null);
}

function clearAccount(baseDir) {
  try { fs.unlinkSync(authPaths(baseDir).account); } catch {}
}

// Completa el login tras el device flow: Xbox -> Minecraft -> perfil -> guarda
async function completeLogin(baseDir, msAccess, msRefresh) {
  const { uhs, xstsToken } = await xboxLogin(msAccess);
  const { mcToken, expiresIn } = await minecraftLogin(uhs, xstsToken);
  const profile = await fetchProfile(mcToken);
  const account = {
    mcToken, mcExpiry: Date.now() + (expiresIn || 86400) * 1000,
    msRefresh, uhs, profile,
  };
  saveAccount(baseDir, account);
  return account;
}

// Devuelve cuenta válida (refresca si el token MC caducó)
async function validAccount(baseDir, clientId) {
  const acc = loadAccount(baseDir);
  if (!acc) return null;
  if (Date.now() < (acc.mcExpiry || 0) - 60000) return acc;
  if (!acc.msRefresh) return null;
  const data = await form(MS_TOKEN, {
    grant_type: 'refresh_token', client_id: clientId,
    refresh_token: acc.msRefresh, scope: SCOPE,
  });
  if (data.error || !data.access_token) return null;
  return completeLogin(baseDir, data.access_token, data.refresh_token || acc.msRefresh);
}

module.exports = {
  getClientId, setClientId, deviceStart, devicePollOnce,
  completeLogin, validAccount, loadAccount, clearAccount,
  browserLogin, exchangeCode, authorizeUrl, NATIVE_REDIRECT, SCOPE,
};

function authorizeUrl({ clientId, redirectUri, challenge, state }) {
  return `${MS_AUTHORIZE}?client_id=${encodeURIComponent(clientId)}&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(SCOPE)}` +
    `&code_challenge=${challenge}&code_challenge_method=S256&state=${state}&prompt=select_account`;
}

// Canjea un ?code= de Microsoft (ventana integrada o localhost) y completa el login
async function exchangeCode({ clientId, code, redirectUri, verifier, baseDir }) {
  const data = await form(MS_TOKEN, {
    grant_type: 'authorization_code', client_id: clientId, code,
    redirect_uri: redirectUri, code_verifier: verifier,
  });
  if (data.error || !data.access_token) throw new Error(data.error_description || data.error || 'Token rechazado');
  return completeLogin(baseDir, data.access_token, data.refresh_token);
}

// Flujo navegador (PKCE + localhost): devuelve { url, cancel() }.
// Llama onDone({account}) al completar o onError(err).
function browserLogin({ clientId, baseDir, onDone, onError }) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(8).toString('hex');
  let server = null;

  const finishHtml = (ok, msg) =>
    `<html><body style="background:#0b0e17;color:#f2f4fb;font-family:sans-serif;display:flex;height:100vh;align-items:center;justify-content:center"><h2>${ok ? '✓' : '✗'} ${msg}</h2><p>&nbsp;Puedes cerrar esta ventana.</p></body></html>`;

  const close = () => { try { server && server.close(); } catch {} server = null; };

  server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://localhost');
      if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      if (u.searchParams.get('state') !== state) throw new Error('state inválido');
      if (u.searchParams.get('error')) throw new Error(u.searchParams.get('error_description') || u.searchParams.get('error'));
      const code = u.searchParams.get('code');
      if (!code) throw new Error('Sin código de Microsoft');
      const port = server.address().port;
      const data = await form(MS_TOKEN, {
        grant_type: 'authorization_code', client_id: clientId, code,
        redirect_uri: `http://localhost:${port}/callback`, code_verifier: verifier,
      });
      if (data.error || !data.access_token) throw new Error(data.error_description || data.error || 'Token rechazado');
      const acc = await completeLogin(baseDir, data.access_token, data.refresh_token);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(finishHtml(true, 'Sesión iniciada en FerroLauncher.'));
      close();
      onDone && onDone(acc);
    } catch (e) {
      try { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(finishHtml(false, e.message)); } catch {}
      close();
      onError && onError(e);
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const url =
        `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?` +
        `client_id=${encodeURIComponent(clientId)}&response_type=code` +
        `&redirect_uri=${encodeURIComponent(`http://localhost:${port}/callback`)}` +
        `&scope=${encodeURIComponent(SCOPE)}&code_challenge=${challenge}` +
        `&code_challenge_method=S256&state=${state}&prompt=select_account`;
      resolve({ url, cancel: close });
    });
    server.on('error', reject);
  });
}
