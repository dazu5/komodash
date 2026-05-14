//! Komodash Tauri backend entrypoint.
//!
//! Composition root only: wires module instances into the Tauri app state
//! and registers `#[tauri::command]` handlers. Business logic lives in the
//! sibling modules (`komorebic`, `command_catalog`, `diagnostic`,
//! `installer`, `live_state`, `whkdrc_parser`, future: `managed_config`,
//! …).

pub mod command_catalog;
pub mod diagnostic;
pub mod installer;
pub mod komorebic;
pub mod live_state;
pub mod whkdrc_parser;

use std::path::PathBuf;
use std::sync::Arc;

use command_catalog::CommandCatalog;
use installer::{InstallResult, PackageManager, PackageManagerKind};
use komorebic::{Komorebic, KomorebiState, WinKomorebic};
use tauri::{AppHandle, Emitter, Manager};

/// Things Tauri commands need at runtime. Held in `tauri::State`.
pub struct AppState {
    pub komorebic: Arc<dyn Komorebic>,
}

impl AppState {
    /// Production wiring: real `komorebic.exe` shell-out + real process scan.
    fn production() -> (Self, Arc<dyn Komorebic>) {
        let komorebic: Arc<dyn Komorebic> = Arc::new(WinKomorebic);
        let state = Self {
            komorebic: komorebic.clone(),
        };
        (state, komorebic)
    }
}

// ---- Issue #2 --------------------------------------------------------------

/// Detect whether Komorebi is installed and running. Backs the Dashboard
/// status pill.
#[tauri::command]
fn detect_komorebi(state: tauri::State<'_, AppState>) -> KomorebiState {
    komorebic::detect(state.komorebic.as_ref())
}

// ---- Issue #10 -------------------------------------------------------------

/// Build the diagnostic-info markdown blob for the About-page Copy button
/// (issue #10, per ADR-0011 — local-only, no telemetry).
#[tauri::command]
fn get_diagnostic_info(state: tauri::State<'_, AppState>) -> String {
    diagnostic::build_diagnostic_info(state.komorebic.as_ref())
}

// ---- Issue #8 --------------------------------------------------------------

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

// ---- Issue #9 --------------------------------------------------------------

/// Detected host package managers, in preference order (winget first,
/// Scoop second). Empty vec means neither is on PATH.
#[tauri::command]
fn available_package_managers() -> Vec<PackageManager> {
    installer::available_package_managers()
}

/// Install Komorebi via winget. Streams output lines as the
/// `installation-output` Tauri event for the frontend to render.
/// Returns the final exit status.
#[tauri::command]
async fn install_komorebi_via_winget(app: AppHandle) -> Result<InstallResult, String> {
    run_install(PackageManagerKind::Winget, app).await
}

/// Install Komorebi via Scoop. Same streaming semantics as winget.
#[tauri::command]
async fn install_komorebi_via_scoop(app: AppHandle) -> Result<InstallResult, String> {
    run_install(PackageManagerKind::Scoop, app).await
}

/// Shared backbone for the two install commands: shells out on the
/// blocking pool, emits each line as an `installation-output` event.
async fn run_install(
    manager: PackageManagerKind,
    app: AppHandle,
) -> Result<InstallResult, String> {
    tokio::task::spawn_blocking(move || {
        installer::install_komorebi(manager, |line| {
            // Best-effort emit: a dropped event is preferable to crashing
            // the install mid-stream. Receivers see the gap as silence.
            let _ = app.emit("installation-output", line.to_string());
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

// ---- entrypoint ------------------------------------------------------------

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

    let (state, komorebic_for_live) = AppState::production();

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
        .manage(state)
        .setup(move |app| {
            // Spawn the live-state subscriber once the app is ready
            // (issue #6). The task lives for the lifetime of the process
            // and reconnects on its own — no shutdown handling for v1.
            live_state::spawn(app.handle().clone(), komorebic_for_live.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            detect_komorebi,
            get_diagnostic_info,
            get_command_catalog,
            available_package_managers,
            install_komorebi_via_winget,
            install_komorebi_via_scoop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
