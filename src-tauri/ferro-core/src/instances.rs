//! Instancias: mismo formato en disco que la versión Electron (ferro.json).
//! Se trabaja sobre serde_json::Value para no perder campos que no conocemos.
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

fn default_settings() -> Map<String, Value> {
    let v = json!({ "ramMb": 2048, "javaMode": "auto", "javaPath": "", "width": 854, "height": 480, "jvmPreset": "equilibrado" });
    v.as_object().unwrap().clone()
}

fn with_settings(mut cfg: Value) -> Value {
    let mut s = default_settings();
    if let Some(o) = cfg.get("settings").and_then(|x| x.as_object()) {
        for (k, v) in o { s.insert(k.clone(), v.clone()); }
    }
    if !cfg.is_object() { cfg = json!({}); }
    cfg["settings"] = Value::Object(s);
    cfg
}

fn read_cfg(path: &Path) -> Result<Value, String> {
    let txt = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&txt).map_err(|e| e.to_string())
}

fn write_cfg(path: &Path, cfg: &Value) -> Result<(), String> {
    fs::write(path, serde_json::to_string_pretty(cfg).unwrap()).map_err(|e| e.to_string())
}

/// Los nombres vienen de la UI y nunca deben escapar de la carpeta de instancias.
pub fn safe_name(n: &str) -> Result<String, String> {
    let norm = n.replace('\\', "/");
    let s = norm.trim_end_matches('/').rsplit('/').next().unwrap_or("").to_string();
    if s.is_empty() || s == "." || s == ".." { return Err("Nombre no válido".into()); }
    Ok(s)
}

fn is_w(c: char) -> bool { c.is_ascii_alphanumeric() || c == '_' }

/// Equivale a `name.replace(/[^\w\-. ]+/g, '_')`.
fn sanitize(name: &str) -> String {
    let mut out = String::new();
    let mut in_bad = false;
    for c in name.chars() {
        if is_w(c) || c == '-' || c == '.' || c == ' ' {
            out.push(c);
            in_bad = false;
        } else if !in_bad {
            out.push('_');
            in_bad = true;
        }
    }
    out
}

pub fn instance_base(name: &str) -> String {
    let cleaned = sanitize(name).trim().to_string();
    let cleaned = if !cleaned.is_empty() && cleaned.chars().all(|c| c == '.') { String::new() } else { cleaned };
    if cleaned.is_empty() { "Instancia".into() } else { cleaned }
}

pub fn find(dir: &Path, name: &str) -> Result<PathBuf, String> {
    let p = dir.join(safe_name(name)?);
    if p.is_dir() { Ok(p) } else { Err("Instancia no encontrada".into()) }
}

pub fn list(dir: &Path) -> Result<Value, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    let mut entries: Vec<_> = fs::read_dir(dir).map_err(|e| e.to_string())?.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        if !e.path().is_dir() { continue; }
        let name = e.file_name().to_string_lossy().to_string();
        let cfg = read_cfg(&e.path().join("ferro.json")).unwrap_or(json!({}));
        let mut base = json!({ "name": name, "path": e.path().to_string_lossy() });
        if let Some(o) = cfg.as_object() { for (k, v) in o { base[k] = v.clone(); } }
        out.push(with_settings(base));
    }
    Ok(Value::Array(out))
}

pub fn create(dir: &Path, name: &str, version_id: &str, typ: &str, loader_version: &Value) -> Result<Value, String> {
    let base = instance_base(name);
    let taken = |s: &str| {
        let d = dir.join(s);
        d.join("ferro.json").exists() || fs::read_dir(&d).map(|mut r| r.next().is_some()).unwrap_or(false)
    };
    let mut safe = base.clone();
    let mut i = 2;
    while taken(&safe) { safe = format!("{base} ({i})"); i += 1; }
    let d = dir.join(&safe);
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let typ = if ["fabric", "quilt", "forge", "neoforge"].contains(&typ) { typ } else { "vanilla" };
    let mut cfg = json!({
        "name": safe, "versionId": version_id,
        "createdAt": chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
        "type": typ,
    });
    if typ != "vanilla" {
        cfg["loaderVersion"] = if loader_version.as_str().map_or(false, |s| !s.is_empty()) { loader_version.clone() } else { Value::Null };
    }
    let cfg = with_settings(cfg);
    write_cfg(&d.join("ferro.json"), &cfg)?;
    let mut res = json!({ "name": safe, "path": d.to_string_lossy() });
    for (k, v) in cfg.as_object().unwrap() { res[k] = v.clone(); }
    Ok(res)
}

fn num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

