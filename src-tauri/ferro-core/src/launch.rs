//! Lanzar el juego: Java, librerías, natives, assets, argumentos y proceso.
//! Soporta vanilla, Fabric y Quilt. Forge/NeoForge y la cuenta Microsoft llegan después.
use crate::{instances, mojang, net, sys, zipx, Ctx};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

type Shared = Arc<Mutex<Option<Child>>>;
struct Active { child: Shared, instance: String }
static ACTIVE: Mutex<Option<Active>> = Mutex::new(None);

fn st(v: &Value, k: &str) -> String { v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string() }

// ---------- reglas y argumentos ----------

pub fn arch_name() -> &'static str {
    match std::env::consts::ARCH { "x86_64" => "x64", "aarch64" => "arm64", "x86" => "x86", o => o }
}

pub fn rule_allows(rules: Option<&Value>) -> bool {
    let rules = match rules.and_then(|r| r.as_array()) { Some(r) if !r.is_empty() => r, _ => return true };
    let mut allowed = false;
    for r in rules {
        let mut os_ok = true;
        if let Some(os) = r.get("os") {
            if let Some(n) = os.get("name").and_then(|x| x.as_str()) { if n != "windows" { os_ok = false; } }
            if let Some(a) = os.get("arch").and_then(|x| x.as_str()) { if a != arch_name() { os_ok = false; } }
        }
        if r.get("features").is_some() { continue; }
        match r.get("action").and_then(|x| x.as_str()) {
            Some("allow") if os_ok => allowed = true,
            Some("disallow") if os_ok => allowed = false,
            _ => {}
        }
    }
    allowed
}

pub fn split_args(s: &str) -> Vec<String> {
    // parte por flags (--x): los valores con espacios (rutas) quedan intactos
    let mut out = Vec::new();
    let mut chunks: Vec<String> = Vec::new();
    let mut cur = String::new();
    let b: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < b.len() {
        if b[i].is_whitespace() {
            let mut j = i;
            while j < b.len() && b[j].is_whitespace() { j += 1; }
            if j + 1 < b.len() && b[j] == '-' && b[j + 1] == '-' { chunks.push(std::mem::take(&mut cur)); i = j; continue; }
            cur.extend(&b[i..j]); i = j; continue;
        }
        cur.push(b[i]); i += 1;
    }
    chunks.push(cur);
    for c in chunks {
        let t = c.trim();
        if t.is_empty() { continue; }
        match t.find(' ') { Some(sp) => { out.push(t[..sp].to_string()); out.push(t[sp + 1..].to_string()); } None => out.push(t.to_string()) }
    }
    out
}

pub fn flatten_args(list: Option<&Value>) -> Vec<String> {
    let mut out = Vec::new();
    for a in list.and_then(|l| l.as_array()).map(|v| v.as_slice()).unwrap_or(&[]) {
        if let Some(s) = a.as_str() { out.push(s.to_string()); continue; }
        if a.is_object() && rule_allows(a.get("rules")) {
            match a.get("value") {
                Some(Value::Array(v)) => out.extend(v.iter().filter_map(|x| x.as_str().map(String::from))),
                Some(Value::String(s)) => out.push(s.clone()),
                _ => {}
            }
        }
    }
    out
}

pub fn offline_uuid(name: &str) -> String {
    let mut h = md5::compute(format!("OfflinePlayer:{name}")).0;
    h[6] = (h[6] & 0x0f) | 0x30;
    h[8] = (h[8] & 0x3f) | 0x80;
    let x: String = h.iter().map(|b| format!("{b:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &x[0..8], &x[8..12], &x[12..16], &x[16..20], &x[20..])
}

pub fn perf_flags(preset: &str, java_major: u32) -> Vec<&'static str> {
    let rend = vec![
        "-XX:+UnlockExperimentalVMOptions", "-XX:+UseG1GC", "-XX:+ParallelRefProcEnabled",
        "-XX:MaxGCPauseMillis=200", "-XX:+DisableExplicitGC", "-XX:+AlwaysPreTouch",
        "-XX:G1NewSizePercent=30", "-XX:G1MaxNewSizePercent=40", "-XX:G1HeapRegionSize=8M",
        "-XX:G1ReservePercent=20", "-XX:G1HeapWastePercent=5", "-XX:G1MixedGCCountTarget=4",
        "-XX:InitiatingHeapOccupancyPercent=15", "-XX:G1MixedGCLiveThresholdPercent=90",
        "-XX:SurvivorRatio=32", "-XX:+PerfDisableSharedMem", "-XX:MaxTenuringThreshold=1",
    ];
    match preset {
        "rendimiento" => rend,
        "patata" => vec!["-XX:+UseSerialGC", "-XX:+TieredCompilation", "-XX:TieredStopAtLevel=1", "-XX:+DisableExplicitGC", "-XX:MaxGCPauseMillis=500"],
        "zgc" if java_major >= 17 => vec!["-XX:+UnlockExperimentalVMOptions", "-XX:+UseZGC", "-XX:+DisableExplicitGC"],
        "zgc" => rend,
        _ => vec![],
    }
}

pub struct PlanIn<'a> {
    pub details: &'a Value,
    pub client_jar: &'a Path,
    pub libs_cp: &'a [PathBuf],
    pub extra_cp: &'a [PathBuf],
    pub natives_dir: &'a Path,
    pub logging: Option<&'a Path>,
    pub instance_dir: &'a Path,
    pub assets_dir: &'a Path,
    pub libraries_dir: &'a Path,
    pub username: &'a str,
    pub ram_mb: u64,
    pub width: Option<u64>,
    pub height: Option<u64>,
    pub server: Option<(String, Option<String>)>,
    pub main_class: Option<String>,
    pub preset: &'a str,
    pub java_major: u32,
    pub launcher_version: &'a str,
}

