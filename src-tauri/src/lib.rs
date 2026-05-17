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

/// Print to stderr only when the `KOMODASH_TRACE` env var is set.
///
/// Use for ad-hoc, dev-only visibility into multi-layer flows like
/// the bar's apply pipeline. Not a replacement for `tracing::*`
/// (those go to the rolling log file at `%LOCALAPPDATA%\komodash\
/// logs\`). `dev_trace!` shows up in the user's `pnpm tauri dev`
/// terminal, where they can paste it back into bug reports.
///
/// Documented in `CLAUDE.md` as the first step for any
/// "X isn't working" investigation.
macro_rules! dev_trace {
    ($($arg:tt)*) => {
        if std::env::var("KOMODASH_TRACE").is_ok() {
            eprintln!($($arg)*);
        }
    };
}

pub mod apply_static;
pub mod backup_store;
pub mod bar_schema_cache;
pub mod command_catalog;
pub mod diag_log;
pub mod field_catalog;
pub mod hotkey_validator;
pub mod installer;
pub mod komorebic;
pub mod live_state;
pub mod managed_config;
pub mod preferences;
pub mod schema_cache;
pub mod starter_config;
pub mod updates;
pub mod whkdrc_parser;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use bar_schema_cache::BarSchemaCache;
use command_catalog::CommandCatalog;
use field_catalog::FieldCatalog;
use hotkey_validator::ReservedChordList;
use installer::{InstallResult, PackageManager, PackageManagerKind};
use komorebic::{silent_command, Komorebic, KomorebiState, WinKomorebic};
use managed_config::ConfigKind;
use std::collections::HashSet;
use schema_cache::SchemaCache;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};
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
    /// In-process bar schema cache (issue #19) — same pattern as
    /// `schema_cache` but populated by `komorebi-bar.exe --schema`.
    pub bar_schema_cache: Arc<BarSchemaCache>,
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
            bar_schema_cache: Arc::new(BarSchemaCache::new()),
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

// ---- Issue #13 -------------------------------------------------------------

