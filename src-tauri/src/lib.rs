//! Komodash Tauri backend entrypoint.
//!
//! Composition root only: wires module instances into the Tauri app state
//! and registers `#[tauri::command]` handlers. Business logic lives in the
//! sibling modules (`komorebic`, `managed_config`, `backup_store`, future:
//! `live_state`, `whkdrc_parser`, …).

pub mod backup_store;
pub mod komorebic;
pub mod managed_config;

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use komorebic::{Komorebic, KomorebiState, WinKomorebic};
use managed_config::ConfigKind;

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

// ---- Issue #2 --------------------------------------------------------------

/// Detect whether Komorebi is installed and running. Backs the Dashboard
/// status pill (issue #2).
#[tauri::command]
fn detect_komorebi(state: tauri::State<'_, AppState>) -> KomorebiState {
    komorebic::detect(state.komorebic.as_ref())
}

// ---- Issue #7 --------------------------------------------------------------

/// Read the live content of a Managed config from disk. Empty string when
/// the file does not yet exist (caller renders appropriately).
#[tauri::command]
fn get_config(kind: ConfigKind, state: tauri::State<'_, AppState>) -> Result<String, String> {
    let path = config_path_for(&state, kind).map_err(stringify_err)?;
    managed_config::read(&path).map_err(stringify_err)
}

/// Write content to a Managed config. Atomic; previous content is backed
/// up first per [ADR-0003](../../docs/adr/0003-sole-writer-non-technical-audience.md).
#[tauri::command]
fn write_config(
    kind: ConfigKind,
    content: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let path = config_path_for(&state, kind).map_err(stringify_err)?;
    let backups = backups_root().map_err(stringify_err)?;
    managed_config::write(&path, &content, kind, &backups).map_err(stringify_err)
}

/// Backups for `kind`, newest first.
#[tauri::command]
fn list_backups(kind: ConfigKind) -> Result<Vec<backup_store::BackupRecord>, String> {
    let backups = backups_root().map_err(stringify_err)?;
    managed_config::list_backups(&backups, kind).map_err(stringify_err)
}

/// Restore a backup into the live Managed config. The pre-restore content
/// is itself backed up before overwrite so the user can undo a restore.
#[tauri::command]
fn restore_backup(
    kind: ConfigKind,
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let path = config_path_for(&state, kind).map_err(stringify_err)?;
    let backups = backups_root().map_err(stringify_err)?;
    managed_config::restore_backup(&backups, kind, &id, &path).map_err(stringify_err)
}

// ---- helpers ---------------------------------------------------------------

fn config_path_for(state: &tauri::State<'_, AppState>, kind: ConfigKind) -> Result<PathBuf> {
    match kind {
        ConfigKind::Static => state.komorebic.static_config_path(),
        ConfigKind::Bar => state.komorebic.bar_config_path(),
        ConfigKind::Whkdrc => state.komorebic.whkdrc_path(),
    }
}

/// Root of Komodash's backup store: `%LOCALAPPDATA%\komodash\backups\`.
fn backups_root() -> Result<PathBuf> {
    let local = dirs::data_local_dir()
        .ok_or_else(|| anyhow::anyhow!("no LOCALAPPDATA directory"))?;
    Ok(local.join("komodash").join("backups"))
}

/// `Result::map_err` companion: render any error chain as a string the
/// frontend can show. Bubbles via Tauri serialisation.
fn stringify_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::production())
        .invoke_handler(tauri::generate_handler![
            detect_komorebi,
            get_config,
            write_config,
            list_backups,
            restore_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