pub struct Plan { pub jvm: Vec<String>, pub game: Vec<String>, pub main_class: String }

fn p(x: &Path) -> String { x.to_string_lossy().to_string() }

pub fn build_plan(i: &PlanIn) -> Plan {
    let d = i.details;
    let uuid = offline_uuid(i.username).replace('-', "");
    let cp: Vec<String> = std::iter::once(i.client_jar).chain(i.extra_cp.iter().map(|x| x.as_path())).chain(i.libs_cp.iter().map(|x| x.as_path())).map(p).collect();
    let classpath = cp.join(";");
    let asset_index = d.pointer("/assetIndex/id").and_then(|x| x.as_str()).unwrap_or("legacy").to_string();
    let mut map: HashMap<&str, String> = HashMap::new();
    map.insert("auth_player_name", i.username.to_string());
    map.insert("version_name", st(d, "id"));
    map.insert("game_directory", p(i.instance_dir));
    map.insert("game_directory_raw", p(i.instance_dir));
    map.insert("assets_root", p(i.assets_dir));
    map.insert("assets_root_raw", p(i.assets_dir));
    map.insert("assets_index_name", asset_index);
    map.insert("auth_uuid", uuid);
    map.insert("auth_access_token", "0".into());
    map.insert("clientid", "ferro".into());
    map.insert("auth_xuid", "0".into());
    map.insert("user_type", "legacy".into());
    map.insert("version_type", { let t = st(d, "type"); if t.is_empty() { "release".into() } else { t } });
    map.insert("natives_directory", p(i.natives_dir));
    map.insert("natives_directory_raw", p(i.natives_dir));
    map.insert("launcher_name", "FerroLauncher".into());
    map.insert("launcher_version", i.launcher_version.to_string());
    map.insert("classpath", classpath.clone());
    map.insert("library_directory", p(i.libraries_dir));
    map.insert("classpath_separator", ";".into());
    let sub = |s: &str| -> String {
        let mut out = String::new();
        let mut rest = s;
        while let Some(a) = rest.find("${") {
            out.push_str(&rest[..a]);
            match rest[a..].find('}') {
                Some(b) => {
                    let key = &rest[a + 2..a + b];
                    match map.get(key) { Some(v) if key.chars().all(|c| c.is_alphanumeric() || c == '_') => out.push_str(v), _ => out.push_str(&rest[a..a + b + 1]) }
                    rest = &rest[a + b + 1..];
                }
                None => { out.push_str(&rest[a..]); rest = ""; }
            }
        }
        out.push_str(rest);
        out
    };
    let mut jvm: Vec<String> = if d.pointer("/arguments/jvm").is_some() {
        flatten_args(d.pointer("/arguments/jvm")).iter().map(|s| sub(s)).collect()
    } else {
        vec![sub("-Djava.library.path=${natives_directory}"), "-cp".into(), classpath.clone()]
    };
    let xms = 128.max(512.min(i.ram_mb / 2));
    let mut pre = vec![format!("-Xmx{}M", i.ram_mb), format!("-Xms{xms}M"), format!("-Dminecraft.client.jar={}", p(i.client_jar))];
    if let Some(l) = i.logging { pre.push(format!("-Dlog4j.configurationFile={}", p(l))); }
    pre.extend(jvm.drain(..));
    jvm = pre;
    jvm.extend(perf_flags(i.preset, i.java_major).into_iter().map(String::from));
    let mut game: Vec<String> = if d.pointer("/arguments/game").is_some() {
        flatten_args(d.pointer("/arguments/game")).iter().map(|s| sub(s)).collect()
    } else if let Some(m) = d.get("minecraftArguments").and_then(|x| x.as_str()) {
        split_args(m).iter().map(|s| sub(s)).collect()
    } else {
        ["--username", "${auth_player_name}", "--version", "${version_name}", "--gameDir", "${game_directory}", "--assetsDir", "${assets_root}", "--assetIndex", "${assets_index_name}", "--uuid", "${auth_uuid}", "--accessToken", "${auth_access_token}"]
            .iter().map(|s| sub(s)).collect()
    };
    if let (Some(w), Some(h)) = (i.width, i.height) { game.extend(["--width".to_string(), w.to_string(), "--height".to_string(), h.to_string()]); }
    if let Some((host, port)) = &i.server {
        game.extend(["--server".to_string(), host.clone()]);
        if let Some(pt) = port { game.extend(["--port".to_string(), pt.clone()]); }
    }
    let main_class = i.main_class.clone().unwrap_or_else(|| st(d, "mainClass"));
    Plan { jvm, game, main_class }
}