pub fn update_settings(dir: &Path, name: &str, patch: &Value) -> Result<Value, String> {
    let d = dir.join(safe_name(name)?);
    let cfg_path = d.join("ferro.json");
    let mut cfg = with_settings(read_cfg(&cfg_path)?);
    let mut s = cfg["settings"].as_object().cloned().unwrap_or_default();
    let clamp = |v: &Value, lo: f64, hi: f64, def: f64| -> Value {
        let n = num(v).filter(|n| *n != 0.0).unwrap_or(def);
        json!(n.max(lo).min(hi) as i64)
    };
    if let Some(v) = patch.get("ramMb") { s.insert("ramMb".into(), clamp(v, 512.0, 16384.0, 2048.0)); }
    if let Some(v) = patch.get("javaMode") { s.insert("javaMode".into(), json!(if v.as_str() == Some("custom") { "custom" } else { "auto" })); }
    if let Some(v) = patch.get("javaPath") { s.insert("javaPath".into(), json!(v.as_str().unwrap_or(""))); }
    if let Some(v) = patch.get("width") { s.insert("width".into(), clamp(v, 320.0, 7680.0, 854.0)); }
    if let Some(v) = patch.get("height") { s.insert("height".into(), clamp(v, 240.0, 4320.0, 480.0)); }
    if let Some(v) = patch.get("jvmPreset") {
        let ok = ["equilibrado", "rendimiento", "patata", "zgc"];
        let p = v.as_str().filter(|p| ok.contains(p)).unwrap_or("equilibrado");
        s.insert("jvmPreset".into(), json!(p));
    }
    if let Some(v) = patch.get("pinned") {
        let b = match v { Value::Bool(b) => *b, Value::Null => false, Value::String(x) => !x.is_empty(), Value::Number(n) => n.as_f64() != Some(0.0), _ => true };
        s.insert("pinned".into(), json!(b));
    }
    cfg["settings"] = Value::Object(s);
    if let Some(v) = patch.get("loaderVersion") {
        let raw = match v { Value::String(x) => x.clone(), Value::Null => "null".into(), other => other.to_string() };
        let nv: String = raw.chars().take(40).collect();
        let nv = if nv.is_empty() { Value::Null } else { json!(nv) };
        if nv != cfg.get("loaderVersion").cloned().unwrap_or(Value::Null) {
            cfg["loaderVersion"] = nv;
            if let Some(o) = cfg.as_object_mut() { o.remove("forgeProfileId"); }
        }
    }
    write_cfg(&cfg_path, &cfg)?;
    let mut res = json!({ "name": name, "path": d.to_string_lossy() });
    for (k, v) in cfg.as_object().unwrap() { res[k] = v.clone(); }
    Ok(with_settings(res))
}

fn copy_dir(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for e in fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
        let (s, d) = (e.path(), dest.join(e.file_name()));
        if s.is_dir() { copy_dir(&s, &d)?; } else { fs::copy(&s, &d).map_err(|e| e.to_string())?; }
    }
    Ok(())
}

pub fn duplicate(dir: &Path, name: &str) -> Result<String, String> {
    let src = dir.join(safe_name(name)?);
    let cfg = with_settings(read_cfg(&src.join("ferro.json"))?);
    let cname = cfg["name"].as_str().unwrap_or(name).to_string();
    let safe = sanitize(&format!("{cname} copia")).trim().to_string();
    let mut dest = safe.clone();
    let mut i = 2;
    while dir.join(&dest).exists() { dest = format!("{safe} ({i})"); i += 1; }
    copy_dir(&src, &dir.join(&dest))?;
    let cfg_path = dir.join(&dest).join("ferro.json");
    let mut c2 = with_settings(read_cfg(&cfg_path)?);
    c2["name"] = json!(dest);
    if let Some(o) = c2.as_object_mut() { o.remove("lastPlayed"); }
    write_cfg(&cfg_path, &c2)?;
    Ok(dest)
}

pub fn delete(dir: &Path, name: &str) -> Result<Value, String> {
    let p = find(dir, name)?;
    if trash::delete(&p).is_ok() { return Ok(json!(true)); }
    fs::remove_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(json!(true))
}

pub fn rename(dir: &Path, old: &str, new: &str) -> Result<String, String> {
    let safe = sanitize(new).trim().to_string();
    if safe.is_empty() { return Err("Nombre vacío".into()); }
    if dir.join(&safe).exists() { return Err("Ya existe ese nombre".into()); }
    fs::rename(dir.join(safe_name(old)?), dir.join(&safe)).map_err(|e| e.to_string())?;
    let cfg_path = dir.join(&safe).join("ferro.json");
    let mut cfg = with_settings(read_cfg(&cfg_path)?);
    cfg["name"] = json!(safe);
    write_cfg(&cfg_path, &cfg)?;
    Ok(safe)
}