/// Focus the workspace at (monitor_index, workspace_index) — both
/// zero-based, matching the Ring<Workspace>.elements order in the Live
/// state snapshot. The Dashboard tree calls this when the **End user**
/// clicks a Workspace row.
#[tauri::command]
async fn focus_workspace(
    state: tauri::State<'_, AppState>,
    monitor_index: usize,
    workspace_index: usize,
) -> Result<(), String> {
    let client = state.komorebic.clone();
    tokio::task::spawn_blocking(move || client.focus_workspace(monitor_index, workspace_index))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
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

// ---- Issue #15 -------------------------------------------------------------

/// Start the Komorebi daemon (issue #15). `with_whkd` / `with_bar` are
/// `true` by default from the frontend so the user's hotkeys and status
/// bar come up alongside Komorebi.
///
/// Returns once `komorebic start` exits. Komorebi is still warming up at
/// that point — the frontend waits for the **Live state** subscription
/// to reconnect (within ~2s) to know it's actually serving.
#[tauri::command]
async fn start_komorebi(
    state: tauri::State<'_, AppState>,
    with_whkd: bool,
    with_bar: bool,
) -> Result<(), String> {
    let client = state.komorebic.clone();
    tokio::task::spawn_blocking(move || client.start(with_whkd, with_bar))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Stop the Komorebi daemon (issue #15). Idempotent at the Komorebic
/// layer — calling this when Komorebi is not running succeeds quietly.
/// Used by Restart (after a crash) and as a standalone affordance.
#[tauri::command]
async fn stop_komorebi(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let client = state.komorebic.clone();
    tokio::task::spawn_blocking(move || client.stop())
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

/// Merged save for the **bar configuration** (issue #56). Mirrors the
/// static config's merged-save: every top-level field the editor didn't
/// touch is preserved on disk so the bar editor can't strip
/// `komorebi-bar.exe`'s required fields (widgets, theme, fonts, etc.).
#[tauri::command]
fn write_bar_config_merged(
    edits: serde_json::Value,
    touched_fields: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let path = config_path_for(&state, ConfigKind::Bar).map_err(stringify_err)?;
    let backups = backups_root().map_err(stringify_err)?;
    let set: HashSet<String> = touched_fields.into_iter().collect();
    managed_config::write_bar_config_merged(&path, &edits, &set, &backups)
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

// ---- Issue #19: Bar configuration editor -----------------------------------

/// Return the **Bar configuration** JSON Schema for the currently-
/// installed Komorebi (issue #19, per ADR-0002 — same pattern as the
/// Static schema but sourced from `komorebi-bar.exe --schema`).
#[tauri::command]
fn get_bar_schema(state: tauri::State<'_, AppState>) -> Result<String, String> {
    state
        .bar_schema_cache
        .load(state.komorebic.as_ref())
        .map_err(stringify_err)
}

/// Return the bundled Bar Field catalog overlay (issue #19, per
/// ADR-0004). Different fields and sections from the Static catalog;
/// renderer is agnostic.
#[tauri::command]
fn get_bar_field_catalog() -> FieldCatalog {
    FieldCatalog::bundled_bar()
}

/// Restart the Komorebi bar daemon so a fresh `komorebi.bar.json` takes
/// effect (issue #19, per ADR-0006 buffered-apply — the bar daemon
/// doesn't hot-reload).
///
/// Empirically the bar's IPC reservation isn't reliable on restart:
/// after taskkill + relaunch, Komorebi's per-monitor
/// `work_area_offset` stays at zero even with a non-zero
/// `monitor.work_area_offset` in `komorebi.bar.json`. So Komodash
/// can't trust the bar to register its own reservation. This command
/// owns the whole choreography:
///
///   1. Read the on-disk bar config to learn the target monitor +
///      offsets the user wants.
///   2. Restart `komorebi-bar.exe` (so the visual bar moves).
///   3. Explicitly call `komorebic monitor-work-area-offset` on the
///      target monitor with the configured offsets — this is the
///      step that actually causes Komorebi to reserve the pixels.
///   4. Retile so existing windows reflow into the new work area.
///
/// Step 3's offsets are best-effort: if Komorebi isn't running, the
/// call errors and we still return Ok (the bar restart is the
/// user-visible action; the offset is a tiling enhancement).
#[tauri::command]
async fn apply_bar_config(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let client = state.komorebic.clone();
    let path = client.bar_config_path().map_err(|e| e.to_string())?;
    let static_path = client.static_config_path().ok();
    tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        // 1. Read the saved bar config so we know the target monitor
        //    + the bar geometry that drives the reservation.
        let raw = std::fs::read_to_string(&path).unwrap_or_default();
        let parsed = parse_bar_geometry_and_target(&raw);

        // 1a. Read the komorebi.json workspace inset (sum of
        //     default_workspace_padding + default_container_padding)
        //     so we can subtract it from the work-area top — see
        //     `compute_bar_reservation` for the math. Both fields
        //     contribute to the visible "bar to first window" gap;
        //     without summing them we under-shrink work_area_top and
        //     the bottom gap ends up bigger than the top gap.
        let top_workspace_inset = static_path
            .as_ref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .as_deref()
            .map(parse_top_workspace_inset)
            .unwrap_or(0);

        // 2. Restart the bar — gives the user the visual relocation.
        client.restart_bar()?;

        // 3. Compute the reservation from the SOLE source of truth
        //    (`compute_bar_reservation`) and push via CLI. Bar geometry
        //    inputs + per-monitor taskbar probe + container_padding go
        //    in; canonical `MonitorWorkAreaOffset` comes out. No other
        //    layer computes this independently any more.
        if let Some((idx, geometry)) = parsed {
            let reservation = compute_bar_reservation(geometry, idx, top_workspace_inset);
            dev_trace!(
                "[apply_bar_config] monitor={} geometry: height={} margin_top={} top_workspace_inset={} | reservation: top={} bottom={} left={} right={}",
                idx,
                geometry.height,
                geometry.margin_top,
                top_workspace_inset,
                reservation.top,
                reservation.bottom,
                reservation.left,
                reservation.right,
            );
            let push = client.monitor_work_area_offset(
                idx,
                reservation.left,
                reservation.top,
                reservation.right,
                reservation.bottom,
            );
            if let Err(e) = &push {
                dev_trace!("[apply_bar_config] CLI push failed: {e}");
            }
            // 4. Force a re-tile so existing windows reflow.
            let _ = client.retile();
        } else {
            dev_trace!(
                "[apply_bar_config] could not parse bar geometry from bar config — skipping offset push"
            );
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// Canonical work-area reservation Komodash pushes to Komorebi for the
/// bar's target monitor. Each edge is independent — see CONTEXT.md's
/// "Bar geometry" section for what each represents.
#[derive(Debug, Default, Clone, Copy)]
struct BarReservation {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

/// The bar's painted geometry. Parsed from `komorebi.bar.json`,
/// fed into [`compute_bar_reservation`] to derive the canonical
/// `work_area_offset`. Decoupled from the reservation itself so that
/// users edit geometry and Komodash derives the reservation — never
/// the reverse.
#[derive(Debug, Default, Clone, Copy)]
struct BarGeometry {
    height: i32,
    margin_top: i32,
    #[allow(dead_code)]
    margin_bottom: i32,
    #[allow(dead_code)]
    margin_left: i32,
    #[allow(dead_code)]
    margin_right: i32,
}

/// Pull the bar's target monitor index + painted geometry out of a
/// `komorebi.bar.json` blob. The `monitor` field is an anyOf union:
/// either a bare integer index OR `{index, ...}`. Any
/// `monitor.work_area_offset` in the file is **ignored** — see
/// [`compute_bar_reservation`] for the SSOT explanation.
fn parse_bar_geometry_and_target(raw: &str) -> Option<(u32, BarGeometry)> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;

    let monitor = v.get("monitor")?;
    let idx = if let Some(i) = monitor.as_u64() {
        i as u32
    } else if let Some(obj) = monitor.as_object() {
        obj.get("index")?.as_u64()? as u32
    } else {
        return None;
    };

    let height = v.get("height").and_then(|h| h.as_f64()).unwrap_or(50.0) as i32;
    let margin = v.get("margin").and_then(|m| m.as_object());
    let read_margin = |side: &str| -> i32 {
        margin
            .and_then(|o| o.get(side))
            .and_then(|t| t.as_i64())
            .unwrap_or(0) as i32
    };

    Some((
        idx,
        BarGeometry {
            height,
            margin_top: read_margin("top"),
            margin_bottom: read_margin("bottom"),
            margin_left: read_margin("left"),
            margin_right: read_margin("right"),
        },
    ))
}

/// **Sole source of truth** for the bar's `work_area_offset`.
///
/// Inputs: bar geometry (height + margins), the target monitor's
/// index, and komorebi's `container_padding` (read from komorebi.
/// json). Output: per-edge pixel reservations Komorebi keeps clear
/// when tiling workspaces.
///
/// # Two Komorebi behaviours we have to compensate for
///
/// **1. Asymmetric offset interpretation** (`komorebi/src/workspace.
/// rs:633-636`):
/// ```text
/// with_offset.top    += offset.top
/// with_offset.bottom -= offset.bottom   (here `bottom` is HEIGHT)
/// ```
/// `offset.top` *shifts* the work area down; `offset.bottom` *shrinks*
/// its height. With asymmetric `{top: N, bottom: 0}` the work area
/// extends N px BEYOND the monitor's actual bottom and windows render
/// off-screen. So `bottom` must be at least `top` to keep the work
/// area within the visible monitor.
///
/// **2. Container padding insets windows from the work-area edges.**
/// The visible "bar bottom → first window top" gap is therefore
/// `(work_area_top - bar_bottom) + container_padding`, NOT just the
/// reservation difference. Without compensating for it the bottom
/// gap is always `container_padding` px bigger than the top gap.
///
/// # Formula
///
/// Let `mt = margin_top`, `h = height`, `cp = container_padding`,
/// `tc = taskbar_clearance`. The visible top gap is `mt`; we want
/// the visible bottom gap to also equal `mt`. The visible bottom
/// gap is `(top - mt - h) + cp`, so we need `top = 2*mt + h - cp`.
///
/// Clamp at `mt + h` to prevent windows from overlapping the bar
/// (only matters when `cp > mt`; in that case the gaps can't be
/// fully matched — visible bottom gap will be `cp`, visible top
/// gap stays `mt`).
///
/// ```text
/// top    = max(2*mt + h - cp, mt + h)
/// bottom = top + tc        // keeps work area on-screen + taskbar-safe
/// left   = 0
/// right  = 0
/// ```
/// `top_workspace_inset` is the sum of `default_workspace_padding` +
/// `default_container_padding` from komorebi.json — the pixels
/// komorebi insets the first window from the work-area's top edge.
/// See [`parse_top_workspace_inset`].
fn compute_bar_reservation(
    geometry: BarGeometry,
    monitor_index: u32,
    top_workspace_inset: i32,
) -> BarReservation {
    let mt = geometry.margin_top;
    let h = geometry.height;
    let inset = top_workspace_inset.max(0);
    let target_top = 2 * mt + h - inset;
    let min_top = mt + h; // window can't overlap the bar
    let top = target_top.max(min_top);
    let taskbar_clearance = probe_taskbar_height_for_monitor(monitor_index).unwrap_or(0);
    let bottom = top + taskbar_clearance;
    BarReservation {
        left: 0,
        top,
        right: 0,
        bottom,
    }
}

/// Compute the **total pixel inset** komorebi adds between a workspace
/// edge and the first window edge along the top side. That inset is
/// what makes the bar-to-window gap larger than the bar's own
/// `margin.top` — see CONTEXT.md → Bar geometry.
///
/// Komorebi composes two pad fields here:
/// - `default_workspace_padding` — workspace edge → container edge
/// - `default_container_padding` — container edge → window edge
///
/// Both are top-level in `komorebi.json`. They add up for the visible
/// top inset; same on the other three sides. Per-workspace overrides
/// exist but we don't read them (would need to know the active
/// workspace at apply time and the user's static config rarely sets
/// them per-workspace anyway).
///
/// **Common mistake** (and the one that bit us): the JSON field at
/// the top level is `default_container_padding`, NOT bare
/// `container_padding`. The earlier version of this function looked
/// for `container_padding` and silently returned 0 for every real
/// config, defeating the gap-match logic in
/// [`compute_bar_reservation`].
fn parse_top_workspace_inset(raw: &str) -> i32 {
    let parsed = serde_json::from_str::<serde_json::Value>(raw).ok();
    let read = |key: &str| -> i32 {
        parsed
            .as_ref()
            .and_then(|v| v.get(key))
            .and_then(|v| v.as_i64())
            .map(|n| n as i32)
            .unwrap_or(0)
            .max(0)
    };
    read("default_workspace_padding") + read("default_container_padding")
}

/// Probe the visible Windows taskbar height for a specific monitor.
///
/// Strategy:
/// 1. Enumerate all monitors via `EnumDisplayMonitors`.
/// 2. Look up the HMONITOR at the requested index (assumes
///    enumeration order matches Komorebi's monitor index — true for
///    typical 1–2 monitor setups, may not be for unusual layouts).
/// 3. Call `GetMonitorInfoW`; taskbar height = `rcMonitor.bottom −
///    rcWork.bottom` for a bottom-anchored taskbar.
/// 4. **Fallback** — if step 2 returns nothing OR step 3 says 0,
///    take the MAX taskbar height across ALL monitors. This handles
///    the index-ordering mismatch case (the bar's actual monitor IS
///    one of the enumerated monitors, just at a different index) at
///    the cost of slightly over-reserving on a monitor whose actual
///    taskbar is smaller. Better visible-gap-too-big than windows-
///    hidden-under-taskbar.
///
/// Also emits `dev_trace!` lines with each monitor's reported size
/// + taskbar so multi-monitor setups can verify the right one was
/// picked.
/// Probe the Windows taskbar height by finding its window directly.
///
/// Returns the taskbar's pixel height regardless of auto-hide state —
/// the window exists with its full real height even when hidden.
#[cfg(windows)]
fn probe_taskbar_height_via_window() -> Option<i32> {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowW, GetWindowRect};

    let class_name: Vec<u16> = "Shell_TrayWnd\0".encode_utf16().collect();
    // SAFETY: null-terminated UTF-16 class name; null window-name OK.
    let hwnd = unsafe { FindWindowW(class_name.as_ptr(), std::ptr::null()) };
    if hwnd.is_null() {
        return None;
    }
    let mut rect: RECT = unsafe { std::mem::zeroed() };
    // SAFETY: hwnd is non-null per the check above; rect is owned here.
    let ok = unsafe { GetWindowRect(hwnd, &mut rect) };
    if ok == 0 {
        return None;
    }
    Some((rect.bottom - rect.top).max(0))
}

#[cfg(not(windows))]
fn probe_taskbar_height_via_window() -> Option<i32> {
    None
}

/// Returns `true` if the Windows taskbar is currently configured to
/// auto-hide (slides off-screen unless the cursor approaches it).
///
/// Why we care: auto-hide users explicitly chose to recover the
/// taskbar's pixels when it's hidden — reserving for it permanently
/// defeats the point of auto-hide. So when this returns true we use
/// `bottom = 0` and accept the brief content overlap during reveal.
/// When false we reserve the taskbar's actual height to prevent
/// permanent overlap with a visible taskbar.
///
/// Uses `SHAppBarMessage(ABM_GETSTATE)` — returns a bitfield where
/// the `ABS_AUTOHIDE` bit (= 1) indicates auto-hide is enabled.
#[cfg(windows)]
fn taskbar_is_autohidden() -> bool {
    use windows_sys::Win32::UI::Shell::{SHAppBarMessage, ABM_GETSTATE, APPBARDATA};

    const ABS_AUTOHIDE: usize = 0x0000_0001;

    let mut data: APPBARDATA = unsafe { std::mem::zeroed() };
    data.cbSize = std::mem::size_of::<APPBARDATA>() as u32;
    // SAFETY: SHAppBarMessage with ABM_GETSTATE returns a bitfield
    // (state) and only reads from APPBARDATA; cbSize is set.
    let state = unsafe { SHAppBarMessage(ABM_GETSTATE, &mut data) } as usize;
    (state & ABS_AUTOHIDE) != 0
}

#[cfg(not(windows))]
fn taskbar_is_autohidden() -> bool {
    false
}

#[cfg(windows)]
fn probe_taskbar_height_for_monitor(monitor_index: u32) -> Option<i32> {
    use windows_sys::Win32::Foundation::{LPARAM, RECT};
    use windows_sys::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO,
    };

    // Auto-hide taskbar: user opted into recovering its pixels when
    // hidden. Don't reserve — accept brief overlap during reveal.
    // This MUST run before the rcMonitor/rcWork comparison below
    // because an auto-hidden taskbar fools that check (rcWork ==
    // rcMonitor when hidden) into thinking there's no taskbar at
    // all, which would lead to a Shell_TrayWnd fallback reserving
    // its full height — exactly the wasted-space outcome auto-hide
    // is meant to prevent.
    if taskbar_is_autohidden() {
        dev_trace!(
            "[probe_taskbar] taskbar is set to AUTO-HIDE — using bottom=0 to honor the user's recover-pixels choice"
        );
        return Some(0);
    }

    unsafe extern "system" fn collect(
        hmon: HMONITOR,
        _hdc: HDC,
        _rect: *mut RECT,
        lparam: LPARAM,
    ) -> i32 {
        // SAFETY: caller passes &mut Vec<HMONITOR> as LPARAM; we cast back.
        let monitors = unsafe { &mut *(lparam as *mut Vec<HMONITOR>) };
        monitors.push(hmon);
        1
    }

    let mut monitors: Vec<HMONITOR> = Vec::new();
    // SAFETY: EnumDisplayMonitors invokes `collect` synchronously for
    // each monitor; the &mut Vec lifetime covers the call.
    unsafe {
        EnumDisplayMonitors(
            std::ptr::null_mut(),
            std::ptr::null(),
            Some(collect),
            &mut monitors as *mut _ as LPARAM,
        );
    }

    // Gather (width × height, taskbar_height) per enumerated monitor.
    let info_for = |hmon: HMONITOR| -> Option<MONITORINFO> {
        let mut info: MONITORINFO = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        // SAFETY: hmon is from our enumeration; cbSize is set.
        let ok = unsafe { GetMonitorInfoW(hmon, &mut info) };
        (ok != 0).then_some(info)
    };
    let taskbar_height_for = |info: &MONITORINFO| -> i32 {
        (info.rcMonitor.bottom - info.rcWork.bottom).max(0)
    };

    // Per-monitor trace for debugging Komorebi-vs-Win32 index mismatch.
    for (i, hmon) in monitors.iter().copied().enumerate() {
        if let Some(info) = info_for(hmon) {
            let w = info.rcMonitor.right - info.rcMonitor.left;
            let h = info.rcMonitor.bottom - info.rcMonitor.top;
            let tb = taskbar_height_for(&info);
            dev_trace!(
                "[probe_taskbar] EnumDisplayMonitors[{i}] = {w}x{h}, taskbar={tb}px"
            );
        }
    }

    // Preferred: the HMONITOR at the requested index.
    let preferred = monitors
        .get(monitor_index as usize)
        .copied()
        .and_then(info_for)
        .map(|info| taskbar_height_for(&info))
        .unwrap_or(0);

    if preferred > 0 {
        dev_trace!(
            "[probe_taskbar] using direct match for monitor {monitor_index}: {preferred}px"
        );
        return Some(preferred);
    }

    // Fallback: take the max across all monitors. Conservative —
    // over-reserves on a monitor with a smaller taskbar, but that's
    // visible-gap-too-big rather than windows-under-taskbar.
    let max_across = monitors
        .iter()
        .copied()
        .filter_map(info_for)
        .map(|info| taskbar_height_for(&info))
        .max()
        .unwrap_or(0);

    if max_across > 0 {
        dev_trace!(
            "[probe_taskbar] direct match was 0; falling back to MAX across monitors: {max_across}px"
        );
        return Some(max_across);
    }

    // Last-resort fallback: query the taskbar's actual HWND via
    // FindWindowW("Shell_TrayWnd") + GetWindowRect. This works even
    // when the taskbar is auto-hidden — the window still exists at
    // its real size, Windows just doesn't compose it onto the screen.
    // Without this branch, users with auto-hide taskbars would get
    // bottom=0 and their bottom row of windows would get obscured
    // every time the taskbar reveals itself on hover.
    if let Some(h) = probe_taskbar_height_via_window().filter(|h| *h > 0) {
        dev_trace!(
            "[probe_taskbar] rcWork = rcMonitor on every monitor (taskbar likely auto-hidden); using Shell_TrayWnd window height: {h}px"
        );
        return Some(h);
    }

    dev_trace!(
        "[probe_taskbar] no taskbar detected on any monitor and Shell_TrayWnd query returned nothing — pushing bottom=0"
    );
    Some(0)
}

#[cfg(not(windows))]
fn probe_taskbar_height_for_monitor(_monitor_index: u32) -> Option<i32> {
    None
}

/// Per-monitor geometry, queried from Win32 directly (NOT from
/// komorebi's snapshot). Single source of truth for bar positioning
/// during monitor switches — komorebi's snapshot drops monitor info
/// while komorebi-bar restarts to move, so anything that depends on
/// the snapshot is unreliable during exactly the moment we need it.
#[derive(Debug, Clone, Copy, serde::Serialize)]
struct MonitorGeometry {
    left: i32,
    top: i32,
    width: i32,
    height: i32,
    /// DPI scale (1.0 = 96 DPI, 1.25 = 120 DPI, ...).
    scale: f32,
}

/// Read the bounding rect + DPI scale of the monitor at the given
/// Win32 enumeration index. Returns `None` if the index is out of
/// bounds or any Win32 call fails.
///
/// **Caveat**: Win32's `EnumDisplayMonitors` order isn't guaranteed
/// to match Komorebi's monitor index. For typical 1–2 monitor setups
/// they agree; for unusual layouts the user may need to adjust the
/// bar's monitor field manually. This is still preferable to reading
/// from the snapshot — snapshot data is the right INDEX but unreliable
/// CONTENT, Win32 is reliable content with index that USUALLY matches.
#[tauri::command]
fn get_monitor_geometry(index: u32) -> Option<MonitorGeometry> {
    probe_monitor_geometry(index)
}

#[cfg(windows)]
fn probe_monitor_geometry(index: u32) -> Option<MonitorGeometry> {
    use windows_sys::Win32::Foundation::{LPARAM, RECT};
    use windows_sys::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO,
    };
    use windows_sys::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};

    unsafe extern "system" fn collect(
        hmon: HMONITOR,
        _hdc: HDC,
        _rect: *mut RECT,
        lparam: LPARAM,
    ) -> i32 {
        let monitors = unsafe { &mut *(lparam as *mut Vec<HMONITOR>) };
        monitors.push(hmon);
        1
    }

    let mut monitors: Vec<HMONITOR> = Vec::new();
    // SAFETY: EnumDisplayMonitors invokes the callback synchronously.
    unsafe {
        EnumDisplayMonitors(
            std::ptr::null_mut(),
            std::ptr::null(),
            Some(collect),
            &mut monitors as *mut _ as LPARAM,
        );
    }
    let hmon = monitors.get(index as usize).copied()?;

    let mut info: MONITORINFO = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    // SAFETY: hmon from EnumDisplayMonitors, info has cbSize set.
    let ok = unsafe { GetMonitorInfoW(hmon, &mut info) };
    if ok == 0 {
        return None;
    }

    let mut dpi_x: u32 = 96;
    let mut dpi_y: u32 = 96;
    // SAFETY: hmon non-null per check above; dpi_x/y stack-owned.
    let hr = unsafe { GetDpiForMonitor(hmon, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) };
    let scale = if hr == 0 {
        (dpi_x as f32) / 96.0
    } else {
        1.0
    };

    Some(MonitorGeometry {
        left: info.rcMonitor.left,
        top: info.rcMonitor.top,
        width: info.rcMonitor.right - info.rcMonitor.left,
        height: info.rcMonitor.bottom - info.rcMonitor.top,
        scale,
    })
}

#[cfg(not(windows))]
fn probe_monitor_geometry(_index: u32) -> Option<MonitorGeometry> {
    None
}

/// Probe the DPI scale factor for the monitor that contains the
/// given screen point. Returns `1.0` for 96-DPI (100%), `1.25` for
/// 120-DPI (125%), etc. Defaults to `1.0` on any Win32 failure or
/// non-Windows builds.
///
/// Why a point and not a Komorebi monitor index: `EnumDisplayMonitors`
/// order isn't guaranteed to match Komorebi's monitor index (we hit
/// this with the taskbar probe too — task #124). The frontend has
/// each monitor's bounding rect from Komorebi's live state; passing
/// the center point lets `MonitorFromPoint` return the exact HMONITOR
/// regardless of how Win32 enumerates monitors. Unambiguous.
///
/// The DPI scale matters because the pill preset writes
/// physical-pixel bar geometry (height, margin, sidePadding) that
/// egui then renders content into using LOGICAL pixels (physical /
/// scale). Without scaling, a 45-px bar on a 125% monitor has only
/// 36 logical pixels of content room — cramped. Multiplying physical
/// fields by the monitor's DPI scale gives egui the same logical
/// budget on every monitor.
#[tauri::command]
#[allow(unused_variables)]
fn get_monitor_dpi_scale(x: i32, y: i32) -> f32 {
    probe_monitor_dpi_scale_at(x, y).unwrap_or(1.0)
}

#[cfg(windows)]
fn probe_monitor_dpi_scale_at(x: i32, y: i32) -> Option<f32> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTONEAREST};
    use windows_sys::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};

    let point = POINT { x, y };
    // SAFETY: MonitorFromPoint is thread-safe and returns null on no-match;
    // MONITOR_DEFAULTTONEAREST guarantees non-null for any valid point.
    let hmon = unsafe { MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST) };
    if hmon.is_null() {
        return None;
    }
    let mut dpi_x: u32 = 96;
    let mut dpi_y: u32 = 96;
    // SAFETY: hmon is non-null per the check above; dpi_x/y are stack-owned.
    let hr = unsafe { GetDpiForMonitor(hmon, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) };
    if hr != 0 {
        return None;
    }
    Some((dpi_x as f32) / 96.0)
}

