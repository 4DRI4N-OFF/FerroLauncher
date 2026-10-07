//! Cuenta Microsoft por código de dispositivo (microsoft.com/link): Xbox -> Minecraft.
//! Las cuentas se guardan en accounts-tauri.json (no toca el accounts.json de Electron,
//! cuyos tokens van cifrados con safeStorage y no se pueden leer desde aquí).
use crate::net;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const MS_DEVICE: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const MS_TOKEN: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const SCOPE: &str = "XboxLive.signin offline_access";
const XBL_AUTH: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE: &str = "https://api.minecraftservices.com/minecraft/profile";
/// ID público de la app (el mismo de build/identity.json). No es un secreto.
const DEFAULT_CLIENT_ID: &str = "e38aa735-6b06-4111-9d58-5190f3d754db";

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) }
fn st(v: &Value, k: &str) -> String { v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string() }
fn store_path(base: &Path) -> PathBuf { base.join("accounts-tauri.json") }
fn config_path(base: &Path) -> PathBuf { base.join("ferro-config.json") }

pub fn client_id(base: &Path) -> String {
    if let Ok(t) = fs::read_to_string(config_path(base)) {
        if let Ok(v) = serde_json::from_str::<Value>(&t) {
            let c = st(&v, "clientId");
            if !c.is_empty() { return c; }
        }
    }
    DEFAULT_CLIENT_ID.to_string()
}

fn mask(id: &str) -> String { if id.is_empty() { String::new() } else { format!("••••{}", &id[id.len().saturating_sub(4)..]) } }

pub fn client_id_public(base: &Path) -> Value {
    let id = client_id(base);
    json!({ "masked": mask(&id), "configured": !id.is_empty() })
}

pub fn set_client_id(base: &Path, id: &str) -> Result<Value, String> {
    let p = config_path(base);
    let mut cfg: Value = fs::read_to_string(&p).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(json!({}));
    cfg["clientId"] = json!(id.trim());
    fs::write(&p, serde_json::to_string_pretty(&cfg).unwrap()).map_err(|e| e.to_string())?;
    Ok(json!(id.trim()))
}

fn load(base: &Path) -> Value {
    let mut s: Value = fs::read_to_string(store_path(base)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(json!({}));
    if !s["accounts"].is_object() { s["accounts"] = json!({}); }
    s
}

fn save(base: &Path, s: &Value) -> Result<(), String> {
    fs::write(store_path(base), serde_json::to_string_pretty(s).unwrap()).map_err(|e| e.to_string())
}

pub fn load_account(base: &Path) -> Option<Value> {
    let s = load(base);
    let a = s["active"].as_str()?;
    s["accounts"].get(a).cloned()
}

pub fn status(base: &Path) -> Value {
    match load_account(base) {
        Some(a) => json!({ "name": a["profile"]["name"], "uuid": a["profile"]["uuid"] }),
        None => Value::Null,
    }
}

pub fn list(base: &Path) -> Value {
    let s = load(base);
    let act = s["active"].as_str().unwrap_or("").to_string();
    Value::Array(s["accounts"].as_object().map(|o| o.values().map(|a| {
        let u = st(&a["profile"], "uuid");
        json!({ "uuid": u, "name": a["profile"]["name"], "active": u == act })
    }).collect()).unwrap_or_default())
}

pub fn set_active(base: &Path, uuid: &str) -> Result<Value, String> {
    let mut s = load(base);
    if s["accounts"].get(uuid).is_none() { return Err("Cuenta no encontrada".into()); }
    s["active"] = json!(uuid);
    save(base, &s)?;
    Ok(json!(true))
}

pub fn remove(base: &Path, uuid: &str) -> Result<Value, String> {
    let mut s = load(base);
    if let Some(o) = s["accounts"].as_object_mut() { o.remove(uuid); }
    if s["active"] == json!(uuid) { s["active"] = s["accounts"].as_object().and_then(|o| o.keys().next().cloned()).map_or(Value::Null, |k| json!(k)); }
    save(base, &s)?;
    Ok(json!(true))
}

pub fn logout(base: &Path) -> Result<Value, String> {
    let s = load(base);
    match s["active"].as_str() { Some(u) => remove(base, u), None => Ok(json!(true)) }
}

pub fn device_start(base: &Path) -> Result<Value, String> {
    let id = client_id(base);
    if id.is_empty() { return Err("Falta el client ID (pestaña Cuentas)".into()); }
    let (_, d) = net::post_form(MS_DEVICE, &[("client_id", &id), ("scope", SCOPE)])?;
    if let Some(e) = d.get("error").and_then(|x| x.as_str()) {
        return Err(format!("Microsoft: {}", d["error_description"].as_str().unwrap_or(e)));
    }
    Ok(json!({
        "deviceCode": d["device_code"], "userCode": d["user_code"], "verificationUri": d["verification_uri"],
        "expiresIn": d["expires_in"], "interval": d["interval"].as_u64().unwrap_or(5) * 1000,
    }))
}

pub fn device_poll(base: &Path, device_code: &str) -> Result<Value, String> {
    let id = client_id(base);
    let (_, d) = net::post_form(MS_TOKEN, &[
        ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"), ("client_id", &id), ("device_code", device_code),
    ])?;
    match d.get("error").and_then(|x| x.as_str()) {
        Some("authorization_pending") | Some("slow_down") => return Ok(json!({ "status": "pending" })),
        Some(e) => return Ok(json!({ "status": "error", "error": d["error_description"].as_str().unwrap_or(e) })),
        None => {}
    }
    let acc = complete_login(base, &st(&d, "access_token"), &st(&d, "refresh_token"))?;
    Ok(json!({ "status": "done", "name": acc["profile"]["name"], "uuid": acc["profile"]["uuid"] }))
}

fn xsts_error(code: u64) -> Option<&'static str> {
    match code {
        2148916233 => Some("Esta cuenta Microsoft no tiene perfil de Xbox. Crea uno gratis en xbox.com."),
        2148916238 => Some("Cuenta infantil: necesita permiso familiar para jugar online."),
        _ => None,
    }
}

