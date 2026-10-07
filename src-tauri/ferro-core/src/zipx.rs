//! Extracción de zips con rutas seguras (nada escapa del destino).
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Ruta relativa segura de una entrada, o None si intenta salir del destino.
pub fn safe_rel(name: &str, flatten: bool) -> Option<PathBuf> {
    let norm = name.replace('\\', "/");
    let parts: Vec<&str> = norm.split('/').filter(|p| !p.is_empty() && *p != ".").collect();
    if parts.is_empty() || norm.starts_with('/') { return None; }
    if parts.iter().any(|p| *p == ".." || p.contains(':')) { return None; }
    if flatten { return Some(PathBuf::from(parts[parts.len() - 1])); }
    let mut pb = PathBuf::new();
    for p in parts { pb.push(p); }
    Some(pb)
}

/// Extrae `zip_path` en `dest`. Devuelve (extraídos, descartados).
pub fn extract(zip_path: &Path, dest: &Path, flatten: bool, filter: &dyn Fn(&str) -> bool) -> Result<(usize, usize), String> {
    let f = fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut ar = zip::ZipArchive::new(f).map_err(|e| format!("Zip no válido: {e}"))?;
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let (mut ok, mut skipped) = (0, 0);
    for i in 0..ar.len() {
        let mut ent = ar.by_index(i).map_err(|e| e.to_string())?;
        let name = ent.name().to_string();
        if ent.is_dir() { continue; }
        if !filter(&name) { continue; }
        if ent.is_symlink() { skipped += 1; continue; }
        let rel = match safe_rel(&name, flatten) { Some(r) => r, None => { skipped += 1; continue; } };
        let target = dest.join(rel);
        if let Some(d) = target.parent() { fs::create_dir_all(d).map_err(|e| e.to_string())?; }
        let mut out = fs::File::create(&target).map_err(|e| format!("{}: {e}", target.display()))?;
        io::copy(&mut ent, &mut out).map_err(|e| e.to_string())?;
        ok += 1;
    }
    Ok((ok, skipped))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn rel_paths() {
        assert_eq!(safe_rel("a/b.txt", false), Some(PathBuf::from("a").join("b.txt")));
        assert_eq!(safe_rel("win64/lwjgl.dll", true), Some(PathBuf::from("lwjgl.dll")));
        assert_eq!(safe_rel("../x", false), None);
        assert_eq!(safe_rel("/etc/passwd", false), None);
        assert_eq!(safe_rel("C:\\x", false), None);
    }

    #[test]
    fn extracts_and_filters() {
        let t = tempfile::tempdir().unwrap();
        let zp = t.path().join("a.zip");
        {
            let f = fs::File::create(&zp).unwrap();
            let mut w = zip::ZipWriter::new(f);
            let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            w.start_file("win64/x.dll", o).unwrap(); w.write_all(b"dll").unwrap();
            w.start_file("META-INF/m", o).unwrap(); w.write_all(b"m").unwrap();
            w.start_file("../evil", o).unwrap(); w.write_all(b"e").unwrap();
            w.finish().unwrap();
        }
        let out = t.path().join("o");
        let (ok, skipped) = extract(&zp, &out, true, &|n| !n.starts_with("META-INF")).unwrap();
        assert_eq!((ok, skipped), (1, 1));
        assert_eq!(fs::read(out.join("x.dll")).unwrap(), b"dll");
        assert!(!t.path().join("evil").exists());
    }
}
