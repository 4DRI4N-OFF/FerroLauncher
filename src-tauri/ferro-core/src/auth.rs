//! Cuentas Microsoft (OAuth device flow + Xbox + Minecraft), multi-cuenta en
//! `accounts.json`. Replica `core/authService.js` de Electron.
//!
//! Nota: los tokens se guardan en claro en esta primera versión Tauri.
//! El cifrado en reposo (DPAPI) queda pendiente antes de la estable.
use crate::net;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

const MS_DEVICE: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const MS_TOKEN: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const SCOPE: &str = "XboxLive.signin offline_access";
const XBL_AUTH: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE: &str = "https://api.minecraftservices.com/minecraft/profile";

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(30))
        .timeout_read(Duration::from_secs(90))
        .user_agent("FerroLauncher")
        .build()
}

fn form(url: &str, params: &[(&str, &str)]) -> Result<Value, String> {
    let body: String = params
        .iter()
        .map(|(k, v)| format!("{}={}", url_encode(k), url_encode(v)))
        .collect::<Vec<_>>()
        .join("&");
    agent()
        .post(url)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send_string(&body)
        .map_err(|e| match e {
            ureq::Error::Status(c, r) => format!("Microsoft HTTP {c}: {}", r.into_string().unwrap_or_default()),
            e => format!("Sin conexión con Microsoft ({e}). Revisa internet/firewall."),
        })?
        .into_json::<Value>()
        .map_err(|e| format!("Respuesta no válida de Microsoft: {e}"))
}

fn url_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn post_json(url: &str, body: &Value, token: Option<&str>) -> Result<(u16, Value), String> {
    let mut req = agent().post(url).set("Content-Type", "application/json");
    if let Some(t) = token {
        req = req.set("Authorization", &format!("Bearer {t}"));
    }
    let resp = req.send_json(body.clone()).map_err(|e| match e {
        ureq::Error::Status(c, r) => format!("HTTP {c}: {}", r.into_string().unwrap_or_default()),
        e => format!("Sin conexión ({e})"),
    })?;
    let status = resp.status();
    let data: Value = resp.into_json().unwrap_or(json!({}));
    Ok((status, data))
}

// ---------- client id ----------

fn read_json_file(p: &Path) -> Option<Value> {
    fs::read_to_string(p).ok().and_then(|t| serde_json::from_str(&t).ok())
}