fn walk(p: &Path, bytes: &mut u64, files: &mut u64) {
    let md = match fs::symlink_metadata(p) { Ok(m) => m, Err(_) => return };
    if md.file_type().is_symlink() { return; }
    if md.is_file() { *bytes += md.len(); *files += 1; return; }
    if !md.is_dir() { return; }
    if let Ok(rd) = fs::read_dir(p) { for e in rd.flatten() { walk(&e.path(), bytes, files); } }
}

pub fn size(dir: &Path, name: &str) -> Result<Value, String> {
    let d = find(dir, name)?;
    let (mut total, mut files) = (0u64, 0u64);
    let mut top = Map::new();
    if let Ok(rd) = fs::read_dir(&d) {
        for e in rd.flatten() {
            let (mut b, mut f) = (0u64, 0u64);
            walk(&e.path(), &mut b, &mut f);
            if b > 0 { top.insert(e.file_name().to_string_lossy().to_string(), json!(b)); }
            total += b; files += f;
        }
    }
    Ok(json!({ "bytes": total, "files": files, "top": top }))
}

/// Limpieza segura: logs enteros + crash-reports de más de 30 días.
pub fn clean(dir: &Path, name: &str) -> Result<Value, String> {
    let d = find(dir, name)?;
    let (mut freed, mut removed) = (0u64, 0u64);
    let mut rm = |p: &Path| {
        if let Ok(m) = fs::metadata(p) {
            if m.is_file() && fs::remove_file(p).is_ok() { freed += m.len(); removed += 1; }
        }
    };
    if let Ok(rd) = fs::read_dir(d.join("logs")) { for e in rd.flatten() { rm(&e.path()); } }
    if let Ok(rd) = fs::read_dir(d.join("crash-reports")) {
        let limit = std::time::SystemTime::now() - std::time::Duration::from_secs(30 * 86400);
        for e in rd.flatten() {
            if e.metadata().and_then(|m| m.modified()).map(|t| t < limit).unwrap_or(false) { rm(&e.path()); }
        }
    }
    Ok(json!({ "freed": freed, "removed": removed }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_name_blocks_escapes() {
        assert!(safe_name("..").is_err());
        assert!(safe_name("").is_err());
        assert_eq!(safe_name("a\\..\\b").unwrap(), "b");
        assert_eq!(safe_name("../x").unwrap(), "x");
    }

    #[test]
    fn base_names() {
        assert_eq!(instance_base("..."), "Instancia");
        assert_eq!(instance_base("Mi mundo!!"), "Mi mundo_");
        assert_eq!(instance_base(""), "Instancia");
    }

    #[test]
    fn create_list_update_rename_duplicate_delete() {
        let t = tempfile::tempdir().unwrap();
        let d = t.path();
        let a = create(d, "Survival", "1.21", "vanilla", &Value::Null).unwrap();
        assert_eq!(a["name"], "Survival");
        let b = create(d, "Survival", "1.21", "fabric", &json!("0.16")).unwrap();
        assert_eq!(b["name"], "Survival (2)");
        assert_eq!(b["loaderVersion"], "0.16");
        let l = list(d).unwrap();
        assert_eq!(l.as_array().unwrap().len(), 2);
        assert_eq!(l[0]["settings"]["ramMb"], 2048);
        let u = update_settings(d, "Survival", &json!({"ramMb": 999999, "jvmPreset": "zgc", "pinned": true})).unwrap();
        assert_eq!(u["settings"]["ramMb"], 16384);
        assert_eq!(u["settings"]["jvmPreset"], "zgc");
        assert_eq!(u["settings"]["pinned"], true);
        assert_eq!(rename(d, "Survival", "Nuevo").unwrap(), "Nuevo");
        assert_eq!(duplicate(d, "Nuevo").unwrap(), "Nuevo copia");
        std::fs::create_dir_all(d.join("Nuevo/logs")).unwrap();
        std::fs::write(d.join("Nuevo/logs/latest.log"), "hola").unwrap();
        assert_eq!(clean(d, "Nuevo").unwrap()["removed"], 1);
        assert!(size(d, "Nuevo").unwrap()["bytes"].as_u64().unwrap() > 0);
        std::fs::remove_dir_all(d.join("Nuevo copia")).unwrap();
        assert!(find(d, "no-existe").is_err());
    }
}
