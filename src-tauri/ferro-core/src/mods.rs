//! Contenido Modrinth: buscar, instalar, listar, activar/desactivar, borrar.
//! Replica `core/modrinthService.js` de Electron (solo lectura/escritura básica;
//! `modUpdates/modUpdate` quedan para después).
use crate::{instances, net};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

const API: &str = "https://api.modrinth.com/v2";

fn kind_dir(kind: &str) -> &str {
    match kind {
        "shader" => "shaderpacks",
        "resourcepack" => "resourcepacks",
        "datapack" => "datapacks",
        _ => "mods",
    }
}

fn norm_kind(kind: &str) -> &str {
    match kind {
        "shader" | "resourcepack" | "datapack" => kind,
        _ => "mod",
    }
}

fn safe_segment(n: &str) -> Result<String, String> {
    let s = n.replace('\\', "/").rsplit('/').next().unwrap_or("").to_string();
    if s.is_empty() || s == "." || s == ".." {
        return Err("Nombre no válido".into());
    }
    Ok(s)
}

fn content_dir(instance_dir: &Path, kind: &str, world: Option<&str>) -> Result<PathBuf, String> {
    if kind == "datapack" {
        let w = world.filter(|w| !w.is_empty()).ok_or("Elige un mundo para el datapack")?;
        return Ok(instance_dir.join("saves").join(safe_segment(w)?).join("datapacks"));
    }
    Ok(instance_dir.join(kind_dir(kind)))
}

fn enc(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Busca en Modrinth. Igual que `ferro:modSearch`.
pub fn search(query: &str, mc: &str, loader: &str, sort: &str, kind: &str, offset: u64) -> Result<Value, String> {
    let kind = norm_kind(kind);
    let loader = match loader {
        "quilt" | "forge" | "neoforge" => loader,
        _ => "fabric",
    };
    let sorts = ["relevance", "downloads", "follows", "newest", "updated"];
    let sort = if sorts.contains(&sort) { sort } else { "relevance" };
    let mut facets = format!("[[\"versions:{mc}\"],[\"project_type:{kind}\"]]");
    if kind == "mod" {
        facets = format!("[[\"versions:{mc}\"],[\"project_type:mod\"],[\"categories:{loader}\"]]");
    }
    let url = format!("{API}/search?query={}&facets={}&limit=24&offset={offset}&index={sort}", enc(query), enc(&facets));
    let data = net::fetch_json(&url)?;
    let hits: Vec<Value> = data["hits"].as_array().map(|a| a.as_slice()).unwrap_or(&[]).iter().map(|h| {
        json!({
            "id": h.get("project_id"), "slug": h.get("slug"), "title": h.get("title"),
            "description": h.get("description"), "icon": h.get("icon_url"),
            "downloads": h.get("downloads"), "updated": h.get("date_modified"),
            "client": h.get("client_side"), "server": h.get("server_side"),
        })
    }).collect();
    Ok(json!({ "total": data.get("total_hits").and_then(|x| x.as_u64()).unwrap_or(0), "hits": hits }))
}

fn project_versions(project: &str, mc: &str, loader: Option<&str>) -> Result<Value, String> {
    let mut q = format!("game_versions={}", enc(&format!("[\"{mc}\"]")));
    if let Some(l) = loader {
        q.push_str(&format!("&loaders={}", enc(&format!("[\"{l}\"]"))));
    }
    net::fetch_json(&format!("{API}/project/{}/version?{q}", enc(project)))
}

fn pick_version(versions: &Value) -> Option<Value> {
    let arr = versions.as_array()?;
    arr.iter().find(|v| v.get("version_type").and_then(|x| x.as_str()) == Some("release")).or_else(|| arr.first()).cloned()
}

/// Instala el archivo primario de la última release compatible.
pub fn install(inst_dir: &Path, project: &str, mc: &str, loader: &str, kind: &str, world: Option<&str>) -> Result<Value, String> {
    let kind = norm_kind(kind);
    let loader = match loader {
        "quilt" | "forge" | "neoforge" => loader,
        _ => "fabric",
    };
    let versions = project_versions(project, mc, if kind == "mod" { Some(loader) } else { None })?;
    let v = pick_version(&versions).ok_or("Sin versión compatible")?;
    let files = v.get("files").and_then(|f| f.as_array()).ok_or("Versión sin archivo")?;
    let file = files.iter().find(|f| f.get("primary").and_then(|x| x.as_bool()).unwrap_or(false)).or_else(|| files.first()).ok_or("Versión sin archivo")?;
    let url = file.get("url").and_then(|x| x.as_str()).ok_or("Versión sin archivo")?;
    let name = file.get("filename").and_then(|x| x.as_str()).unwrap_or("mod.jar");
    let safe: String = name.chars().map(|c| if c.is_alphanumeric() || "-_.+() []".contains(c) { c } else { '_' }).collect();
    let dest = content_dir(inst_dir, kind, world)?.join(&safe);
    net::download_file(
        url,
        &dest,
        file.get("size").and_then(|x| x.as_u64()),
        file.pointer("/hashes/sha1").and_then(|x| x.as_str()),
        None,
    )?;
    Ok(json!({ "version": v.get("version_number"), "file": safe }))
}

/// Archivos instalados (.jar o .zip, con marca .disabled).
pub fn list(inst_dir: &Path, kind: &str, world: Option<&str>) -> Result<Value, String> {
    let kind = norm_kind(kind);
    let dir = content_dir(inst_dir, kind, world)?;
    let _ = fs::create_dir_all(&dir);
    let ext = if kind == "mod" { ".jar" } else { ".zip" };
    let mut out = vec![];
    for e in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        if !e.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        let (plain, disabled) = match name.strip_suffix(".disabled") {
            Some(b) => (b.to_string(), true),
            None => (name.clone(), false),
        };
        if !plain.ends_with(ext) {
            continue;
        }
        let md = fs::metadata(e.path()).map_err(|e| e.to_string())?;
        let mtime = md.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
        out.push(json!({ "file": name, "path": e.path().to_string_lossy(), "size": md.len(), "mtime": mtime, "disabled": disabled }));
    }
    Ok(Value::Array(out))
}