fn bundled_client_id() -> String {
    // build/identity.json viaja junto al código; se busca en los lugares
    // razonables (dev y junto al ejecutable). Es un ID público (ver comentario
    // en core/authService.js del original).
    let mut cands: Vec<PathBuf> = vec![];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(d) = exe.parent() {
            cands.push(d.join("identity.json"));
            cands.push(d.join("build").join("identity.json"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        cands.push(cwd.join("build").join("identity.json"));
        cands.push(cwd.join("identity.json"));
    }
    for p in cands {
        if let Some(v) = read_json_file(&p) {
            if let Some(id) = v.get("clientId").and_then(|x| x.as_str()) {
                if !id.is_empty() {
                    return id.to_string();
                }
            }
        }
    }
    String::new()
}

pub fn client_id(base: &Path) -> String {
    if let Some(v) = read_json_file(&base.join("ferro-config.json")) {
        if let Some(id) = v.get("clientId").and_then(|x| x.as_str()) {
            if !id.trim().is_empty() {
                return id.trim().to_string();
            }
        }
    }
    if let Ok(id) = std::env::var("FERRO_CLIENT_ID") {
        if !id.trim().is_empty() {
            return id.trim().to_string();
        }
    }
    bundled_client_id()
}

pub fn client_id_public(base: &Path) -> Value {
    let id = client_id(base);
    let masked = if id.is_empty() { "".to_string() } else { format!("••••{}", &id[id.len().saturating_sub(4)..]) };
    json!({ "masked": masked, "configured": !id.is_empty() })
}

pub fn set_client_id(base: &Path, id: &str) -> Result<String, String> {
    let p = base.join("ferro-config.json");
    let mut cfg = read_json_file(&p).unwrap_or(json!({}));
    cfg["clientId"] = json!(id.trim());
    fs::create_dir_all(base).map_err(|e| e.to_string())?;
    fs::write(&p, serde_json::to_string_pretty(&cfg).unwrap()).map_err(|e| e.to_string())?;
    Ok(id.trim().to_string())
}

// ---------- store ----------

fn store_paths(base: &Path) -> (PathBuf, PathBuf) {
    (base.join("accounts.json"), base.join("account.json"))
}

fn empty_store() -> Value {
    json!({ "active": null, "accounts": {} })
}

pub fn load_store(base: &Path) -> Value {
    let (accounts_p, legacy_p) = store_paths(base);
    let mut store = read_json_file(&accounts_p).unwrap_or_else(|| {
        // Migra el formato v1 (una cuenta) al multi-cuenta
        let mut s = empty_store();
        if let Some(old) = read_json_file(&legacy_p) {
            if let Some(uuid) = old.get("profile").and_then(|p| p.get("uuid")).and_then(|x| x.as_str()) {
                s["accounts"][uuid] = old.clone();
                s["active"] = json!(uuid);
            }
        }
        let _ = fs::create_dir_all(base);
        let _ = fs::write(&accounts_p, serde_json::to_string_pretty(&s).unwrap_or_default());
        s
    });
    if store.get("accounts").and_then(|a| a.as_object()).is_none() {
        store["accounts"] = json!({});
    }
    store
}

fn write_store(base: &Path, store: &Value) -> Result<(), String> {
    let (accounts_p, _) = store_paths(base);
    fs::create_dir_all(base).map_err(|e| e.to_string())?;
    fs::write(&accounts_p, serde_json::to_string_pretty(store).unwrap()).map_err(|e| e.to_string())
}

fn s(v: &Value, k: &str) -> String {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

// ---------- device flow ----------

pub fn device_start(base: &Path) -> Result<Value, String> {
    let cid = client_id(base);
    if cid.is_empty() {
        return Err("Falta el client ID (pestaña Cuentas)".into());
    }
    let data = form(MS_DEVICE, &[("client_id", &cid), ("scope", SCOPE)])?;
    if let Some(e) = data.get("error").and_then(|x| x.as_str()) {
        let d = data.get("error_description").and_then(|x| x.as_str()).unwrap_or(e);
        return Err(format!("Microsoft: {d}"));
    }
    Ok(json!({
        "deviceCode": data.get("device_code"),
        "userCode": data.get("user_code"),
        "verificationUri": data.get("verification_uri"),
        "expiresIn": data.get("expires_in"),
        "interval": data.get("interval").and_then(|x| x.as_u64()).unwrap_or(5) * 1000,
    }))
}

pub fn device_poll_once(base: &Path, device_code: &str) -> Result<Value, String> {
    let cid = client_id(base);
    let data = form(
        MS_TOKEN,
        &[
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("client_id", &cid),
            ("device_code", device_code),
        ],
    )?;
    if data.get("error").and_then(|x| x.as_str()) == Some("authorization_pending") {
        return Ok(json!({ "status": "pending" }));
    }
    if let Some(e) = data.get("error").and_then(|x| x.as_str()) {
        let d = data.get("error_description").and_then(|x| x.as_str()).unwrap_or(e);
        return Ok(json!({ "status": "error", "error": d }));
    }
    let access = s(&data, "access_token");
    let refresh = s(&data, "refresh_token");
    let acc = complete_login(base, &access, &refresh)?;
    Ok(json!({ "status": "done", "name": acc["profile"]["name"], "uuid": acc["profile"]["uuid"] }))
}

// ---------- xbox / minecraft ----------

fn xbox_login(ms_access: &str) -> Result<(String, String, Option<String>), String> {
    let (st, data) = post_json(
        XBL_AUTH,
        &json!({
            "Properties": { "AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": format!("d={ms_access}") },
            "RelyingParty": "http://auth.xboxlive.com", "TokenType": "JWT",
        }),
        None,
    )?;
    let token = data.get("Token").and_then(|x| x.as_str()).unwrap_or("");
    if st != 200 || token.is_empty() {
        return Err("Xbox Live rechazó el token Microsoft".into());
    }
    let uhs = data["DisplayClaims"]["xui"][0]["uhs"].as_str().unwrap_or("").to_string();
    let (s2, d2) = post_json(
        XSTS_AUTH,
        &json!({
            "Properties": { "SandboxId": "RETAIL", "UserTokens": [token] },
            "RelyingParty": "rp://api.minecraftservices.com/", "TokenType": "JWT",
        }),
        None,
    )?;
    let xsts = d2.get("Token").and_then(|x| x.as_str()).unwrap_or("");
    if s2 != 200 || xsts.is_empty() {
        let xerr = d2.get("XErr").and_then(|x| x.as_u64()).unwrap_or(0);
        let msg = match xerr {
            2148916233 => "Esta cuenta Microsoft no tiene perfil de Xbox. Crea uno gratis en xbox.com.".to_string(),
            2148916238 => "Cuenta infantil: necesita permiso familiar para jugar online.".to_string(),
            _ => format!("XSTS error {}", if xerr != 0 { xerr.to_string() } else { s2.to_string() }),
        };
        return Err(msg);
    }
    let out_uhs = d2["DisplayClaims"]["xui"][0]["uhs"].as_str().unwrap_or(&uhs).to_string();
    let xuid = d2["DisplayClaims"]["xui"][0]["xid"].as_str().map(String::from);
    if out_uhs.is_empty() {
        return Err("Xbox no devolvió identidad completa (uhs)".into());
    }
    Ok((out_uhs, xsts.to_string(), xuid))
}

fn minecraft_login(uhs: &str, xsts: &str) -> Result<(String, i64), String> {
    let (st, data) = post_json(
        MC_LOGIN,
        &json!({ "identityToken": format!("XBL3.0 x={uhs};{xsts}") }),
        None,
    )?;
    let tok = data.get("access_token").and_then(|x| x.as_str()).unwrap_or("");
    if st != 200 || tok.is_empty() {
        if st == 401 {
            return Err("Xbox válido pero Mojang lo rechazó (HTTP 401): entra con la cuenta que compró Minecraft Java".into());
        }
        let detail = data.get("errorMessage").or_else(|| data.get("error")).and_then(|x| x.as_str()).unwrap_or("");
        return Err(format!("Mojang HTTP {st}{}: no ve licencia Java en esta identidad Xbox", if detail.is_empty() { "".into() } else { format!(" ({detail})") }));
    }
    Ok((tok.to_string(), data.get("expires_in").and_then(|x| x.as_i64()).unwrap_or(86400)))
}

fn fetch_profile(mc_token: &str) -> Result<Value, String> {
    let resp = agent()
        .get(MC_PROFILE)
        .set("Authorization", &format!("Bearer {mc_token}"))
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(404, _) => "Esta cuenta no tiene Minecraft Java comprado".to_string(),
            ureq::Error::Status(c, _) => format!("Mojang HTTP {c}"),
            e => format!("Sin conexión con Mojang ({e})"),
        })?;
    let p: Value = resp.into_json().map_err(|e| e.to_string())?;
    Ok(json!({ "uuid": p.get("id"), "name": p.get("name"), "skins": p.get("skins").unwrap_or(&json!([])), "capes": p.get("capes").unwrap_or(&json!([])) }))
}

pub fn complete_login(base: &Path, ms_access: &str, ms_refresh: &str) -> Result<Value, String> {
    let (uhs, xsts, xuid) = xbox_login(ms_access)?;
    let (mc_token, expires_in) = minecraft_login(&uhs, &xsts)?;
    let profile = fetch_profile(&mc_token)?;
    let now = chrono::Utc::now().timestamp_millis();
    let mut acc = json!({
        "mcToken": mc_token,
        "mcExpiry": now + expires_in * 1000,
        "msRefresh": ms_refresh,
        "uhs": uhs,
        "profile": profile,
        "savedAt": now,
    });
    if let Some(x) = xuid {
        acc["xuid"] = json!(x);
    }
    let uuid = acc["profile"]["uuid"].as_str().unwrap_or("").to_string();
    if uuid.is_empty() {
        return Err("Mojang devolvió un perfil sin UUID".into());
    }
    let mut store = load_store(base);
    store["accounts"][&uuid] = acc.clone();
    store["active"] = json!(uuid);
    write_store(base, &store)?;
    Ok(acc)
}

/// Cuenta válida (refresca el token MC si caducó). `None` = sin sesión.
pub fn valid_account(base: &Path) -> Option<Value> {
    let store = load_store(base);
    let active = store.get("active").and_then(|x| x.as_str())?;
    let acc = store.get("accounts")?.get(active)?.clone();
    let expiry = acc.get("mcExpiry").and_then(|x| x.as_i64()).unwrap_or(0);
    let now = chrono::Utc::now().timestamp_millis();
    if now < expiry - 60_000 {
        return Some(acc);
    }
    let refresh = acc.get("msRefresh").and_then(|x| x.as_str()).unwrap_or("");
    if refresh.is_empty() {
        return None;
    }
    let cid = client_id(base);
    let data = form(MS_TOKEN, &[("grant_type", "refresh_token"), ("client_id", &cid), ("refresh_token", refresh), ("scope", SCOPE)]).ok()?;
    if data.get("error").is_some() || data.get("access_token").and_then(|x| x.as_str()).unwrap_or("").is_empty() {
        return None;
    }
    let new_refresh = data.get("refresh_token").and_then(|x| x.as_str()).unwrap_or(refresh);
    complete_login(base, &s(&data, "access_token"), new_refresh).ok()
}

// ---------- comandos ----------

pub fn status(base: &Path) -> Value {
    match valid_account(base) {
        Some(acc) => json!({ "name": acc["profile"]["name"], "uuid": acc["profile"]["uuid"] }),
        None => Value::Null,
    }
}

pub fn list_accounts(base: &Path) -> Value {
    let store = load_store(base);
    let active = store.get("active").and_then(|x| x.as_str()).unwrap_or("");
    let arr: Vec<Value> = store
        .get("accounts")
        .and_then(|a| a.as_object())
        .map(|m| {
            m.values()
                .map(|a| {
                    let uuid = a["profile"]["uuid"].as_str().unwrap_or("");
                    json!({ "uuid": uuid, "name": a["profile"]["name"], "active": uuid == active })
                })
                .collect()
        })
        .unwrap_or_default();
    Value::Array(arr)
}

pub fn set_active(base: &Path, uuid: &str) -> Result<Value, String> {
    let mut store = load_store(base);
    if store.get("accounts").and_then(|a| a.get(uuid)).is_none() {
        return Err("Cuenta no encontrada".into());
    }
    store["active"] = json!(uuid);
    write_store(base, &store)?;
    Ok(json!(true))
}

pub fn remove_account(base: &Path, uuid: &str) -> Result<Value, String> {
    let mut store = load_store(base);
    if let Some(m) = store.get_mut("accounts").and_then(|a| a.as_object_mut()) {
        m.remove(uuid);
    }
    if store.get("active").and_then(|x| x.as_str()) == Some(uuid) {
        let first = store.get("accounts").and_then(|a| a.as_object()).and_then(|m| m.keys().next().cloned());
        store["active"] = first.map(Value::String).unwrap_or(Value::Null);
    }
    write_store(base, &store)?;
    Ok(json!(true))
}

pub fn logout(base: &Path) -> Result<Value, String> {
    let mut store = load_store(base);
    if let Some(active) = store.get("active").and_then(|x| x.as_str()).map(String::from) {
        if let Some(m) = store.get_mut("accounts").and_then(|a| a.as_object_mut()) {
            m.remove(&active);
        }
    }
    let first = store.get("accounts").and_then(|a| a.as_object()).and_then(|m| m.keys().next().cloned());
    store["active"] = first.map(Value::String).unwrap_or(Value::Null);
    write_store(base, &store)?;
    Ok(json!(true))
}

fn valid_name(name: &str) -> bool {
    let n = name.trim();
    (3..=16).contains(&n.len()) && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// {name, valid, premium, unknown} — igual que Electron.
pub fn name_check(name: &str) -> Value {
    let clean = name.trim().to_string();
    if !valid_name(&clean) {
        return json!({ "name": clean, "valid": false });
    }
    match net::status_of(&format!("https://api.mojang.com/users/profiles/minecraft/{clean}")) {
        Some(200) => json!({ "name": clean, "valid": true, "premium": true, "unknown": false }),
        Some(404) | Some(204) | Some(400) => json!({ "name": clean, "valid": true, "premium": false, "unknown": false }),
        _ => json!({ "name": clean, "valid": true, "premium": false, "unknown": true }),
    }
}

/// Hasta 4 alternativas libres. Igual que Electron.
pub fn name_suggest(base: &str) -> Value {
    let b: String = base.trim().chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').take(12).collect();
    let b = if b.is_empty() { "Ferro".to_string() } else { b };
    let cap = {
        let mut c = b.clone();
        if let Some(f) = c.get_mut(..1) {
            f.make_ascii_uppercase();
        }
        c
    };
    let n: u64 = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(7);
    let r2 = (n % 90 + 10).to_string();
    let raw = [format!("{b}_"), format!("_{b}"), format!("{b}{r2}"), format!("{b}HD"), format!("{b}YT"), format!("{b}MC"), format!("{b}GG"), format!("{b}Pro"), format!("The{cap}"), format!("{b}x")];
    let mut out = vec![];
    for cand in raw.into_iter().collect::<std::collections::HashSet<_>>() {
        if out.len() >= 4 {
            break;
        }
        if !valid_name(&cand) || cand.to_lowercase() == b.to_lowercase() {
            continue;
        }
        if net::status_of(&format!("https://api.mojang.com/users/profiles/minecraft/{cand}")) == Some(404) {
            out.push(cand);
        }
    }
    Value::Array(out.into_iter().map(Value::String).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_encode_basico() {
        assert_eq!(url_encode("a b+c"), "a+b%2Bc");
        assert_eq!(url_encode("XboxLive.signin offline_access"), "XboxLive.signin+offline_access");
    }

    #[test]
    fn store_vacio_y_ids() {
        let d = tempfile::tempdir().unwrap();
        assert!(status(d.path()).is_null());
        assert_eq!(set_client_id(d.path(), "  abc-123 ").unwrap(), "abc-123");
        let pub_ = client_id_public(d.path());
        assert_eq!(pub_["configured"], true);
        assert!(pub_["masked"].as_str().unwrap().ends_with("123"));
    }

    #[test]
    fn logout_sin_cuentas_no_falla() {
        let d = tempfile::tempdir().unwrap();
        assert!(logout(d.path()).is_ok());
        assert!(list_accounts(d.path()).as_array().unwrap().is_empty());
    }
}
