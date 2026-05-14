//! Komodash Tauri backend entrypoint.
//!
//! Composition root only: wires module instances into the Tauri app state
//! and registers `#[tauri::command]` handlers. Business logic lives in the
//! sibling modules (`komorebic`, future: `live_state`, `managed_config`, …).

pub mod komorebic;

use std::sync::Arc;

use komorebic::{Komorebic, KomorebiState, WinKomorebic};
use tauri::Manager;

/// Things Tauri commands need at runtime. Held in `tauri::State`.
pub struct AppState {
    pub komorebic: Arc<dyn Komorebic>,
}

impl AppState {
    /// Production wiring: real `komorebic.exe` shell-out + real process scan.
    fn production() -> Self {
        Self {
            komorebic: Arc::new(WinKomorebic),
        }
    }
}

/// Detect whether Komorebi is installed and running. Backs the Dashboard
/// status pill (issue #2).
#[tauri::command]
fn detect_komorebi(state: tauri::State<'_, AppState>) -> KomorebiState {
    komorebic::detect(state.komorebic.as_ref())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single-instance enforcement per ADR-0008. The mutex name
        // `Local\komodash-singleton` is process-local to the current Windows
        // session. On a second launch the closure runs in the EXISTING
        // instance and brings its main window to the foreground; the new
        // process exits cleanly.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::production())
        .invoke_handler(tauri::generate_handler![detect_komorebi])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
