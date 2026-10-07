//! Red y descargas: reintentos, caché por sha1/tamaño, descarga a .part y verificación.
use serde_json::Value;
use sha1::{Digest, Sha1};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

fn agent() -> &'static ureq::Agent {
    static A: OnceLock<ureq::Agent> = OnceLock::new();
    A.get_or_init(|| {
        ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(30))
            // solo muere si se para de verdad (90 s sin un byte), nunca por ir lento
            .timeout_read(Duration::from_secs(90))
            .user_agent("FerroLauncher")
            .build()
    })
}

fn host(url: &str) -> String {
    url.split("//").nth(1).unwrap_or(url).split('/').next().unwrap_or("").to_string()
}

fn get_retry(url: &str, tries: u32) -> Result<ureq::Response, String> {
    let mut last = String::new();
    for i in 0..tries {
        match agent().get(url).call() {
            Ok(r) => return Ok(r),
            Err(ureq::Error::Status(code, _)) if (code >= 500 || code == 429) && i + 1 < tries => {
                last = format!("HTTP {code}");
                std::thread::sleep(Duration::from_secs((i + 1) as u64));
            }
            Err(ureq::Error::Status(code, _)) => return Err(format!("HTTP {code} en {url}")),
            Err(e) => {
                last = e.to_string();
                std::thread::sleep(Duration::from_secs((i + 1) as u64));
            }
        }
    }
    Err(format!("Sin conexión con {} tras {tries} intentos ({last}). Revisa internet/firewall.", host(url)))
}

pub fn fetch_json(url: &str) -> Result<Value, String> {
    get_retry(url, 3)?.into_json::<Value>().map_err(|e| format!("Respuesta no válida de {}: {e}", host(url)))
}

/// Texto plano de un GET (p. ej. maven-metadata.xml de NeoForge).
pub fn fetch_text(url: &str) -> Result<String, String> {
    get_retry(url, 3)?.into_string().map_err(|e| format!("Respuesta no válida de {}: {e}", host(url)))
}

/// Código HTTP de un GET sin reintentos (para comprobaciones tipo "¿existe este nombre?").
pub fn status_of(url: &str) -> Option<u16> {
    match agent().get(url).call() {
        Ok(r) => Some(r.status()),
        Err(ureq::Error::Status(c, _)) => Some(c),
        Err(_) => None,
    }
}

pub fn sha1_of(p: &Path) -> Option<String> {
    let mut f = fs::File::open(p).ok()?;
    let mut h = Sha1::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf).ok()?;
        if n == 0 { break; }
        h.update(&buf[..n]);
    }
    Some(format!("{:x}", h.finalize()))
}

pub fn download_file(
    url: &str,
    dest: &Path,
    expected_size: Option<u64>,
    expected_sha1: Option<&str>,
    progress: Option<&dyn Fn(f64)>,
) -> Result<PathBuf, String> {
    if let Some(dir) = dest.parent() { fs::create_dir_all(dir).map_err(|e| e.to_string())?; }
    // Caché: reutiliza si coincide sha1 (o tamaño si no hay sha1).
    if let Ok(md) = fs::metadata(dest) {
        let ok = if let Some(h) = expected_sha1 {
            sha1_of(dest).map_or(false, |x| x.eq_ignore_ascii_case(h))
        } else if let Some(sz) = expected_size {
            md.len() == sz
        } else if md.len() > 1_048_576 {
            // sin hash ni tamaño: confirma contra el servidor para no reutilizar un parcial
            match agent().head(url).call().ok().and_then(|r| r.header("content-length").and_then(|v| v.parse::<u64>().ok())) {
                Some(len) if len > 0 => len == md.len(),
                _ => true,
            }
        } else {
            md.len() > 0
        };
        if ok { return Ok(dest.to_path_buf()); }
        let _ = fs::remove_file(dest);
    }
    let resp = get_retry(url, 3)?;
    let total: u64 = resp.header("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    let part = dest.with_extension(format!("{}part", dest.extension().map(|e| format!("{}.", e.to_string_lossy())).unwrap_or_default()));
    let mut out = fs::File::create(&part).map_err(|e| format!("No se pudo crear {}: {e}", part.display()))?;
    let mut rd = resp.into_reader();
    let mut buf = vec![0u8; 64 * 1024];
    let mut done: u64 = 0;
    loop {
        let n = rd.read(&mut buf).map_err(|e| format!("Descarga interrumpida ({e}): {url}"))?;
        if n == 0 { break; }
        out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        done += n as u64;
        if let (Some(p), true) = (progress, total > 0) { p(done as f64 / total as f64); }
    }
    drop(out);
    let got = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if let Some(sz) = expected_size {
        if got != sz {
            let _ = fs::remove_file(&part);
            return Err(format!("Descarga incompleta ({got}/{sz} bytes): {url}"));
        }
    }
    if let Some(h) = expected_sha1 {
        if !sha1_of(&part).map_or(false, |x| x.eq_ignore_ascii_case(h)) {
            let _ = fs::remove_file(&part);
            return Err(format!("Descarga corrupta (sha1 no coincide): {url}"));
        }
    }
    let _ = fs::remove_file(dest);
    fs::rename(&part, dest).map_err(|e| e.to_string())?;
    Ok(dest.to_path_buf())
}

fn read_any(r: Result<ureq::Response, ureq::Error>) -> Result<(u16, Value), String> {
    match r {
        Ok(resp) => { let s = resp.status(); Ok((s, resp.into_json::<Value>().unwrap_or(Value::Null))) }
        Err(ureq::Error::Status(code, resp)) => Ok((code, resp.into_json::<Value>().unwrap_or(Value::Null))),
        Err(e) => Err(format!("Sin conexión: {e}")),
    }
}

/// POST formulario; devuelve (código, json) también cuando el servidor responde 4xx.
pub fn post_form(url: &str, params: &[(&str, &str)]) -> Result<(u16, Value), String> {
    read_any(agent().post(url).send_form(params))
}

pub fn post_json(url: &str, body: &Value) -> Result<(u16, Value), String> {
    read_any(agent().post(url).set("Accept", "application/json").send_json(body.clone()))
}

pub fn get_bearer(url: &str, token: &str) -> Result<(u16, Value), String> {
    read_any(agent().get(url).set("Authorization", &format!("Bearer {token}")).call())
}
