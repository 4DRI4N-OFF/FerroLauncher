use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Command;

#[cfg(windows)]
fn quiet(c: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    c.creation_flags(0x0800_0000) // CREATE_NO_WINDOW
}
#[cfg(not(windows))]
fn quiet(c: &mut Command) -> &mut Command { c }

pub fn major_of(version: &str) -> Option<u32> {
    if version.starts_with("1.8") { return Some(8); }
    let digits: String = version.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

/// Extrae la versión de la salida de `java -version`.
pub fn parse_java_version(out: &str) -> Option<String> {
    if let Some(i) = out.find("version \"") {
        let rest = &out[i + 9..];
        if let Some(j) = rest.find('"') { return Some(rest[..j].to_string()); }
    }
    None
}

fn check_java(path: &str) -> Option<Value> {
    let out = quiet(&mut Command::new(path).arg("-version")).output().ok()?;
    let text = format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    let version = parse_java_version(&text)?;
    let major = major_of(&version);
    Some(json!({ "path": path, "version": version, "major": major }))
}

fn candidates() -> Vec<String> {
    let mut list = Vec::new();
    if let Ok(h) = std::env::var("JAVA_HOME") {
        list.push(PathBuf::from(h).join("bin").join("java.exe").to_string_lossy().to_string());
    }
    list.push("java".to_string());
    for base in ["C:\\Program Files\\Java", "C:\\Program Files\\Eclipse Adoptium", "C:\\Program Files\\Microsoft"] {
        if let Ok(rd) = std::fs::read_dir(base) {
            let mut found: Vec<String> = rd
                .flatten()
                .filter(|e| e.path().is_dir())
                .map(|e| e.path().join("bin").join("java.exe"))
                .filter(|p| p.exists())
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            found.sort();
            found.reverse();
            list.extend(found);
        }
    }
    list
}

/// Mejor Java del sistema (mayor versión), o None.
pub fn find_java() -> Option<Value> {
    let mut best: Option<Value> = None;
    for c in candidates() {
        if let Some(f) = check_java(&c) {
            let m = f["major"].as_u64().unwrap_or(0);
            if best.as_ref().map_or(true, |b| m > b["major"].as_u64().unwrap_or(0)) {
                best = Some(f);
            }
        }
    }
    best
}

pub fn suggest_ram() -> Value {
    let mut s = sysinfo::System::new();
    s.refresh_memory();
    let total_gb = s.total_memory() as f64 / 1073741824.0;
    let free_gb = s.available_memory() as f64 / 1073741824.0;
    let half = (total_gb * 0.5).min(free_gb * 0.7);
    let suggested = ((half * 2.0).round() * 512.0).max(2048.0).min(12288.0) as u64;
    json!({
        "totalGb": (total_gb * 10.0).round() / 10.0,
        "freeGb": (free_gb * 10.0).round() / 10.0,
        "suggestedMb": suggested
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn java_versions() {
        assert_eq!(parse_java_version("openjdk version \"21.0.2\" 2024"), Some("21.0.2".into()));
        assert_eq!(major_of("1.8.0_402"), Some(8));
        assert_eq!(major_of("17.0.9"), Some(17));
        assert_eq!(major_of("21"), Some(21));
    }
    #[test]
    fn ram_is_in_range() {
        let r = suggest_ram();
        let m = r["suggestedMb"].as_u64().unwrap();
        assert!((2048..=12288).contains(&m));
    }
}
