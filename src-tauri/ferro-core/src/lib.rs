//! Motor de FerroLauncher en Rust. No depende de Tauri: la capa de la app solo
//! le pasa un `Ctx` (carpeta de datos, versión, emisor de eventos) y reenvía
//! cada llamada de la UI (`window.ferro.<nombre>`) a `call`.
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;

pub mod instances;
pub mod launch;
pub mod auth;
pub mod forge;
pub mod loaders;
pub mod mods;
pub mod net;
pub mod zipx;
pub mod mojang;
pub mod sys;

pub type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;

pub struct Ctx {
    pub base: PathBuf,
    pub version: String,
    pub emit: Emit,
}

impl Ctx {
    pub fn new(base: PathBuf, version: &str, emit: Emit) -> Ctx {
        Ctx { base, version: version.to_string(), emit }
    }
    pub fn instances_dir(&self) -> PathBuf {
        self.base.join("instances")
    }
    /// Misma estructura de carpetas que la versión Electron.
    pub fn ensure_dirs(&self) {
        for d in ["instances", "libraries", "assets", "versions", "runtimes"] {
            let _ = std::fs::create_dir_all(self.base.join(d));
        }
    }
    pub fn log(&self, text: &str) {
        (self.emit)("ferro:log", json!(text));
    }
}

