//! Forge y NeoForge: instaladores oficiales en modo headless.
//! Replica `core/forgeService.js` de Electron.
use crate::{instances, net, sys, Ctx};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub fn forge_installer_url(mc: &str, fv: &str) -> String {
    let v = format!("{mc}-{fv}");
    format!("https://maven.minecraftforge.net/net/minecraftforge/forge/{v}/forge-{v}-installer.jar")
}

pub fn neo_installer_url(nv: &str) -> String {
    format!("https://maven.neoforged.net/releases/net/neoforged/neoforge/{nv}/neoforge-{nv}-installer.jar")
}

fn snapshot_profiles(versions_dir: &Path) -> HashSet<PathBuf> {
    let mut set = HashSet::new();
    let rd = match fs::read_dir(versions_dir) {
        Ok(r) => r,
        Err(_) => return set,
    };
    for e in rd.flatten() {
        let d = e.path();
        if !d.is_dir() {
            continue;
        }
        if let Some(name) = d.file_name().and_then(|n| n.to_str()) {
            let j = d.join(format!("{name}.json"));
            if j.is_file() {
                set.insert(j);
            }
        }
    }
    set
}

/// Ejecuta el instalador oficial (`--installClient`) y devuelve el profile JSON nuevo.
pub fn run_installer(ctx: &Ctx, java_bin: &str, installer: &Path, target_base: &Path, versions_dir: &Path) -> Result<PathBuf, String> {
    let before = snapshot_profiles(versions_dir);
    fs::create_dir_all(target_base).map_err(|e| e.to_string())?;
    let name = installer.file_name().and_then(|n| n.to_str()).unwrap_or("installer.jar");
    ctx.log(&format!("[ferro] instalador: {name} (puede tardar varios minutos)…\n"));
    let mut child = {
        let mut cmd = Command::new(java_bin);
        cmd.args(["-jar", &installer.to_string_lossy(), "--installClient", &target_base.to_string_lossy()])
            .current_dir(target_base)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null());
        sys::quiet(&mut cmd);
        cmd.spawn().map_err(|e| format!("Instalador no arrancó: {e}"))?
    };
    // Vuelca la salida al log
    let emit = ctx.emit.clone();
    if let Some(s) = child.stdout.take() {
        let emit = emit.clone();
        std::thread::spawn(move || {
            let mut rd = BufReader::new(s);
            let mut line = String::new();
            while rd.read_line(&mut line).unwrap_or(0) > 0 {
                emit("ferro:log", Value::String(std::mem::take(&mut line)));
            }
        });
    }
    if let Some(s) = child.stderr.take() {
        let emit = emit.clone();
        std::thread::spawn(move || {
            let mut rd = BufReader::new(s);
            let mut line = String::new();
            while rd.read_line(&mut line).unwrap_or(0) > 0 {
                emit("ferro:log", Value::String(std::mem::take(&mut line)));
            }
        });
    }
    let t0 = Instant::now();
    let code: Option<i32> = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(st) => break st.code(),
            None => {
                if t0.elapsed() > Duration::from_secs(15 * 60) {
                    let _ = child.kill();
                    return Err("El instalador tardó más de 15 minutos; abortado".into());
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        }
    };
    if code != Some(0) {
        return Err(format!("Instalador salió con código {}", code.unwrap_or(-1)));
    }
    let fresh: Vec<PathBuf> = snapshot_profiles(versions_dir).difference(&before).cloned().collect();
    if fresh.is_empty() {
        return Err("El instalador no generó ningún perfil nuevo".into());
    }
    // Prefiere el perfil cuyo JSON mencione forge/neoforge
    let mut sorted = fresh;
    sorted.sort_by_key(|p| {
        let head = fs::read_to_string(p).map(|t| t.chars().take(2000).collect::<String>().to_lowercase()).unwrap_or_default();
        if head.contains("forge") { 0 } else { 1 }
    });
    Ok(sorted[0].clone())
}

/// Perfil efectivo: reutiliza `forgeProfileId` cacheado o ejecuta el instalador.
/// Devuelve (details del perfil, profile_id).
pub fn ensure_profile(
    ctx: &Ctx,
    java_bin: &str,
    inst_dir: &Path,
    inst_name: &str,
    typ: &str,
    mc: &str,
    ver: &str,
) -> Result<(Value, String), String> {
    let versions_dir = ctx.base.join("versions");
    let installer = versions_dir.join("_installers").join(format!("{typ}-{mc}-{ver}-installer.jar"));
    let url = if typ == "forge" { forge_installer_url(mc, ver) } else { neo_installer_url(ver) };
    net::download_file(&url, &installer, None, None, None)?;
    ctx.log(&format!("[ferro] instalador {typ} {ver} listo\n"));
    if let Ok(cfg) = instances::read_cfg(&inst_dir.join("ferro.json")) {
        if let Some(pid) = cfg.get("forgeProfileId").and_then(|x| x.as_str()) {
            let pj = versions_dir.join(pid).join(format!("{pid}.json"));
            if pj.is_file() {
                ctx.log(&format!("[ferro] perfil {typ} ya instalado\n"));
                let details: Value = serde_json::from_str(&fs::read_to_string(&pj).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
                return Ok((details, pid.to_string()));
            }
        }
    }
    let pj = run_installer(ctx, java_bin, &installer, &ctx.base, &versions_dir)?;
    let pid = pj.parent().and_then(|d| d.file_name()).and_then(|n| n.to_str()).unwrap_or("").to_string();
    let _ = instances::update_settings(&ctx.instances_dir(), inst_name, &serde_json::json!({ "forgeProfileId": pid }));
    ctx.log(&format!("[ferro] perfil {typ} instalado: {pid}\n"));
    let details: Value = serde_json::from_str(&fs::read_to_string(&pj).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok((details, pid))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_formato_oficial() {
        assert_eq!(
            forge_installer_url("1.20.1", "47.2.0"),
            "https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.2.0/forge-1.20.1-47.2.0-installer.jar"
        );
        assert_eq!(
            neo_installer_url("21.1.5"),
            "https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.5/neoforge-21.1.5-installer.jar"
        );
    }
}