pub fn toggle(inst_dir: &Path, file: &str, disable: bool, kind: &str, world: Option<&str>) -> Result<Value, String> {
    let kind = norm_kind(kind);
    let dir = content_dir(inst_dir, kind, world)?;
    let base = safe_segment(file)?;
    let from = dir.join(&base);
    let to = if disable {
        if base.ends_with(".disabled") { from.clone() } else { dir.join(format!("{base}.disabled")) }
    } else {
        dir.join(base.strip_suffix(".disabled").unwrap_or(&base).to_string())
    };
    if from != to {
        fs::rename(&from, &to).map_err(|e| e.to_string())?;
    }
    Ok(json!(to.file_name().and_then(|n| n.to_str()).unwrap_or(&base)))
}

pub fn remove(inst_dir: &Path, file: &str, kind: &str, world: Option<&str>) -> Result<Value, String> {
    let dir = content_dir(inst_dir, kind, world)?;
    fs::remove_file(dir.join(safe_segment(file)?)).map_err(|e| e.to_string())?;
    Ok(json!(true))
}

/// Mundos de la instancia (carpetas en saves/, con level.dat primero).
pub fn worlds(inst_dir: &Path) -> Value {
    let saves = inst_dir.join("saves");
    let mut dirs: Vec<String> = fs::read_dir(&saves).map(|rd| rd.flatten().filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false)).map(|e| e.file_name().to_string_lossy().to_string()).collect()).unwrap_or_default();
    dirs.sort_by(|a, b| {
        let la = saves.join(a).join("level.dat").is_file();
        let lb = saves.join(b).join("level.dat").is_file();
        lb.cmp(&la).then(a.cmp(b))
    });
    Value::Array(dirs.into_iter().map(Value::String).collect())
}

fn inst_path(inst_dir: &Path, name: &str) -> Result<PathBuf, String> {
    instances::find(inst_dir, name)
}

/// Resuelve (ruta instancia, cfg) para los comandos de la UI.
pub fn resolve(inst_dir: &Path, name: &str) -> Result<(PathBuf, Value), String> {
    let p = inst_path(inst_dir, name)?;
    let cfg = instances::read_cfg(&p.join("ferro.json"))?;
    Ok((p, cfg))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segmentos_inseguros_fuera() {
        assert!(safe_segment("../x").is_ok()); // basename lo neutraliza
        assert!(safe_segment("..").is_err());
        assert_eq!(content_dir(Path::new("/i"), "mod", None).unwrap(), PathBuf::from("/i/mods"));
        assert_eq!(content_dir(Path::new("/i"), "datapack", Some("mundo1")).unwrap(), PathBuf::from("/i/saves/mundo1/datapacks"));
        assert!(content_dir(Path::new("/i"), "datapack", None).is_err());
    }

    #[test]
    fn pick_prefiere_release() {
        let v: Value = serde_json::from_str(r#"[{"id":"b","version_type":"beta"},{"id":"a","version_type":"release"}]"#).unwrap();
        assert_eq!(pick_version(&v).unwrap()["id"], "a");
    }

    #[test]
    fn toggle_y_remove_en_tmp() {
        let d = tempfile::tempdir().unwrap();
        let mods = d.path().join("mods");
        fs::create_dir_all(&mods).unwrap();
        fs::write(mods.join("a.jar"), b"x").unwrap();
        assert_eq!(toggle(d.path(), "a.jar", true, "mod", None).unwrap(), "a.jar.disabled");
        assert!(mods.join("a.jar.disabled").is_file());
        assert!(remove(d.path(), "a.jar.disabled", "mod", None).is_ok());
        assert!(list(d.path(), "mod", None).unwrap().as_array().unwrap().is_empty());
    }
}
