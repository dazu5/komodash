//! Komodash Tauri backend entrypoint.
//!
//! Composition root only: wires module instances into the Tauri app state
//! and registers `#[tauri::command]` handlers. Business logic lives in the
//! sibling modules (`komorebic`, future: `live_state`, `managed_config`, …).

pub mod komorebic;

use std::sync::Arc;

use komorebic::{Komorebic, KomorebiState, WinKomorebic};

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
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::production())
        .invoke_handler(tauri::generate_handler![detect_komorebi])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
