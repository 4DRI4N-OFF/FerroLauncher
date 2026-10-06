use serde_json::Value;
use std::sync::Mutex;

pub const MOJANG_MANIFEST: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
static CACHE: Mutex<Option<Vec<Value>>> = Mutex::new(None);

pub fn fetch_json(url: &str) -> Result<Value, String> {
    let resp = ureq::get(url)
        .set("User-Agent", "FerroLauncher")
        .call()
        .map_err(|e| format!("Error de red: {e}"))?;
    resp.into_json::<Value>().map_err(|e| format!("Respuesta no válida: {e}"))
}

pub fn list_versions() -> Result<Vec<Value>, String> {
    if let Some(c) = CACHE.lock().unwrap().as_ref() {
        return Ok(c.clone());
    }
    let m = fetch_json(MOJANG_MANIFEST)?;
    let v = m.get("versions").and_then(|x| x.as_array()).cloned().ok_or("Manifiesto sin versiones")?;
    *CACHE.lock().unwrap() = Some(v.clone());
    Ok(v)
}

pub fn filter_versions(all: &[Value], kind: &str) -> Vec<Value> {
    let is = |v: &Value, t: &str| v.get("type").and_then(|x| x.as_str()) == Some(t);
    match kind {
        "snapshot" => all.iter().filter(|v| is(v, "snapshot")).take(30).cloned().collect(),
        "all" => all.iter().take(60).cloned().collect(),
        _ => all.iter().filter(|v| is(v, "release")).take(30).cloned().collect(),
    }
}

pub fn versions(kind: &str) -> Result<Value, String> {
    Ok(Value::Array(filter_versions(&list_versions()?, kind)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn filters_like_electron() {
        let all: Vec<Value> = (0..100)
            .map(|i| json!({"id": format!("v{i}"), "type": if i % 2 == 0 { "release" } else { "snapshot" }}))
            .collect();
        assert_eq!(filter_versions(&all, "release").len(), 30);
        assert_eq!(filter_versions(&all, "snapshot").len(), 30);
        assert_eq!(filter_versions(&all, "all").len(), 60);
    }
}
