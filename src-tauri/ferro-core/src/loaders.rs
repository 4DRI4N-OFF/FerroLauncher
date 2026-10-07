//! Lista de versiones de loaders por versión de Minecraft.
//! Replica `ferro:loaders` de Electron: fabric/quilt vía meta oficial,
//! forge vía promotions_slim y neoforge vía maven-metadata.
use crate::net;
use serde_json::{json, Value};

fn fabric_parse(data: &Value) -> Vec<Value> {
    data.as_array()
        .map(|v| v.as_slice())
        .unwrap_or(&[])
        .iter()
        .filter_map(|e| {
            let loader = e.get("loader")?;
            Some(json!({
                "loader": loader.get("version").and_then(|x| x.as_str()).unwrap_or(""),
                "stable": loader.get("stable").and_then(|x| x.as_bool()).unwrap_or(false),
            }))
        })
        .filter(|e| !e["loader"].as_str().unwrap_or("").is_empty())
        .collect()
}

fn quilt_parse(data: &Value) -> Vec<Value> {
    // meta.quiltmc.org/v3 puede devolver array directo o {versions:[...]}
    let arr: &[Value] = if let Some(a) = data.as_array() {
        a.as_slice()
    } else {
        data.get("versions")
            .and_then(|v| v.as_array())
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    };
    arr.iter()
        .filter_map(|e| {
            let loader = e.get("loader").and_then(|x| x.as_str()).or_else(|| {
                e.get("loader").and_then(|l| l.get("version")).and_then(|x| x.as_str())
            })?;
            if loader.is_empty() {
                return None;
            }
            Some(json!({ "loader": loader, "stable": true }))
        })
        .collect()
}

fn forge_parse(data: &Value, mc: &str) -> Vec<Value> {
    let promos = data.get("promos");
    let mut out = vec![];
    for (key, tag) in [(format!("{mc}-recommended"), "recomendado"), (format!("{mc}-latest"), "latest")] {
        if let Some(v) = promos.and_then(|p| p.get(&key)).and_then(|x| x.as_str()) {
            if !out.iter().any(|e: &Value| e["loader"] == v) {
                out.push(json!({ "loader": v, "tag": tag }));
            }
        }
    }
    out
}

fn neo_parse(xml: &str, mc: &str) -> Vec<Value> {
    // 1.21 -> prefijo "21.", 1.21.1 -> "21.1."
    let mut it = mc.split('.');
    let _ = it.next();
    let prefix: String = it.collect::<Vec<_>>().join(".") + ".";
    let mut vers: Vec<String> = xml
        .match_indices("<version>")
        .filter_map(|(i, _)| {
            let rest = &xml[i + 9..];
            rest.find("</version>").map(|j| rest[..j].to_string())
        })
        .filter(|v| v.starts_with(&prefix))
        .collect();
    vers.dedup();
    vers.iter().rev().take(10).map(|v| json!({ "loader": v, "stable": true })).collect()
}

/// Lista loaders para `mcVersion` + `type` (fabric/quilt/forge/neoforge).
pub fn list(mc: &str, kind: &str) -> Result<Value, String> {
    if mc.is_empty() {
        return Err("Falta la versión de Minecraft".into());
    }
    match kind {
        "forge" => {
            let data = net::fetch_json("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json")?;
            Ok(Value::Array(forge_parse(&data, mc)))
        }
        "neoforge" => {
            let xml = net::fetch_text("https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml")?;
            Ok(Value::Array(neo_parse(&xml, mc)))
        }
        "quilt" => {
            let data = net::fetch_json(&format!("https://meta.quiltmc.org/v3/versions/loader/{mc}"))?;
            Ok(Value::Array(quilt_parse(&data)))
        }
        _ => {
            let data = net::fetch_json(&format!("https://meta.fabricmc.net/v2/versions/loader/{mc}"))?;
            Ok(Value::Array(fabric_parse(&data)))
        }
    }
}

/// Compara versiones por tramos numéricos (sufijos ignorados). Igual que Electron.
pub fn cmp_ver(a: &str, b: &str) -> i32 {
    fn parts(s: &str) -> Vec<u64> {
        s.split(|c: char| !c.is_ascii_digit()).filter(|p| !p.is_empty()).map(|p| p.parse().unwrap_or(0)).collect()
    }
    let (pa, pb) = (parts(a), parts(b));
    for i in 0..pa.len().max(pb.len()) {
        let (x, y) = (*pa.get(i).unwrap_or(&0), *pb.get(i).unwrap_or(&0));
        if x != y {
            return if x < y { -1 } else { 1 };
        }
    }
    0
}