#[cfg(not(windows))]
fn probe_monitor_dpi_scale_at(_x: i32, _y: i32) -> Option<f32> {
    None
}

/// Reset a monitor's runtime work-area offset to zero on all sides
/// (issue #19 polish). Called from the frontend when the user moves
/// the bar from one monitor to another — without this, Komorebi keeps
/// the abandoned monitor's reserved bar pixels and its tiled windows
/// don't reflow into the freed space.
#[tauri::command]
async fn reset_monitor_work_area_offset(
    state: tauri::State<'_, AppState>,
    monitor_index: u32,
) -> Result<(), String> {
    let client = state.komorebic.clone();
    tokio::task::spawn_blocking(move || {
        client.monitor_work_area_offset(monitor_index, 0, 0, 0, 0)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
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

// ---- Issue #20: hotkey editor -----------------------------------------------

/// Read and parse the live `whkdrc` (issue #20). Returns the typed
/// [`WhkdrcModel`] so the editor manipulates a structured shape rather
/// than text. Empty file → empty model.
#[tauri::command]
fn read_whkdrc(state: tauri::State<'_, AppState>) -> Result<whkdrc_parser::WhkdrcModel, String> {
    let path = state.komorebic.whkdrc_path().map_err(stringify_err)?;
    let content = managed_config::read_with_kind(&path, Some(ConfigKind::Whkdrc))
        .map_err(stringify_err)?;
    if content.trim().is_empty() {
        return Ok(whkdrc_parser::WhkdrcModel::default());
    }
    whkdrc_parser::parse(&content).map_err(stringify_err)
}

/// Serialise the model to canonical whkdrc form (per ADR-0003) and
/// write it to disk via the standard managed_config path. Does NOT
/// restart whkd — that's [`apply_whkdrc`]'s job, called separately
/// per ADR-0006's buffered-apply semantics.
#[tauri::command]
fn write_whkdrc(
    model: whkdrc_parser::WhkdrcModel,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let path = state.komorebic.whkdrc_path().map_err(stringify_err)?;
    let content = whkdrc_parser::serialize(&model);
    let backups = backups_root().map_err(stringify_err)?;
    managed_config::write(&path, &content, ConfigKind::Whkdrc, &backups)
        .map_err(stringify_err)
}

/// Run the [`hotkey_validator`] over a model + the cached Command
/// catalog + the bundled reserved-chord list. Returns the full
/// [`hotkey_validator::ValidationIssue`] list per ADR-0009.
#[tauri::command]
fn validate_hotkeys(
    model: whkdrc_parser::WhkdrcModel,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<hotkey_validator::ValidationIssue>, String> {
    let version = state
        .komorebic
        .discover()
        .map(|info| info.version)
        .ok_or_else(|| "komorebic is not installed".to_string())?;
    let cache = command_catalog_cache_path().map_err(|e| e.to_string())?;
    let catalog = command_catalog::load_or_build(&cache, state.komorebic.as_ref(), &version)
        .map_err(|e| e.to_string())?;
    let reserved = hotkey_validator::ReservedChordList::bundled();
    Ok(hotkey_validator::validate(&model, &catalog, &reserved))
}

/// Restart whkd so the on-disk whkdrc changes take effect (issue #20,
/// per ADR-0006 — buffered apply for whkdrc, not live-apply).
#[tauri::command]
async fn apply_whkdrc(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let client = state.komorebic.clone();
    tokio::task::spawn_blocking(move || client.restart_whkd())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

// ---- Issue #24: Community catalog ------------------------------------------

/// Run `komorebic fetch-app-specific-configuration` to download the
/// latest community catalog (`applications.json`) into the user's home
/// directory. Returns `Ok(())` on success. The frontend renders the
/// stderr text on failure so the user can see why the download didn't
/// land (offline, GitHub unreachable, etc.).
#[tauri::command]
async fn fetch_community_catalog(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let client = state.komorebic.clone();
    tokio::task::spawn_blocking(move || {
        let info = client
            .discover()
            .ok_or_else(|| anyhow::anyhow!("komorebic.exe could not be located"))?;
        let output = silent_command(&info.path)
            .arg("fetch-app-specific-configuration")
            .output()?;
        if !output.status.success() {
            anyhow::bail!(
                "komorebic fetch-app-specific-configuration failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
        Ok::<(), anyhow::Error>(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// Read the community catalog from disk and return the raw JSON string.
/// The frontend parses + searches via `src/lib/community-catalog.ts`.
///
/// Returns `Ok("")` if the file doesn't exist (the frontend renders a
/// "Download library" affordance in that case). Returns an error only
/// for unexpected I/O failures (permission denied, etc.).
#[tauri::command]
fn read_community_catalog() -> Result<String, String> {
    let Some(home) = dirs::home_dir() else {
        return Err("could not determine home directory".to_string());
    };
    let path = home.join("applications.json");
    match std::fs::read_to_string(&path) {
        Ok(contents) => Ok(contents),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("failed to read {}: {e}", path.display())),
    }
}

// ---- Issue #18 -------------------------------------------------------------

/// Live-apply the Static configuration: tell the running Komorebi daemon
/// to reload `komorebi.json` from disk (per ADR-0006). Called after every
/// settled edit in the editor's live-apply flow.
///
/// Returns `Ok(())` on success. On failure returns the friendly + raw
/// error pair so the editor can render an inline red note under the
/// offending field.
///
/// When Komorebi is not running, this is a no-op success — the frontend
/// is responsible for skipping the call entirely (it has the running
/// state from `detect_komorebi`). We still tolerate being asked: if the
/// underlying shell-out fails because the daemon is absent, the error
/// translation surfaces the "not running" message.
#[tauri::command]
fn apply_static_config(
    state: tauri::State<'_, AppState>,
) -> Result<(), apply_static::ApplyError> {
    let path = match state.komorebic.static_config_path() {
        Ok(p) => p,
        Err(e) => {
            return Err(apply_static::ApplyError {
                friendly: "Komodash couldn't find where komorebi.json lives.".into(),
                raw: e.to_string(),
            });
        }
    };
    apply_static::apply(state.komorebic.as_ref(), &path)
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

// ---- Issue #26: Window context menu ----------------------------------------

/// Toggle the floating state of the currently-focused window
/// (`komorebic toggle-float`). The Dashboard right-click context menu
/// drives this; the user is expected to have clicked the window's row
/// first to focus it.
#[tauri::command]
async fn toggle_focused_window_float(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let client = state.komorebic.clone();
    tokio::task::spawn_blocking(move || run_komorebic_subcommand(client.as_ref(), "toggle-float"))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Close the currently-focused window (`komorebic close`).
#[tauri::command]
async fn close_focused_window(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let client = state.komorebic.clone();
    tokio::task::spawn_blocking(move || run_komorebic_subcommand(client.as_ref(), "close"))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Move the focused window to (monitor, workspace) via
/// `komorebic move-to-workspace`. komorebic interprets the workspace
/// argument relative to the focused monitor, so we focus the target
/// monitor first.
#[tauri::command]
async fn move_focused_window_to_workspace(
    state: tauri::State<'_, AppState>,
    monitor_index: usize,
    workspace_index: usize,
) -> Result<(), String> {
    let client = state.komorebic.clone();
    tokio::task::spawn_blocking(move || {
        let info = client
            .discover()
            .ok_or_else(|| anyhow::anyhow!("komorebic.exe could not be located"))?;
        let monitor_str = monitor_index.to_string();
        let workspace_str = workspace_index.to_string();
        // Focus target monitor first so move-to-workspace lands on the
        // right one (komorebic move-to-workspace operates relative to
        // the focused monitor's workspace ring).
        let focus_out = silent_command(&info.path)
            .args(["focus-monitor", &monitor_str])
            .output()?;
        if !focus_out.status.success() {
            anyhow::bail!(
                "komorebic focus-monitor {monitor_index} failed: {}",
                String::from_utf8_lossy(&focus_out.stderr).trim()
            );
        }
        let move_out = silent_command(&info.path)
            .args(["move-to-workspace", &workspace_str])
            .output()?;
        if !move_out.status.success() {
            anyhow::bail!(
                "komorebic move-to-workspace {workspace_index} failed: {}",
                String::from_utf8_lossy(&move_out.stderr).trim()
            );
        }
        Ok::<(), anyhow::Error>(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

// ---- Issue #25: Visible windows --------------------------------------------

/// Run `komorebic visible-windows` and return the raw JSON string.
/// The frontend parses the monitor-keyed shape via
/// `src/lib/visible-windows.ts`.
///
/// Returns an error if komorebic is missing or the command fails;
/// returns the stdout verbatim otherwise (the JSON parser on the
/// frontend handles malformed output by falling back to `[]`).
#[tauri::command]
async fn get_visible_windows(
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let client = state.komorebic.clone();
    tokio::task::spawn_blocking(move || {
        let info = client
            .discover()
            .ok_or_else(|| anyhow::anyhow!("komorebic.exe could not be located"))?;
        let output = silent_command(&info.path)
            .arg("visible-windows")
            .output()?;
        if !output.status.success() {
            anyhow::bail!(
                "komorebic visible-windows failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
        Ok::<String, anyhow::Error>(String::from_utf8_lossy(&output.stdout).into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

// ---- Issue #23: First-run wizard -------------------------------------------

/// The four detection signals the first-run wizard FSM consumes. All
/// four → wizard skips and the user lands on the Dashboard.
#[derive(serde::Serialize)]
struct FirstRunState {
    installed: bool,
    #[serde(rename = "configExists")]
    config_exists: bool,
    running: bool,
    #[serde(rename = "autostartEnabled")]
    autostart_enabled: bool,
}

/// Run all four wizard preconditions in one shot. Called on mount and
/// after every successful action step so the FSM can advance.
#[tauri::command]
fn detect_first_run_state(state: tauri::State<'_, AppState>) -> FirstRunState {
    let installed = state.komorebic.discover().is_some();
    let config_exists = state
        .komorebic
        .static_config_path()
        .ok()
        .map(|p| p.exists())
        .unwrap_or(false);
    let running = state.komorebic.is_running();
    let autostart_enabled = autostart_shortcut_path()
        .map(|p| p.exists())
        .unwrap_or(false);
    FirstRunState {
        installed,
        config_exists,
        running,
        autostart_enabled,
    }
}

/// `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\komorebi.lnk`.
/// Komorebi's `enable-autostart` plants a shortcut here; we detect its
/// presence to answer "is autostart on?".
fn autostart_shortcut_path() -> Option<PathBuf> {
    let roaming = dirs::data_dir()?;
    Some(
        roaming
            .join("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs")
            .join("Startup")
            .join("komorebi.lnk"),
    )
}

/// Bundled starter config (ADR-0010). Lives at
/// `src-tauri/resources/starter-config.json`. Re-built at compile
/// time via `include_str!` so we ship a single binary.
const STARTER_CONFIG: &str = include_str!("../resources/starter-config.json");

/// Write the bundled starter config to the canonical Static config
/// path. Used by the first-run wizard's `create_config` step. Refuses
/// to overwrite an existing file — the wizard only invokes this when
/// `detect_first_run_state.configExists` is false.
#[tauri::command]
fn write_starter_config(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let path = state
        .komorebic
        .static_config_path()
        .map_err(stringify_err)?;
    if path.exists() {
        return Err(format!(
            "refusing to overwrite existing config at {}",
            path.display()
        ));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(stringify_err)?;
    }
    // Inject `monitors[].workspaces[]` sized to the user's displays
    // (issue #69) so the bar shows N pips from boot instead of waiting
    // for the user to discover Alt+1..N. Falls back to the unmodified
    // starter if monitor detection or injection fails — a malformed
    // starter is a far worse failure mode than an empty bar.
    let monitor_count = starter_config::detect_monitor_count();
    let body = starter_config::inject_workspaces(STARTER_CONFIG, monitor_count)
        .unwrap_or_else(|_| STARTER_CONFIG.to_string());
    std::fs::write(&path, body).map_err(stringify_err)?;
    Ok(())
}

// ---- preferences + tray (issue #72) ---------------------------------------

/// Load preferences from disk on demand. Used by the frontend to drive
/// the Behaviour settings card and by the close-handler to decide
/// whether to hide or exit.
#[tauri::command]
fn get_preferences() -> preferences::Preferences {
    match preferences::canonical_path() {
        Some(path) => preferences::load(&path),
        None => preferences::Preferences::default(),
    }
}

/// Toggle close-to-tray behaviour and persist.
#[tauri::command]
fn set_close_to_tray(enabled: bool) -> Result<(), String> {
    let path = preferences::canonical_path()
        .ok_or_else(|| "no config dir available on this platform".to_string())?;
    let mut prefs = preferences::load(&path);
    prefs.close_to_tray = enabled;
    preferences::save(&path, &prefs).map_err(stringify_err)
}

/// Mark the one-shot close-to-tray notice as seen so we don't toast
/// again on subsequent closes.
#[tauri::command]
fn mark_close_to_tray_notice_seen() -> Result<(), String> {
    let path = preferences::canonical_path()
        .ok_or_else(|| "no config dir available on this platform".to_string())?;
    let mut prefs = preferences::load(&path);
    prefs.close_to_tray_notice_seen = true;
    preferences::save(&path, &prefs).map_err(stringify_err)
}

/// Build the system-tray icon with a minimal Show / Quit menu.
/// Left-clicking the icon also shows the window — matches the
/// muscle memory most Windows users have for taskbar icons.
fn install_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Komodash", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Komodash", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let icon = app
        .default_window_icon()
        .ok_or_else(|| tauri::Error::Anyhow(anyhow::anyhow!("no default window icon bundled")))?
        .clone();

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("Komodash")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// Window-event hook. On a `CloseRequested` event, consult preferences:
/// if `close_to_tray` is enabled (default), hide the window instead of
/// letting Tauri destroy it, and emit an event so the frontend can
/// show its one-shot notice on the first close.
fn handle_window_event(window: &tauri::Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        let prefs = match preferences::canonical_path() {
            Some(p) => preferences::load(&p),
            None => preferences::Preferences::default(),
        };
        if !prefs.close_to_tray {
            return;
        }
        api.prevent_close();
        let _ = window.hide();
        if !prefs.close_to_tray_notice_seen {
            let _ = window.app_handle().emit("komodash://close-to-tray-notice", ());
        }
    }
}

/// Run `komorebic enable-autostart` to plant the Startup-folder
/// shortcut so Komorebi launches on login.
#[tauri::command]
async fn enable_autostart(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let client = state.komorebic.clone();
    tokio::task::spawn_blocking(move || run_komorebic_subcommand(client.as_ref(), "enable-autostart"))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Run `komorebic disable-autostart`. Symmetric to [`enable_autostart`].
#[tauri::command]
async fn disable_autostart(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let client = state.komorebic.clone();
    tokio::task::spawn_blocking(move || run_komorebic_subcommand(client.as_ref(), "disable-autostart"))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

fn run_komorebic_subcommand(
    client: &dyn Komorebic,
    subcommand: &str,
) -> anyhow::Result<()> {
    let info = client
        .discover()
        .ok_or_else(|| anyhow::anyhow!("komorebic.exe could not be located"))?;
    let output = silent_command(&info.path)
        .arg(subcommand)
        .output()?;
    if !output.status.success() {
        anyhow::bail!(
            "komorebic {subcommand} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_monitor_as_bare_integer() {
        let raw = r#"{ "monitor": 1 }"#;
        let (idx, off) = parse_bar_monitor_target(raw).expect("parses");
        assert_eq!(idx, 1);
        assert_eq!(off.left, 0);
        assert_eq!(off.top, 0);
        assert_eq!(off.right, 0);
        assert_eq!(off.bottom, 0);
    }

    #[test]
    fn parses_monitor_as_object_with_offsets() {
        let raw = r#"{
            "monitor": {
                "index": 2,
                "work_area_offset": {
                    "left": 4, "top": 32, "right": 8, "bottom": 32
                }
            }
        }"#;
        let (idx, off) = parse_bar_monitor_target(raw).expect("parses");
        assert_eq!(idx, 2);
        assert_eq!(off.left, 4);
        assert_eq!(off.top, 32);
        assert_eq!(off.right, 8);
        assert_eq!(off.bottom, 32);
    }

    #[test]
    fn parses_monitor_as_object_with_no_offsets() {
        // Object form without `work_area_offset` — should still parse
        // the index and yield default (zero) offsets.
        let raw = r#"{ "monitor": { "index": 0 } }"#;
        let (idx, off) = parse_bar_monitor_target(raw).expect("parses");
        assert_eq!(idx, 0);
        assert_eq!(off.top, 0);
    }

    #[test]
    fn returns_none_when_monitor_absent() {
        let raw = r#"{ "font_size": 12 }"#;
        assert!(parse_bar_monitor_target(raw).is_none());
    }

    #[test]
    fn returns_none_on_unparseable_input() {
        assert!(parse_bar_monitor_target("not json at all").is_none());
    }
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
        .on_window_event(handle_window_event)
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

            // System tray (issue #72). Close-to-tray default-on; the
            // tray exposes Show / Quit so the user can resurrect or
            // exit the app without the main window.
            install_tray(app.handle())?;
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
            write_bar_config_merged,
            detect_unknown_fields,
            upgrade_komorebi_via_winget,
            upgrade_komorebi_via_scoop,
            toggle_pause,
            toggle_mouse_follows_focus,
            toggle_float_override,
            retile,
            focus_workspace,
            start_komorebi,
            stop_komorebi,
            apply_static_config,
            read_whkdrc,
            write_whkdrc,
            validate_hotkeys,
            apply_whkdrc,
            get_bar_schema,
            get_bar_field_catalog,
            apply_bar_config,
            reset_monitor_work_area_offset,
            get_monitor_dpi_scale,
            get_monitor_geometry,
            fetch_community_catalog,
            read_community_catalog,
            detect_first_run_state,
            write_starter_config,
            enable_autostart,
            disable_autostart,
            get_visible_windows,
            toggle_focused_window_float,
            close_focused_window,
            move_focused_window_to_workspace,
            get_preferences,
            set_close_to_tray,
            mark_close_to_tray_notice_seen,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