// ---------- descargas en paralelo ----------

fn par_each<T: Sync>(items: &[T], workers: usize, f: &(dyn Fn(&T) -> Result<(), String> + Sync)) -> Result<(), String> {
    let next = AtomicUsize::new(0);
    let err: Mutex<Option<String>> = Mutex::new(None);
    std::thread::scope(|s| {
        for _ in 0..workers.max(1).min(items.len().max(1)) {
            s.spawn(|| loop {
                if err.lock().unwrap().is_some() { return; }
                let i = next.fetch_add(1, Ordering::SeqCst);
                if i >= items.len() { return; }
                if let Err(e) = f(&items[i]) { let mut g = err.lock().unwrap(); if g.is_none() { *g = Some(e); } return; }
            });
        }
    });
    match err.into_inner().unwrap() { Some(e) => Err(e), None => Ok(()) }
}

fn prog(ctx: &Ctx, phase: &str, done: f64, total: f64, extra: &str) {
    (ctx.emit)("ferro:progress", json!({ "phase": phase, "done": done, "total": total, "extra": if extra.is_empty() { Value::Null } else { json!(extra) } }));
}

// ---------- versión, jar, librerías, natives, assets ----------

pub fn version_details(ctx: &Ctx, id: &str) -> Result<Value, String> {
    let cache = ctx.base.join("versions").join(id).join(format!("{id}.json"));
    let fetched = (|| -> Result<Value, String> {
        let all = mojang::list_versions()?;
        let url = all.iter().find(|v| v["id"] == id).and_then(|v| v["url"].as_str()).ok_or(format!("Versión {id} no encontrada"))?.to_string();
        net::fetch_json(&url)
    })();
    match fetched {
        Ok(v) => { if let Some(d) = cache.parent() { let _ = fs::create_dir_all(d); } let _ = fs::write(&cache, v.to_string()); Ok(v) }
        Err(e) => match fs::read_to_string(&cache).ok().and_then(|t| serde_json::from_str(&t).ok()) {
            Some(v) => { ctx.log("[ferro] sin conexión: usando la versión guardada\n"); Ok(v) }
            None => Err(e),
        },
    }
}

fn client_jar(ctx: &Ctx, d: &Value) -> Result<PathBuf, String> {
    let c = d.pointer("/downloads/client").ok_or("La versión no trae client.jar")?;
    let id = st(d, "id");
    let dest = ctx.base.join("versions").join(&id).join(format!("{id}.jar"));
    net::download_file(&st(c, "url"), &dest, c["size"].as_u64(), c["sha1"].as_str(), None)
}

pub fn resolve_libraries(ctx: &Ctx, d: &Value) -> Result<Vec<PathBuf>, String> {
    let libs: Vec<&Value> = d["libraries"].as_array().map(|a| a.iter().filter(|l| rule_allows(l.get("rules"))).collect()).unwrap_or_default();
    let dir = ctx.base.join("libraries");
    let mut jobs: Vec<(String, PathBuf, Value)> = Vec::new();
    let mut cp = Vec::new();
    for l in &libs {
        let name = st(l, "name");
        if name.contains(":natives-") { continue; }
        if let Some(art) = l.pointer("/downloads/artifact") {
            let dest = dir.join(st(art, "path"));
            cp.push(dest.clone());
            jobs.push((name, dest, art.clone()));
        }
    }
    let done = AtomicUsize::new(0);
    let total = jobs.len();
    par_each(&jobs, 8, &|(name, dest, art)| {
        net::download_file(&st(art, "url"), dest, art["size"].as_u64(), art["sha1"].as_str(), None)?;
        let n = done.fetch_add(1, Ordering::SeqCst) + 1;
        prog(ctx, "libs", n as f64, total as f64, name);
        Ok(())
    })?;
    Ok(cp)
}