fn latest_for(mc: &str, kind: &str) -> Result<Option<String>, String> {
    let arr = list(mc, kind)?;
    Ok(arr.as_array().and_then(|a| a.first()).and_then(|e| e.get("loader")).and_then(|x| x.as_str()).map(String::from))
}

/// {current, latest, outdated} para una instancia. Igual que `ferro:loaderCheck`.
pub fn check(inst_dir: &std::path::Path, name: &str) -> Result<Value, String> {
    let dir = crate::instances::find(inst_dir, name)?;
    let cfg = crate::instances::read_cfg(&dir.join("ferro.json"))?;
    let typ = cfg.get("type").and_then(|x| x.as_str()).unwrap_or("vanilla");
    if typ == "vanilla" {
        return Ok(json!({ "current": null, "latest": null, "outdated": false }));
    }
    let mc = cfg.get("versionId").and_then(|x| x.as_str()).unwrap_or("");
    let latest = latest_for(mc, typ)?;
    let cur = cfg.get("loaderVersion").and_then(|x| x.as_str()).map(String::from);
    let outdated = match (&latest, &cur) {
        (Some(l), Some(c)) => cmp_ver(l, c) > 0,
        (Some(_), None) => true,
        _ => false,
    };
    Ok(json!({ "current": cur, "latest": latest, "outdated": outdated }))
}

/// Actualiza `loaderVersion` al último. Igual que `ferro:loaderUpdate`.
pub fn update(inst_dir: &std::path::Path, name: &str) -> Result<Value, String> {
    let dir = crate::instances::find(inst_dir, name)?;
    let cfg = crate::instances::read_cfg(&dir.join("ferro.json"))?;
    let typ = cfg.get("type").and_then(|x| x.as_str()).unwrap_or("vanilla");
    if typ == "vanilla" {
        return Err("Es vanilla: no tiene loader".into());
    }
    let mc = cfg.get("versionId").and_then(|x| x.as_str()).unwrap_or("");
    let latest = latest_for(mc, typ)?.ok_or("Sin versiones de loader para este MC")?;
    let cur = cfg.get("loaderVersion").and_then(|x| x.as_str()).map(String::from);
    if let Some(c) = &cur {
        if cmp_ver(&latest, c) <= 0 {
            return Ok(json!({ "updated": false, "current": cur, "latest": latest }));
        }
    }
    crate::instances::update_settings(inst_dir, name, &json!({ "loaderVersion": latest }))?;
    Ok(json!({ "updated": true, "previous": cur, "latest": latest }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fabric_parser() {
        let d: Value = serde_json::from_str(
            r#"[{"loader":{"version":"0.16.9","stable":true},"intermediary":{"version":"1.20.1"}}]"#,
        )
        .unwrap();
        let out = fabric_parse(&d);
        assert_eq!(out[0]["loader"], "0.16.9");
        assert_eq!(out[0]["stable"], true);
    }

    #[test]
    fn quilt_parser_acepta_array_y_objeto() {
        let a: Value = serde_json::from_str(r#"[{"loader":"0.25.0"}]"#).unwrap();
        assert_eq!(quilt_parse(&a)[0]["loader"], "0.25.0");
        let o: Value = serde_json::from_str(r#"{"versions":[{"loader":{"version":"0.25.1"}}]}"#).unwrap();
        assert_eq!(quilt_parse(&o)[0]["loader"], "0.25.1");
    }

    #[test]
    fn forge_parser_recomendado_y_latest() {
        let d: Value = serde_json::from_str(
            r#"{"promos":{"1.20.1-recommended":"47.2.0","1.20.1-latest":"47.2.20"}}"#,
        )
        .unwrap();
        let out = forge_parse(&d, "1.20.1");
        assert_eq!(out.len(), 2);
        assert_eq!(out[0]["tag"], "recomendado");
    }

    #[test]
    fn neo_parser_filtra_por_prefijo() {
        let xml = "<metadata><versioning><versions><version>20.4.0</version><version>21.1.0</version><version>21.1.5</version></versions></versioning></metadata>";
        let out = neo_parse(xml, "1.21.1");
        assert_eq!(out.len(), 2);
        assert_eq!(out[0]["loader"], "21.1.5");
    }

    #[test]
    fn cmp_ver_numerico() {
        assert_eq!(cmp_ver("47.4.26", "47.4.10"), 1);
        assert_eq!(cmp_ver("0.16.9", "0.16.9"), 0);
        assert_eq!(cmp_ver("0.15.0", "0.16.9"), -1);
    }

    #[test]
    fn check_vanilla_sin_red() {
        let d = tempfile::tempdir().unwrap();
        crate::instances::create(d.path(), "V", "1.20.1", "vanilla", &Value::Null).unwrap();
        let r = check(d.path(), "V").unwrap();
        assert_eq!(r["outdated"], false);
    }
}
