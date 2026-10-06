use ferro_core::Ctx;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, Manager};

struct State {
    ctx: Arc<Ctx>,
}

/// Todas las llamadas de la UI (`window.ferro.<nombre>`) entran por aquí.
#[tauri::command]
async fn ferro(state: tauri::State<'_, State>, name: String, data: Option<Value>) -> Result<Value, String> {
    let ctx = state.ctx.clone();
    tauri::async_runtime::spawn_blocking(move || ferro_core::call(&ctx, &name, data.unwrap_or(Value::Null)))
        .await
        .map_err(|e| e.to_string())?
}

/// Misma carpeta de datos que la versión Electron (%APPDATA%/ferro-launcher),
/// así las instancias existentes se ven sin migrar nada.
fn data_dir() -> PathBuf {
    if let Some(appdata) = std::env::var_os("APPDATA") {
        return PathBuf::from(appdata).join("ferro-launcher");
    }
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    home.join(".ferro-launcher")
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            let emit: ferro_core::Emit = Arc::new(move |event: &str, payload: Value| {
                let _ = handle.emit(event, payload);
            });
            let version = app.package_info().version.to_string();
            let ctx = Arc::new(Ctx::new(data_dir(), &version, emit));
            ctx.ensure_dirs();
            app.manage(State { ctx });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ferro])
        .run(tauri::generate_context!())
        .expect("error al arrancar FerroLauncher");
}