/// Qué jars de natives necesita esta versión (clasificadores antiguos o libs `:natives-windows`).
pub fn native_artifacts(d: &Value) -> Vec<(Value, Vec<String>)> {
    let mut out = Vec::new();
    let arch = arch_name();
    for l in d["libraries"].as_array().unwrap_or(&vec![]) {
        if !rule_allows(l.get("rules")) { continue; }
        let name = st(l, "name");
        let excl: Vec<String> = l.pointer("/extract/exclude").and_then(|e| e.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
        if let Some(cls) = l.pointer("/natives/windows").and_then(|x| x.as_str()) {
            let key = cls.replace("${arch}", if arch == "x86" { "32" } else { "64" });
            if let Some(a) = l.pointer(&format!("/downloads/classifiers/{key}")) { out.push((a.clone(), excl)); }
        } else if let Some(i) = name.find(":natives-windows") {
            let suffix = &name[i + 1..];
            let ok = match suffix { "natives-windows" => arch == "x64", "natives-windows-arm64" => arch == "arm64", "natives-windows-x86" => arch == "x86", _ => false };
            if ok { if let Some(a) = l.pointer("/downloads/artifact") { out.push((a.clone(), excl)); } }
        }
    }
    out
}

fn resolve_natives(ctx: &Ctx, d: &Value, dest: &Path) -> Result<(), String> {
    let _ = fs::remove_dir_all(dest);
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let arts = native_artifacts(d);
    let dir = ctx.base.join("libraries");
    let total = arts.len();
    for (n, (a, excl)) in arts.iter().enumerate() {
        let rel = st(a, "path");
        let jar = net::download_file(&st(a, "url"), &dir.join(&rel), a["size"].as_u64(), a["sha1"].as_str(), None)?;
        zipx::extract(&jar, dest, true, &|e| !e.starts_with("META-INF") && !excl.iter().any(|x| e.starts_with(x.as_str())))?;
        prog(ctx, "natives", (n + 1) as f64, total as f64, "");
    }
    Ok(())
}

fn download_assets(ctx: &Ctx, d: &Value) -> Result<(), String> {
    let ai = match d.get("assetIndex") { Some(a) => a, None => return Ok(()) };
    let adir = ctx.base.join("assets");
    fs::create_dir_all(adir.join("indexes")).map_err(|e| e.to_string())?;
    let ipath = adir.join("indexes").join(format!("{}.json", st(ai, "id")));
    let index: Value = match fs::read_to_string(&ipath).ok().and_then(|t| serde_json::from_str(&t).ok()) {
        Some(v) => v,
        None => { let v = net::fetch_json(&st(ai, "url"))?; fs::write(&ipath, v.to_string()).map_err(|e| e.to_string())?; v }
    };
    let objs: Vec<(String, u64)> = index["objects"].as_object().map(|o| o.values().filter_map(|v| Some((v["hash"].as_str()?.to_string(), v["size"].as_u64()?))).collect()).unwrap_or_default();
    let total = objs.len();
    let done = AtomicUsize::new(0);
    par_each(&objs, 16, &|(h, size)| {
        let sub = &h[..2];
        net::download_file(&format!("https://resources.download.minecraft.net/{sub}/{h}"), &adir.join("objects").join(sub).join(h), Some(*size), Some(h), None)?;
        let n = done.fetch_add(1, Ordering::SeqCst) + 1;
        if n % 25 == 0 || n == total { prog(ctx, "assets", n as f64, total as f64, ""); }
        Ok(())
    })
}

// ---------- Fabric / Quilt ----------

pub fn maven_path(name: &str) -> PathBuf {
    let mut it = name.split(':');
    let (g, a, v, c) = (it.next().unwrap_or(""), it.next().unwrap_or(""), it.next().unwrap_or(""), it.next());
    let file = match c { Some(c) => format!("{a}-{v}-{c}.jar"), None => format!("{a}-{v}.jar") };
    let mut pb = PathBuf::new();
    for s in g.split('.') { pb.push(s); }
    pb.push(a); pb.push(v); pb.push(file);
    pb
}

fn default_maven(quilt: bool, name: &str) -> &'static str {
    if !quilt || name.starts_with("net.fabricmc") || name.starts_with("org.ow2") { "https://maven.fabricmc.net/" } else { "https://maven.quiltmc.org/repository/release/" }
}

