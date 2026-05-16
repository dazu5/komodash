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
pub mod schema_cache;
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
    tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        // 1. Read the saved bar config so we know the target monitor
        //    and offsets to apply directly.
        let raw = std::fs::read_to_string(&path).unwrap_or_default();
        let target = parse_bar_monitor_target(&raw);

        // 2. Restart the bar — gives the user the visual relocation.
        client.restart_bar()?;

        // 3. Push the work-area reservation directly. Best-effort: if
        //    Komorebi isn't running, log and continue.
        if let Some((idx, offset)) = target {
            let _ = client.monitor_work_area_offset(
                idx,
                offset.left,
                offset.top,
                offset.right,
                offset.bottom,
            );
            // 4. Force a re-tile so existing windows reflow.
            let _ = client.retile();
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// Per-monitor work-area offset shape used in `komorebi.bar.json`.
/// Defaults to zeros so an integer-only `monitor: N` config still
/// produces a usable (no-reservation) tuple.
#[derive(Debug, Default, Clone, Copy)]
struct BarMonitorOffset {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

/// Pull the bar's target monitor index + `work_area_offset` out of a
/// `komorebi.bar.json` blob. The `monitor` field is an anyOf union:
/// either a bare integer index OR `{index, work_area_offset?}`.
/// Returns `None` if the field is absent or unparseable.
fn parse_bar_monitor_target(raw: &str) -> Option<(u32, BarMonitorOffset)> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    let m = v.get("monitor")?;
    if let Some(i) = m.as_u64() {
        return Some((i as u32, BarMonitorOffset::default()));
    }
    if let Some(obj) = m.as_object() {
        let idx = obj.get("index")?.as_u64()? as u32;
        let mut off = BarMonitorOffset::default();
        if let Some(o) = obj.get("work_area_offset").and_then(|v| v.as_object()) {
            off.left = o.get("left").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            off.top = o.get("top").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            off.right = o.get("right").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            off.bottom = o.get("bottom").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
        }
        return Some((idx, off));
    }
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
        let output = std::process::Command::new(&info.path)
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
            fetch_community_catalog,
            read_community_catalog,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
