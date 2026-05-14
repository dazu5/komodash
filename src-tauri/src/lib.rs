//! Komodash Tauri backend entrypoint.
//!
//! Composition root only: wires module instances into the Tauri app state
//! and registers `#[tauri::command]` handlers. Business logic lives in the
//! sibling modules (`komorebic`, `updates`, future: `live_state`,
//! `managed_config`, …).

pub mod komorebic;
pub mod updates;

use std::sync::Arc;
use std::time::Duration;

use komorebic::{Komorebic, KomorebiState, WinKomorebic};
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
}

impl AppState {
    /// Production wiring: real `komorebic.exe` shell-out + real process
    /// scan, real GitHub API call for the update check.
    fn production() -> Self {
        let user_agent = format!("komodash/{}", env!("CARGO_PKG_VERSION"));
        Self {
            komorebic: Arc::new(WinKomorebic),
            release_source: Arc::new(GithubReleaseSource {
                owner: "dazu5".into(),
                repo: "komodash".into(),
                user_agent,
            }),
        }
    }
}

/// Detect whether Komorebi is installed and running. Backs the Dashboard
/// status pill (issue #2).
#[tauri::command]
fn detect_komorebi(state: tauri::State<'_, AppState>) -> KomorebiState {
    komorebic::detect(state.komorebic.as_ref())
}

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
        let release = cached_or_fresh(&cache_path, UPDATE_CACHE_MAX_AGE, || source.fetch_latest())?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::production())
        .invoke_handler(tauri::generate_handler![detect_komorebi, check_komodash_update])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