/// Devuelve (mainClass, classpath extra).
fn loader_libs(ctx: &Ctx, mc: &str, kind: &str, wanted: &str) -> Result<(String, Vec<PathBuf>), String> {
    let quilt = kind == "quilt";
    let api = if quilt { "https://meta.quiltmc.org/v3/versions" } else { "https://meta.fabricmc.net/v2/versions" };
    let label = if quilt { "Quilt" } else { "Fabric" };
    let ver = if !wanted.is_empty() { wanted.to_string() } else {
        let l = net::fetch_json(&format!("{api}/loader/{mc}"))?;
        l.get(0).and_then(|e| e.pointer("/loader/version")).and_then(|x| x.as_str()).ok_or(format!("{label} sin loader para {mc}"))?.to_string()
    };
    ctx.log(&format!("[ferro] {label} loader {ver}...\n"));
    let meta = net::fetch_json(&format!("{api}/loader/{mc}/{ver}"))?;
    let mut libs: Vec<(String, Option<String>)> = Vec::new();
    let keys: &[&str] = if quilt { &["hashed", "intermediary", "loader"] } else { &["intermediary", "loader"] };
    for k in keys {
        let m = &meta[*k];
        let coord = m.as_str().or_else(|| m["maven"].as_str());
        if let Some(c) = coord { libs.push((c.to_string(), None)); }
    }
    for sect in ["client", "common"] {
        for l in meta.pointer(&format!("/launcherMeta/libraries/{sect}")).and_then(|x| x.as_array()).unwrap_or(&vec![]) {
            libs.push((st(l, "name"), l["url"].as_str().map(String::from)));
        }
    }
    let main = meta.pointer("/launcherMeta/mainClass/client").or_else(|| meta.pointer("/launcherMeta/mainClass")).and_then(|x| x.as_str())
        .ok_or(format!("{label} meta sin mainClass client"))?.to_string();
    let dir = ctx.base.join("libraries");
    let total = libs.len();
    let done = AtomicUsize::new(0);
    par_each(&libs, 6, &|(name, url)| {
        let base = url.clone().unwrap_or_else(|| default_maven(quilt, name).to_string());
        let base = if base.ends_with('/') { base } else { format!("{base}/") };
        let rel = maven_path(name);
        let u = format!("{base}{}", rel.to_string_lossy().replace('\\', "/"));
        net::download_file(&u, &dir.join(&rel), None, None, None)?;
        let n = done.fetch_add(1, Ordering::SeqCst) + 1;
        prog(ctx, "loader", n as f64, total as f64, name);
        Ok(())
    })?;
    let cp = libs.iter().map(|(n, _)| dir.join(maven_path(n))).collect();
    ctx.log(&format!("[ferro] {label}: {total} libs, main {main}\n"));
    Ok((main, cp))
}

// ---------- Java ----------

fn find_recursive(dir: &Path, target: &str) -> Option<PathBuf> {
    for e in fs::read_dir(dir).ok()?.flatten() {
        let p = e.path();
        if p.is_dir() { if let Some(f) = find_recursive(&p, target) { return Some(f); } }
        else if e.file_name().to_string_lossy().eq_ignore_ascii_case(target) { return Some(p); }
    }
    None
}

fn compatible(sys_major: u64, required: u64) -> bool {
    if required <= 8 { sys_major == 8 } else { sys_major >= required }
}

pub fn ensure_java(ctx: &Ctx, required: Option<u64>) -> Result<Value, String> {
    let runtimes = ctx.base.join("runtimes");
    if let Some(req) = required {
        if let Ok(rd) = fs::read_dir(&runtimes) {
            let mut dirs: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_dir() && p.file_name().map_or(false, |n| n.to_string_lossy().starts_with("java-"))).collect();
            dirs.sort(); dirs.reverse();
            for d in dirs {
                if let Some(j) = find_recursive(&d, "java.exe") {
                    if let Some(mut info) = sys::check_java(&j.to_string_lossy()) {
                        if compatible(info["major"].as_u64().unwrap_or(0), req) { info["managed"] = json!(true); return Ok(info); }
                    }
                }
            }
        }
        for c in sys::candidates() {
            if let Some(info) = sys::check_java(&c) { if compatible(info["major"].as_u64().unwrap_or(0), req) { return Ok(info); } }
        }
    } else if let Some(any) = sys::find_java() { return Ok(any); }
    let req = required.ok_or("Java no encontrado. Instala JDK 21+ y reintenta.")?;
    fs::create_dir_all(&runtimes).map_err(|e| e.to_string())?;
    let zip = runtimes.join(format!(".temurin-{req}.zip"));
    ctx.log(&format!("[ferro] descargando Java {req} (Temurin)...\n"));
    let url = format!("https://api.adoptium.net/v3/binary/latest/{req}/ga/windows/x64/jdk/hotspot/normal/eclipse");
    let mut ok = false;
    for attempt in 0..3 {
        let _ = fs::remove_file(&zip);
        let r = net::download_file(&url, &zip, None, None, Some(&|f| prog(ctx, "java", f * 100.0, 100.0, "")));
        if r.is_ok() && fs::File::open(&zip).ok().and_then(|f| zip::ZipArchive::new(f).ok()).is_some() { ok = true; break; }
        let _ = fs::remove_file(&zip);
        if attempt == 2 { if let Err(e) = r { return Err(e); } }
        ctx.log(&format!("[ferro] descarga de Java incompleta, reintentando ({}/3)...\n", attempt + 1));
    }
    if !ok { return Err(format!("Java {req}: descarga corrupta tras 3 intentos. Revisa tu conexión y pulsa JUGAR de nuevo.")); }
    let dest = runtimes.join(format!("java-{req}"));
    zipx::extract(&zip, &dest, false, &|_| true)?;
    let _ = fs::remove_file(&zip);
    let exe = find_recursive(&dest, "java.exe").ok_or(format!("Temurin {req}: no se encontró java.exe tras extraer"))?;
    let mut info = sys::check_java(&exe.to_string_lossy()).ok_or(format!("Temurin {req}: java.exe no responde"))?;
    info["managed"] = json!(true);
    Ok(info)
}

