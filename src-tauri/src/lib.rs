//! Komodash Tauri backend entrypoint.
//!
//! Composition root only: wires module instances into the Tauri app state
//! and registers `#[tauri::command]` handlers. Business logic lives in the
//! sibling modules (`komorebic`, `backup_store`, `command_catalog`,
//! `diag_log`, `installer`, `live_state`, `managed_config`, `updates`,
//! `whkdrc_parser`).
//!
//! `diag_log` is the file-logging + Copy-diagnostic-info module — named
//! `diag_log` rather than `diagnostic` because the latter collides with
//! Rust 1.78's stable `diagnostic::on_unimplemented` attribute namespace
//! that Tauri's `#[command]` macro emits for async commands taking
//! `tauri::State` arguments.

pub mod backup_store;
pub mod command_catalog;
pub mod diag_log;
pub mod field_catalog;
pub mod hotkey_validator;
pub mod installer;
pub mod komorebic;
pub mod live_state;
pub mod managed_config;
pub mod schema_cache;
pub mod updates;
pub mod whkdrc_parser;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use command_catalog::CommandCatalog;
use field_catalog::FieldCatalog;
use hotkey_validator::ReservedChordList;
use installer::{InstallResult, PackageManager, PackageManagerKind};
use komorebic::{Komorebic, KomorebiState, WinKomorebic};
use managed_config::ConfigKind;
use std::collections::HashSet;
use schema_cache::SchemaCache;
use tauri::{AppHandle, Emitter, Manager};
use whkdrc_parser::Chord;
use updates::{
    cached_or_fresh, newer_than_bundled, GithubReleaseSource, ReleaseSource, UpdateInfo,
};

/// 24 hours, per ADR-0011: we poll the GitHub releases API at most once
/// a day to avoid hammering it and to keep the launch fast.
const UPDATE_CACHE_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// Things Tauri commands need at runtime. Held in `tauri::State`.
pub struct AppState {
    pub komorebic: Arc<dyn Komorebic>,
    pub release_source: Arc<dyn ReleaseSource>,
    /// In-process schema cache (issue #11) — fetched lazily on first
    /// `get_schema` call, invalidated when the Komorebi version changes.
    pub schema_cache: Arc<SchemaCache>,
}