fn complete_login(base: &Path, ms_access: &str, ms_refresh: &str) -> Result<Value, String> {
    let (s1, d1) = net::post_json(XBL_AUTH, &json!({
        "Properties": { "AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": format!("d={ms_access}") },
        "RelyingParty": "http://auth.xboxlive.com", "TokenType": "JWT" }))?;
    if s1 != 200 || d1["Token"].as_str().is_none() { return Err("Xbox Live rechazó el token Microsoft".into()); }
    let (s2, d2) = net::post_json(XSTS_AUTH, &json!({
        "Properties": { "SandboxId": "RETAIL", "UserTokens": [d1["Token"]] },
        "RelyingParty": "rp://api.minecraftservices.com/", "TokenType": "JWT" }))?;
    if s2 != 200 || d2["Token"].as_str().is_none() {
        let x = d2["XErr"].as_u64().unwrap_or(0);
        return Err(xsts_error(x).map(String::from).unwrap_or_else(|| format!("XSTS error {}", if x > 0 { x } else { s2 as u64 })));
    }
    let uhs = d2.pointer("/DisplayClaims/xui/0/uhs").or_else(|| d1.pointer("/DisplayClaims/xui/0/uhs")).and_then(|x| x.as_str()).ok_or("Xbox no devolvió identidad completa (uhs)")?.to_string();
    let xuid = d2.pointer("/DisplayClaims/xui/0/xid").and_then(|x| x.as_str()).map(String::from);
    let (s3, d3) = net::post_json(MC_LOGIN, &json!({ "identityToken": format!("XBL3.0 x={uhs};{}", st(&d2, "Token")) }))?;
    let mc_token = match d3["access_token"].as_str() {
        Some(t) if s3 == 200 => t.to_string(),
        _ => {
            if s3 == 401 { return Err("Xbox válido pero Mojang lo rechazó (HTTP 401): entra con la cuenta que compró Minecraft Java".into()); }
            return Err(format!("Mojang HTTP {s3}: no ve licencia Java en esta identidad Xbox"));
        }
    };
    let (s4, p) = net::get_bearer(MC_PROFILE, &mc_token)?;
    if s4 == 404 { return Err("Esta cuenta no tiene Minecraft Java comprado".into()); }
    if s4 != 200 { return Err(format!("Mojang HTTP {s4}")); }
    let profile = json!({ "uuid": p["id"], "name": p["name"], "skins": p["skins"], "capes": p["capes"] });
    let mut acc = json!({
        "mcToken": mc_token, "mcExpiry": now_ms() + d3["expires_in"].as_u64().unwrap_or(86400) * 1000,
        "msRefresh": ms_refresh, "uhs": uhs, "profile": profile, "savedAt": now_ms(),
    });
    if let Some(x) = xuid { acc["xuid"] = json!(x); }
    let mut s = load(base);
    let uuid = st(&acc["profile"], "uuid");
    s["accounts"][&uuid] = acc.clone();
    s["active"] = json!(uuid);
    save(base, &s)?;
    Ok(acc)
}

/// Cuenta con token Minecraft vigente (refresca si caducó). None si no hay sesión.
pub fn valid_account(base: &Path) -> Result<Option<Value>, String> {
    let acc = match load_account(base) { Some(a) => a, None => return Ok(None) };
    if now_ms() + 60_000 < acc["mcExpiry"].as_u64().unwrap_or(0) { return Ok(Some(acc)); }
    let refresh = st(&acc, "msRefresh");
    if refresh.is_empty() { return Ok(None); }
    let id = client_id(base);
    let (_, d) = net::post_form(MS_TOKEN, &[("grant_type", "refresh_token"), ("client_id", &id), ("refresh_token", &refresh), ("scope", SCOPE)])?;
    let at = match d["access_token"].as_str() { Some(t) => t.to_string(), None => return Ok(None) };
    let rt = d["refresh_token"].as_str().map(String::from).unwrap_or(refresh);
    complete_login(base, &at, &rt).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn store_roundtrip_and_switching() {
        let t = tempfile::tempdir().unwrap();
        assert!(status(t.path()).is_null());
        let mut s = load(t.path());
        s["accounts"]["u1"] = json!({"profile":{"uuid":"u1","name":"A"}});
        s["accounts"]["u2"] = json!({"profile":{"uuid":"u2","name":"B"}});
        s["active"] = json!("u1");
        save(t.path(), &s).unwrap();
        assert_eq!(status(t.path())["name"], "A");
        set_active(t.path(), "u2").unwrap();
        assert_eq!(status(t.path())["name"], "B");
        assert!(set_active(t.path(), "zz").is_err());
        logout(t.path()).unwrap();
        assert_eq!(status(t.path())["name"], "A");
        assert_eq!(list(t.path()).as_array().unwrap().len(), 1);
    }
    #[test]
    fn client_id_default_and_override() {
        let t = tempfile::tempdir().unwrap();
        assert_eq!(client_id(t.path()), DEFAULT_CLIENT_ID);
        assert_eq!(client_id_public(t.path())["configured"], true);
        set_client_id(t.path(), " abc123xyz ").unwrap();
        assert_eq!(client_id(t.path()), "abc123xyz");
        assert_eq!(client_id_public(t.path())["masked"], "••••3xyz");
    }
    #[test]
    fn xsts() { assert!(xsts_error(2148916233).is_some()); assert!(xsts_error(1).is_none()); }
}