// ---------- lanzar / parar ----------

fn premium_check(name: &str) -> Option<bool> {
    // Some(true)=premium, Some(false)=libre, None=no se pudo comprobar
    let url = format!("https://api.mojang.com/users/profiles/minecraft/{name}");
    match net::status_of(&url) { Some(200) => Some(true), Some(204) | Some(404) | Some(400) => Some(false), _ => None }
}

pub fn status() -> Value {
    let g = ACTIVE.lock().unwrap();
    if let Some(a) = g.as_ref() {
        let mut c = a.child.lock().unwrap();
        if let Some(ch) = c.as_mut() { if matches!(ch.try_wait(), Ok(None)) { return json!({ "running": true, "instance": a.instance }); } }
    }
    json!({ "running": false, "instance": Value::Null })
}

pub fn stop(ctx: &Ctx) -> Value {
    let g = ACTIVE.lock().unwrap();
    if let Some(a) = g.as_ref() {
        let mut c = a.child.lock().unwrap();
        if let Some(ch) = c.as_mut() {
            if matches!(ch.try_wait(), Ok(None)) {
                ctx.log(&format!("[ferro] deteniendo {}...\n", a.instance));
                let _ = ch.kill();
                return json!(true);
            }
        }
    }
    json!(false)
}

pub fn launch(ctx: &Ctx, data: &Value) -> Result<Value, String> {
    if status()["running"] == true { return Err("Ya hay una instancia en ejecución. Deténla primero.".into()); }
    let name = st(data, "instanceName");
    let idir = instances::find(&ctx.instances_dir(), &name)?;
    let cfg = instances::read_cfg(&idir.join("ferro.json")).map_err(|_| "Instancia no encontrada".to_string())?;
    let version_id = st(&cfg, "versionId");
    let typ = { let t = st(&cfg, "type"); if t.is_empty() { "vanilla".to_string() } else { t } };
    if typ == "forge" || typ == "neoforge" { return Err(format!("{typ} todavía no está disponible en la versión Tauri (en construcción). Vanilla, Fabric y Quilt sí.")); }
    let settings = cfg.get("settings").cloned().unwrap_or(json!({}));

    ctx.log(&format!("[ferro] resolviendo {version_id}...\n"));
    let details = version_details(ctx, &version_id)?;
    let req = details.pointer("/javaVersion/majorVersion").and_then(|x| x.as_u64());
    if let Some(r) = req { ctx.log(&format!("[ferro] esta versión pide Java {r}\n")); }

    let java = if st(&settings, "javaMode") == "custom" && !st(&settings, "javaPath").is_empty() {
        sys::check_java(&st(&settings, "javaPath")).ok_or(format!("Java personalizado no válido: {}", st(&settings, "javaPath")))?
    } else { ensure_java(ctx, req)? };
    let java_bin = st(&java, "path");
    let java_major = java["major"].as_u64().unwrap_or(0) as u32;
    ctx.log(&format!("[ferro] Java {} (major {}) en {}{}\n", st(&java, "version"), java_major, java_bin, if java["managed"] == true { " [gestionado]" } else { "" }));

    let (main_override, extra_cp) = if typ == "fabric" || typ == "quilt" {
        let (m, c) = loader_libs(ctx, &version_id, &typ, cfg["loaderVersion"].as_str().unwrap_or(""))?;
        (Some(m), c)
    } else { (None, vec![]) };

    let jar = client_jar(ctx, &details)?;
    prog(ctx, "client", 1.0, 1.0, "");
    let cp = resolve_libraries(ctx, &details)?;
    let natives = ctx.base.join("versions").join(&version_id).join("natives-windows");
    resolve_natives(ctx, &details, &natives)?;
    download_assets(ctx, &details)?;
    let logging = details.pointer("/logging/client/file").and_then(|c| {
        let dest = ctx.base.join("versions").join(&version_id).join(c["id"].as_str()?);
        net::download_file(c["url"].as_str()?, &dest, c["size"].as_u64(), c["sha1"].as_str(), None).ok()
    });
    ctx.log("[ferro] lanzando...\n");

    let username = { let u = st(data, "username"); let u = u.trim().to_string(); if u.is_empty() { "Ferro".to_string() } else { u } };
    ctx.log("[ferro] sin cuenta Microsoft en esta versión: modo offline\n");
    match premium_check(&username) {
        Some(true) => {
            ctx.log(&format!("[ferro] !! NOMBRE PREMIUM DETECTADO: {username} !!\n"));
            ctx.log("[ferro] Acceso DENEGADO en offline. Usa otro nombre (el inicio de sesión Microsoft aún no está en la versión Tauri).\n");
            return Err(format!("\"{username}\" es un nombre premium. En offline usa otro nombre."));
        }
        None => ctx.log("[ferro] aviso: no se pudo verificar si el nombre es premium\n"),
        Some(false) => {}
    }

    let ram = data["ramMb"].as_u64().or(settings["ramMb"].as_u64()).unwrap_or(2048);
    let width = data["width"].as_u64().or(settings["width"].as_u64());
    let height = data["height"].as_u64().or(settings["height"].as_u64());
    let server = data["serverHost"].as_str().filter(|s| !s.is_empty()).map(|h| (h.to_string(), data["serverPort"].as_u64().map(|p| p.to_string()).or(data["serverPort"].as_str().map(String::from))));
    let assets_dir = ctx.base.join("assets");
    let libraries_dir = ctx.base.join("libraries");
    let preset = st(&settings, "jvmPreset");
    let plan = build_plan(&PlanIn {
        details: &details, client_jar: &jar, libs_cp: &cp, extra_cp: &extra_cp, natives_dir: &natives, logging: logging.as_deref(),
        instance_dir: &idir, assets_dir: &assets_dir, libraries_dir: &libraries_dir, username: &username, ram_mb: ram, width, height, server,
        main_class: main_override, preset: &preset, java_major, launcher_version: &ctx.version,
    });
    let mut args = plan.jvm.clone();
    args.push(plan.main_class.clone());
    args.extend(plan.game.clone());
    ctx.log(&format!("[ferro] mainClass: {}\n", plan.main_class));

    let mut cmd = Command::new(&java_bin);
    cmd.args(&args).current_dir(&idir).stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    sys::quiet(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| format!("error al arrancar java: {e}"))?;
    let out = child.stdout.take();
    let err = child.stderr.take();
    let shared: Shared = Arc::new(Mutex::new(Some(child)));
    *ACTIVE.lock().unwrap() = Some(Active { child: shared.clone(), instance: name.clone() });
    let t0 = Instant::now();
    let emit = ctx.emit.clone();
    let pump = |r: Box<dyn std::io::Read + Send>| {
        let emit = emit.clone();
        std::thread::spawn(move || {
            let mut rd = BufReader::new(r);
            let mut line = Vec::new();
            while let Ok(n) = rd.read_until(b'\n', &mut line) {
                if n == 0 { break; }
                emit("ferro:log", json!(String::from_utf8_lossy(&line)));
                line.clear();
            }
        });
    };
    if let Some(o) = out { pump(Box::new(o)); }
    if let Some(e) = err { pump(Box::new(e)); }
    let emit2 = ctx.emit.clone();
    let iname = name.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(400));
        let mut g = shared.lock().unwrap();
        let code = match g.as_mut().map(|c| c.try_wait()) { Some(Ok(Some(s))) => Some(s.code()), Some(Ok(None)) => None, _ => Some(None) };
        if let Some(code) = code {
            *g = None;
            drop(g);
            emit2("ferro:log", json!(format!("\n[ferro] proceso terminado con código {}\n", code.map_or("?".to_string(), |c| c.to_string()))));
            if code.map_or(false, |c| c != 0) { emit2("ferro:log", json!(format!("[ferro] crash detectado en {iname} (código {})\n", code.unwrap()))); }
            let secs = t0.elapsed().as_secs();
            if secs >= 60 { emit2("ferro:log", json!(format!("[ferro] sesión de {} min\n", secs / 60))); }
            return;
        }
    });
    Ok(json!(true))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules() {
        assert!(rule_allows(None));
        assert!(rule_allows(Some(&json!([{"action":"allow"}]))));
        assert!(!rule_allows(Some(&json!([{"action":"allow","os":{"name":"osx"}}]))));
        assert!(rule_allows(Some(&json!([{"action":"allow"},{"action":"disallow","os":{"name":"osx"}}]))));
        assert!(!rule_allows(Some(&json!([{"action":"allow"},{"action":"disallow","os":{"name":"windows"}}]))));
        assert!(!rule_allows(Some(&json!([{"action":"allow","os":{"name":"windows","arch":"x86"}}]))));
    }

    #[test]
    fn offline_uuid_known_value() {
        // UUID offline de "Notch" conocido (md5 de OfflinePlayer:Notch, versión 3)
        assert_eq!(offline_uuid("Notch"), "b50ad385-829d-3141-a216-7e7d7539ba7f");
    }

    #[test]
    fn splits_flags_keeping_paths_with_spaces() {
        assert_eq!(split_args("--username ${n} --gameDir C:\\Mi Carpeta\\x --demo"), vec!["--username", "${n}", "--gameDir", "C:\\Mi Carpeta\\x", "--demo"]);
    }

    #[test]
    fn maven() {
        assert_eq!(maven_path("net.fabricmc:fabric-loader:0.15.0"), PathBuf::from("net/fabricmc/fabric-loader/0.15.0/fabric-loader-0.15.0.jar"));
        assert_eq!(maven_path("a.b:c:1:nat"), PathBuf::from("a/b/c/1/c-1-nat.jar"));
    }

    #[test]
    fn natives_selection() {
        let d = json!({"libraries":[
            {"name":"org.lwjgl:lwjgl:3.3.1","downloads":{"artifact":{"path":"a"}}},
            {"name":"org.lwjgl:lwjgl:3.3.1:natives-windows","downloads":{"artifact":{"path":"w"}},"rules":[{"action":"allow","os":{"name":"windows"}}]},
            {"name":"org.lwjgl:lwjgl:3.3.1:natives-windows-x86","downloads":{"artifact":{"path":"x86"}}},
            {"name":"org.lwjgl:lwjgl:3.3.1:natives-linux","downloads":{"artifact":{"path":"l"}}},
            {"name":"old:nat:1","natives":{"windows":"natives-windows-${arch}"},"extract":{"exclude":["META-INF/"]},"downloads":{"classifiers":{"natives-windows-64":{"path":"old64"}}}}
        ]});
        let n = native_artifacts(&d);
        let paths: Vec<String> = n.iter().map(|(a, _)| a["path"].as_str().unwrap().to_string()).collect();
        if arch_name() == "x64" { assert_eq!(paths, vec!["w", "old64"]); }
        assert_eq!(n.last().unwrap().1, vec!["META-INF/".to_string()]);
    }

    #[test]
    fn plan_substitutes_and_orders() {
        let d = json!({"id":"1.20.1","type":"release","mainClass":"net.minecraft.client.main.Main","assetIndex":{"id":"8"},
          "arguments":{"jvm":["-Djava.library.path=${natives_directory}",{"rules":[{"action":"allow","os":{"name":"osx"}}],"value":"-XstartOnFirstThread"},"-cp","${classpath}"],
                       "game":["--username","${auth_player_name}","--gameDir","${game_directory}",{"rules":[{"action":"allow","features":{"is_demo_user":true}}],"value":"--demo"}]}});
        let jar = PathBuf::from("c.jar"); let libs = vec![PathBuf::from("l1.jar")]; let nat = PathBuf::from("nat"); let id = PathBuf::from("inst"); let ad = PathBuf::from("assets"); let ld = PathBuf::from("libs");
        let plan = build_plan(&PlanIn { details: &d, client_jar: &jar, libs_cp: &libs, extra_cp: &[], natives_dir: &nat, logging: None, instance_dir: &id, assets_dir: &ad, libraries_dir: &ld,
            username: "Ferro", ram_mb: 2048, width: Some(854), height: Some(480), server: Some(("h".into(), Some("25565".into()))), main_class: None, preset: "patata", java_major: 17, launcher_version: "1" });
        assert_eq!(&plan.jvm[..3], &["-Xmx2048M", "-Xms512M", "-Dminecraft.client.jar=c.jar"]);
        assert!(plan.jvm.contains(&"-Djava.library.path=nat".to_string()));
        assert!(!plan.jvm.contains(&"-XstartOnFirstThread".to_string()));
        assert!(plan.jvm.contains(&"c.jar;l1.jar".to_string()));
        assert!(plan.jvm.contains(&"-XX:+UseSerialGC".to_string()));
        assert_eq!(plan.game, vec!["--username","Ferro","--gameDir","inst","--width","854","--height","480","--server","h","--port","25565"]);
        assert_eq!(plan.main_class, "net.minecraft.client.main.Main");
    }
}