impl AppState {
    /// Production wiring: real `komorebic.exe` shell-out + real process
    /// scan, real GitHub API call for the update check.
    fn production() -> (Self, Arc<dyn Komorebic>) {
        let komorebic: Arc<dyn Komorebic> = Arc::new(WinKomorebic);
        let user_agent = format!("komodash/{}", env!("CARGO_PKG_VERSION"));
        let state = Self {
            komorebic: komorebic.clone(),
            release_source: Arc::new(GithubReleaseSource {
                owner: "dazu5".into(),
                repo: "komodash".into(),
                user_agent,
            }),
            schema_cache: Arc::new(SchemaCache::new()),
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
    diag_log::build_diagnostic_info(state.komorebic.as_ref())
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

// ---- Issue #14: quick-toggle row + Retile ----------------------------------

/// Toggle Komorebi's global pause state. Runtime-only; the static config
/// is not touched (this is a "what's running right now" override).
#[tauri::command]
async fn toggle_pause(state: tauri::State<'_, AppState>) -> Result<(), String> {
    run_thin(state.komorebic.clone(), |c| c.toggle_pause()).await
}

/// Toggle the runtime "mouse follows focus" behaviour. Same runtime-only
/// semantics as `toggle_pause` — the static config setting is unchanged
/// (edit it on the Configuration page for a persistent change).
#[tauri::command]
async fn toggle_mouse_follows_focus(state: tauri::State<'_, AppState>) -> Result<(), String> {
    run_thin(state.komorebic.clone(), |c| c.toggle_mouse_follows_focus()).await
}

/// Toggle "float override" — new windows float rather than tile until
/// the next Komorebi restart or another toggle.
#[tauri::command]
async fn toggle_float_override(state: tauri::State<'_, AppState>) -> Result<(), String> {
    run_thin(state.komorebic.clone(), |c| c.toggle_float_override()).await
}

/// Re-tile every managed window on every workspace. The recovery
/// affordance for "windows are in the wrong place" after a monitor
/// resolution change or similar runtime event.
#[tauri::command]
async fn retile(state: tauri::State<'_, AppState>) -> Result<(), String> {
    run_thin(state.komorebic.clone(), |c| c.retile()).await
}

/// Shared backbone for thin `&dyn Komorebic` → `Result<()>` Tauri
/// commands. Runs the closure on the blocking pool so the webview
/// stays responsive while `komorebic.exe` runs.
async fn run_thin<F>(client: Arc<dyn Komorebic>, op: F) -> Result<(), String>
where
    F: FnOnce(&dyn Komorebic) -> anyhow::Result<()> + Send + 'static,
{
    tokio::task::spawn_blocking(move || op(client.as_ref()))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
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

/// Upgrade Komorebi via winget (issue #16). Wraps `winget upgrade
/// LGUG2Z.komorebi`. Same `installation-output` streaming event as the
/// install commands — the frontend renders both in the same log panel.
#[tauri::command]
async fn upgrade_komorebi_via_winget(app: AppHandle) -> Result<InstallResult, String> {
    run_upgrade(PackageManagerKind::Winget, app).await
}

/// Upgrade Komorebi via Scoop. Same streaming semantics as winget.
#[tauri::command]
async fn upgrade_komorebi_via_scoop(app: AppHandle) -> Result<InstallResult, String> {
    run_upgrade(PackageManagerKind::Scoop, app).await
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

/// Same shape as `run_install` but using the upgrade verb (issue #16).
async fn run_upgrade(
    manager: PackageManagerKind,
    app: AppHandle,
) -> Result<InstallResult, String> {
    tokio::task::spawn_blocking(move || {
        installer::upgrade_komorebi(manager, |line| {
            let _ = app.emit("installation-output", line.to_string());
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

// ---- Issue #5 --------------------------------------------------------------

/// Check whether a newer Komodash release exists on GitHub. Backs the
/// in-app update banner (issue #5, per ADR-0011).
///
/// Any failure — no cache dir, network down, malformed response — is
/// swallowed and surfaces as `None`. The banner *should not* nag the
/// user with error states; it either appears or it doesn't.
#[tauri::command]
async fn check_komodash_update(
    state: tauri::State<'_, AppState>,
) -> Result<Option<UpdateInfo>, String> {
    // Clone the Arc so we can move it into the blocking task. Network and
    // file I/O are sync (reqwest blocking, fs::read), so we run them on
    // tokio's blocking pool and return `None` on any failure.
    let source = state.release_source.clone();
    let bundled = env!("CARGO_PKG_VERSION");

    let result = tokio::task::spawn_blocking(move || {
        let cache_path = match dirs::data_local_dir() {
            Some(dir) => dir.join("komodash").join("update-cache.json"),
            None => {
                tracing::debug!("no LOCALAPPDATA available; skipping update check");
                return Ok::<Option<UpdateInfo>, anyhow::Error>(None);
            }
        };
        let release =
            cached_or_fresh(&cache_path, UPDATE_CACHE_MAX_AGE, || source.fetch_latest())?;
        Ok(newer_than_bundled(&release, bundled))
    })
    .await;

    match result {
        Ok(Ok(maybe)) => Ok(maybe),
        Ok(Err(err)) => {
            tracing::debug!("update check failed: {err:?}");
            Ok(None)
        }
        Err(join_err) => {
            tracing::debug!("update check task panicked: {join_err:?}");
            Ok(None)
        }
    }
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

// ---- Issue #17: robust Static-config R/W -----------------------------------

/// Write the Static configuration with the merged-preservation semantics
/// from #17. The editor passes its current working buffer (`edits`) plus
/// the **set of top-level keys it actually touched** (`touched_fields`);
/// every other top-level key on disk is preserved verbatim — so a
/// **Power user** who has fields a future Komorebi version recognises
/// can't accidentally strip them by saving.
#[tauri::command]
fn write_static_config_merged(
    edits: serde_json::Value,
    touched_fields: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let path = config_path_for(&state, ConfigKind::Static).map_err(stringify_err)?;
    let backups = backups_root().map_err(stringify_err)?;
    let set: HashSet<String> = touched_fields.into_iter().collect();
    managed_config::write_static_config_merged(&path, &edits, &set, &backups)
        .map_err(stringify_err)
}

/// Return the list of top-level keys in the current Static configuration
/// that aren't declared in the JSON Schema. Backs the "your current
/// Komorebi version doesn't recognise these fields — they will be
/// preserved as-is" banner on the Configuration page.
#[tauri::command]
fn detect_unknown_fields(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let path = config_path_for(&state, ConfigKind::Static).map_err(stringify_err)?;
    let content = managed_config::read_with_kind(&path, Some(ConfigKind::Static))
        .map_err(stringify_err)?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }
    let schema = state
        .schema_cache
        .load(state.komorebic.as_ref())
        .map_err(stringify_err)?;
    managed_config::detect_unknown_top_level_fields(&content, &schema).map_err(stringify_err)
}

// ---- Issue #11 -------------------------------------------------------------

/// Return the **Static configuration** JSON Schema for the currently-installed
/// Komorebi (issue #11, per ADR-0002). Cached in-process; re-fetched on
/// Komorebi version change.
///
/// Returned as a raw JSON *string* rather than a parsed Value so the
/// frontend can deserialise it once into the same `JsonSchema` shape the
/// `<SchemaEditor>` consumes — preserves field order across the bridge,
/// which `serde_json::Value` would not.
#[tauri::command]
fn get_schema(state: tauri::State<'_, AppState>) -> Result<String, String> {
    state
        .schema_cache
        .load(state.komorebic.as_ref())
        .map_err(stringify_err)
}

/// Return the bundled Field catalog overlay (issue #11, per ADR-0004).
/// In-binary; no I/O. Returned as a typed struct so the frontend gets a
/// stable shape via the serde bridge.
#[tauri::command]
fn get_field_catalog() -> FieldCatalog {
    FieldCatalog::bundled()
}

// ---- Issue #12 -------------------------------------------------------------

/// Return the bundled Windows-reserved chord list (per ADR-0009). The
/// editor needs this so it can flag reserved chords inline as the user
/// types them, without re-running the full validator. Parsed once and
/// returned in canonical form.
#[tauri::command]
fn get_reserved_chords() -> Vec<Chord> {
    ReservedChordList::bundled().chords().to_vec()
}

fn config_path_for(
    state: &tauri::State<'_, AppState>,
    kind: ConfigKind,
) -> anyhow::Result<PathBuf> {
    match kind {
        ConfigKind::Static => state.komorebic.static_config_path(),
        ConfigKind::Bar => state.komorebic.bar_config_path(),
        ConfigKind::Whkdrc => state.komorebic.whkdrc_path(),
    }
}

/// Root of Komodash's backup store: `%LOCALAPPDATA%\komodash\backups\`.
fn backups_root() -> anyhow::Result<PathBuf> {
    let local = dirs::data_local_dir()
        .ok_or_else(|| anyhow::anyhow!("no LOCALAPPDATA directory"))?;
    Ok(local.join("komodash").join("backups"))
}

/// `Result::map_err` companion: render any error chain as a string the
/// frontend can show. Bubbles via Tauri serialisation.
fn stringify_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ---- entrypoint ------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Tracing has to be set up before anything else logs — and the guard
    // must live for the lifetime of `run` so the background flusher keeps
    // running. We bind it to `_log_guard` rather than discarding to `_` so
    // it isn't dropped immediately.
    let _log_guard = match diag_log::init_tracing() {
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
            check_komodash_update,
            get_config,
            write_config,
            list_backups,
            restore_backup,
            get_schema,
            get_field_catalog,
            get_reserved_chords,
            write_static_config_merged,
            detect_unknown_fields,
            upgrade_komorebi_via_winget,
            upgrade_komorebi_via_scoop,
            toggle_pause,
            toggle_mouse_follows_focus,
            toggle_float_override,
            retile,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
