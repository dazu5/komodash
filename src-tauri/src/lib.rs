//! Komodash Tauri backend entrypoint.
//!
//! Composition root only: wires module instances into the Tauri app state
//! and registers `#[tauri::command]` handlers. Business logic lives in the
//! sibling modules (`komorebic`, `command_catalog`, `diagnostic`, future:
//! `live_state`, `managed_config`, …).

pub mod command_catalog;
pub mod diagnostic;
pub mod komorebic;

use std::path::PathBuf;
use std::sync::Arc;

use command_catalog::CommandCatalog;
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

/// Build the diagnostic-info markdown blob for the About-page Copy button
/// (issue #10, per ADR-0011 — local-only, no telemetry).
#[tauri::command]
fn get_diagnostic_info(state: tauri::State<'_, AppState>) -> String {
    diagnostic::build_diagnostic_info(state.komorebic.as_ref())
}

/// Return the **Command catalog** for the currently-installed Komorebi
/// (issue #8). Cached at `%LOCALAPPDATA%\komodash\command-catalog.json`
/// and re-parsed when the cached `komorebic_version` doesn't match
/// what's installed.
///
/// Errors stringified for the frontend.
#[tauri::command]
fn get_command_catalog(state: tauri::State<'_, AppState>) -> Result<CommandCatalog, String> {
    let version = state
        .komorebic
        .discover()
        .map(|info| info.version)
        .ok_or_else(|| "komorebic is not installed".to_string())?;
    let cache = command_catalog_cache_path().map_err(|e| e.to_string())?;
    command_catalog::load_or_build(&cache, state.komorebic.as_ref(), &version)
        .map_err(|e| e.to_string())
}

fn command_catalog_cache_path() -> anyhow::Result<PathBuf> {
    let dir = dirs::data_local_dir()
        .ok_or_else(|| anyhow::anyhow!("no LOCALAPPDATA directory"))?;
    Ok(dir.join("komodash").join("command-catalog.json"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Tracing has to be set up before anything else logs — and the guard
    // must live for the lifetime of `run` so the background flusher keeps
    // running. We bind it to `_log_guard` rather than discarding to `_` so
    // it isn't dropped immediately.
    let _log_guard = match diagnostic::init_tracing() {
        Ok(guard) => guard,
        Err(err) => {
            eprintln!("komodash: failed to initialise file logging: {err}");
            None
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::production())
        .invoke_handler(tauri::generate_handler![
            detect_komorebi,
            get_diagnostic_info,
            get_command_catalog
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