fn s(v: &Value, k: &str) -> String {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

const ALLOWED_HOSTS: &[&str] = &[
    "x.com", "www.reddit.com", "wa.me", "t.me", "github.com", "discord.gg",
    "discord.com", "www.youtube.com", "youtu.be", "www.tiktok.com",
    "essential.gg", "minecraft.net", "www.minecraft.net", "help.minecraft.net",
    "feedback.minecraft.net", "modrinth.com", "curseforge.com", "www.curseforge.com",
];

fn host_of(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://")?;
    let end = rest.find(|c| c == '/' || c == '?' || c == '#').unwrap_or(rest.len());
    let auth = &rest[..end];
    if auth.contains('@') || auth.contains('\\') {
        return None;
    }
    let host = auth.split(':').next().unwrap_or("");
    if host.is_empty() { None } else { Some(host.to_lowercase()) }
}

fn social(ctx: &Ctx) -> Value {
    let mut discord = "https://discord.gg/vTujTm3hE".to_string();
    let mut youtube = "https://www.youtube.com/@4dri4n-08".to_string();
    if let Ok(txt) = std::fs::read_to_string(ctx.base.join("ferro-config.json")) {
        if let Ok(v) = serde_json::from_str::<Value>(&txt) {
            if let Some(so) = v.get("social") {
                if let Some(d) = so.get("discord").and_then(|x| x.as_str()) { discord = d.to_string(); }
                if let Some(y) = so.get("youtube").and_then(|x| x.as_str()) { youtube = y.to_string(); }
            }
        }
    }
    json!({ "github": "https://github.com/4DRI4N-OFF/FerroLauncher", "discord": discord, "youtube": youtube })
}

/// Punto de entrada único: `name` es el nombre del método de `window.ferro`.
pub fn call(ctx: &Ctx, name: &str, data: Value) -> Result<Value, String> {
    ctx.ensure_dirs();
    let inst_dir = ctx.instances_dir();
    match name {
        "appVersion" => Ok(json!(ctx.version)),
        "checkUpdate" => Ok(json!({ "state": "dev", "version": ctx.version })),
        "quitAndInstall" => Ok(json!(true)),
        "versions" => mojang::versions(&s(&data, "kind")),
        "instances" => instances::list(&inst_dir),
        "createInstance" => {
            let opts_type = s(&data, "type");
            let lv = data.get("loaderVersion").cloned().unwrap_or(Value::Null);
            instances::create(&inst_dir, &s(&data, "name"), &s(&data, "versionId"), &opts_type, &lv)
        }
        "updateSettings" => {
            let patch = data.get("patch").cloned().unwrap_or(json!({}));
            instances::update_settings(&inst_dir, &s(&data, "instanceName"), &patch)
        }
        "duplicateInstance" => instances::duplicate(&inst_dir, &s(&data, "instanceName")).map(|n| json!(n)),
        "renameInstance" => instances::rename(&inst_dir, &s(&data, "instanceName"), &s(&data, "newName")).map(|n| json!(n)),
        "deleteInstance" => instances::delete(&inst_dir, &s(&data, "instanceName")),
        "instSize" => instances::size(&inst_dir, &s(&data, "instanceName")),
        "instClean" => instances::clean(&inst_dir, &s(&data, "instanceName")),
        "openFolder" => {
            let p = instances::find(&inst_dir, &s(&data, "instanceName"))?;
            opener::open(&p).map_err(|e| e.to_string())?;
            Ok(json!(true))
        }
        "java" => Ok(sys::find_java().unwrap_or(Value::Null)),
        "ramSuggest" => Ok(sys::suggest_ram()),
        "social" => Ok(social(ctx)),
        "openUrl" => {
            let raw = match &data {
                Value::String(u) => u.clone(),
                other => s(other, "url"),
            };
            let host = host_of(&raw).ok_or("URL no permitida")?;
            if !ALLOWED_HOSTS.contains(&host.as_str()) {
                return Err("URL no permitida".into());
            }
            opener::open(&raw).map_err(|e| e.to_string())?;
            Ok(json!(true))
        }
        "status" => Ok(launch::status()),
        "launch" => launch::launch(ctx, &data),
        "stop" => Ok(launch::stop(ctx)),
        "loaders" => loaders::list(&s(&data, "mcVersion"), &s(&data, "type")),
        "loaderCheck" => loaders::check(&inst_dir, &s(&data, "instanceName")),
        "loaderUpdate" => loaders::update(&inst_dir, &s(&data, "instanceName")),
        "clientId" => Ok(auth::client_id_public(&ctx.base)),
        "setClientId" => auth::set_client_id(&ctx.base, &s(&data, "clientId")).map(|id| json!(id)),
        "authStatus" => Ok(auth::status(&ctx.base)),
        "authStart" => auth::device_start(&ctx.base),
        "authPoll" => auth::device_poll_once(&ctx.base, &s(&data, "deviceCode")),
        "authLogout" => auth::logout(&ctx.base),
        "accounts" => Ok(auth::list_accounts(&ctx.base)),
        "authSelect" => auth::set_active(&ctx.base, &s(&data, "uuid")),
        "authRemove" => auth::remove_account(&ctx.base, &s(&data, "uuid")),
        "nameCheck" => Ok(auth::name_check(&s(&data, "name"))),
        "nameSuggest" => Ok(auth::name_suggest(&s(&data, "base"))),
        "modSearch" => mods::search(&s(&data, "query"), &s(&data, "mcVersion"), &s(&data, "loader"), &s(&data, "sort"), &s(&data, "kind"), data.get("offset").and_then(|x| x.as_u64()).unwrap_or(0)),
        "mods" => mods::resolve(&inst_dir, &s(&data, "instanceName")).and_then(|(p, _)| mods::list(&p, &s(&data, "kind"), data.get("world").and_then(|x| x.as_str()))),
        "worlds" => mods::resolve(&inst_dir, &s(&data, "instanceName")).map(|(p, _)| mods::worlds(&p)),
        "modInstall" => mods::resolve(&inst_dir, &s(&data, "instanceName")).and_then(|(p, cfg)| {
            let kind = s(&data, "kind");
            let kind = if ["shader", "resourcepack", "datapack"].contains(&kind.as_str()) { kind } else { "mod".to_string() };
            let typ = cfg.get("type").and_then(|x| x.as_str()).unwrap_or("vanilla");
            if kind == "mod" && typ == "vanilla" {
                return Err("Los mods requieren instancia con loader".into());
            }
            mods::install(&p, &s(&data, "projectId"), &cfg.get("versionId").and_then(|x| x.as_str()).unwrap_or("").to_string(), typ, &kind, data.get("world").and_then(|x| x.as_str()))
        }),
        "modRemove" => mods::resolve(&inst_dir, &s(&data, "instanceName")).and_then(|(p, _)| mods::remove(&p, &s(&data, "file"), &s(&data, "kind"), data.get("world").and_then(|x| x.as_str()))),
        "modToggle" => mods::resolve(&inst_dir, &s(&data, "instanceName")).and_then(|(p, _)| mods::toggle(&p, &s(&data, "file"), data.get("disable").and_then(|x| x.as_bool()).unwrap_or(false), &s(&data, "kind"), data.get("world").and_then(|x| x.as_str()))),
        other => Err(format!(
            "'{other}' todavía no está disponible en la versión Tauri (en construcción)"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(dir: &std::path::Path) -> Ctx {
        Ctx::new(dir.to_path_buf(), "0.9.6", Arc::new(|_, _| {}))
    }

    #[test]
    fn host_allowlist() {
        assert_eq!(host_of("https://github.com/x/y").as_deref(), Some("github.com"));
        assert_eq!(host_of("https://evil.com@github.com/"), None);
        assert_eq!(host_of("http://github.com"), None);
    }

    #[test]
    fn unknown_command_is_an_error_not_a_crash() {
        let d = tempfile::tempdir().unwrap();
        assert!(call(&ctx(d.path()), "modrinthSearch", json!({})).is_err());
        assert_eq!(call(&ctx(d.path()), "appVersion", json!({})).unwrap(), json!("0.9.6"));
        assert!(call(&ctx(d.path()), "openUrl", json!({"url": "https://evil.example/"})).is_err());
    }
}
