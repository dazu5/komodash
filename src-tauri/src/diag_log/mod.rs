//! Diagnostic info gathering for the "Copy diagnostic info" affordance
//! on the About page (issue #10, per ADR-0011 — local-only diagnostics,
//! no telemetry).
//!
//! Also owns the `tracing_subscriber` initialisation for the whole app:
//! daily-rolling log files at `%LOCALAPPDATA%\komodash\logs\` with
//! 7-day retention and an env-var-driven level filter.
//!
//! Everything in here is local-only. Nothing in this module makes
//! network calls or sends data anywhere — the diagnostic blob is
//! constructed in-process and returned to the frontend for the user
//! to copy and paste wherever *they* choose.

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::Result;
use chrono::{Local, NaiveDate};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

use crate::komorebic::Komorebic;

/// Filename prefix for the daily-rolling log files. The full filename is
/// `komodash-YYYY-MM-DD.log` (tracing-appender appends the date itself).
const LOG_PREFIX: &str = "komodash";

/// How many daily log files we keep on disk. Older ones are pruned on
/// startup so the directory does not grow unbounded.
const RETAIN_DAYS: i64 = 7;

/// Lines of the current-day log to include in the diagnostic blob.
const DIAGNOSTIC_LOG_TAIL_LINES: usize = 100;

/// Env-var name that overrides the default `INFO` log level. Accepts
/// the standard `tracing_subscriber::EnvFilter` syntax — `debug`,
/// `komodash=trace,info`, etc.
const LOG_LEVEL_ENV: &str = "KOMODASH_LOG";

/// Initialise the global `tracing` subscriber for the whole Komodash
/// process. Returns a [`WorkerGuard`] that must be held for the lifetime
/// of the program — when it drops, the non-blocking file appender stops
/// flushing.
///
/// Logs go to `<localappdata>/komodash/logs/komodash-YYYY-MM-DD.log`,
/// rolled daily. Logs older than [`RETAIN_DAYS`] are pruned at startup.
///
/// Returns `Ok(None)` (skipping subscriber setup) if we cannot resolve a
/// log directory — Komodash still runs, just without file logs.
pub fn init_tracing() -> Result<Option<WorkerGuard>> {
    let Some(log_dir) = log_dir() else {
        return Ok(None);
    };
    std::fs::create_dir_all(&log_dir)?;
    prune_old_logs(&log_dir, RETAIN_DAYS, Local::now().date_naive())?;

    let appender = rolling::daily(&log_dir, LOG_PREFIX);
    let (non_blocking, guard) = tracing_appender::non_blocking(appender);

    let filter = EnvFilter::try_from_env(LOG_LEVEL_ENV)
        .unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::registry()
        .with(filter)
        .with(
            fmt::layer()
                .with_writer(non_blocking)
                .with_ansi(false)
                .with_target(true),
        )
        .init();

    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        log_dir = %log_dir.display(),
        "komodash tracing initialised"
    );
    Ok(Some(guard))
}

/// Build the markdown blob for the About-page "Copy diagnostic info"
/// button. Everything in here stays on the user's machine; we never
/// send this anywhere.
pub fn build_diagnostic_info(komorebic: &dyn Komorebic) -> String {
    let komodash_version = env!("CARGO_PKG_VERSION");
    let komorebi_line = komorebic
        .discover()
        .map(|info| {
            format!(
                "**Komorebi:** {} ({})",
                info.version,
                info.path.display()
            )
        })
        .unwrap_or_else(|| "**Komorebi:** not detected".to_string());
    let os = os_version_line();
    let log_tail = recent_log_tail(DIAGNOSTIC_LOG_TAIL_LINES);
    let feature_flags = "_(none in v1)_";

    format!(
        "# Komodash diagnostic info\n\
         \n\
         **Komodash:** {komodash_version}\n\
         {komorebi_line}\n\
         **OS:** {os}\n\
         **Generated at:** {now}\n\
         \n\
         ## Active feature flags\n\
         \n\
         {feature_flags}\n\
         \n\
         ## Recent log (last {tail_lines} lines)\n\
         \n\
         ```\n\
         {log_tail}\n\
         ```\n",
        now = Local::now().format("%Y-%m-%d %H:%M:%S %z"),
        tail_lines = DIAGNOSTIC_LOG_TAIL_LINES,
    )
}

/// Pull `cmd /c ver` output to get the actual Windows version string —
/// more accurate than `GetVersionEx`, which returns 6.2.x for any
/// process without an explicit compatibility manifest.
fn os_version_line() -> String {
    if cfg!(windows) {
        match crate::komorebic::silent_command("cmd").args(["/c", "ver"]).output() {
            Ok(out) if out.status.success() => {
                let raw = String::from_utf8_lossy(&out.stdout);
                let trimmed = raw.trim();
                if trimmed.is_empty() {
                    "Windows (version unknown)".to_string()
                } else {
                    trimmed.to_string()
                }
            }
            _ => "Windows (version probe failed)".to_string(),
        }
    } else {
        format!(
            "{} (non-Windows host; Komodash is Windows-only)",
            std::env::consts::OS
        )
    }
}

/// Read the last `n` lines of today's log file, or a friendly fallback
/// when no log exists yet.
fn recent_log_tail(n: usize) -> String {
    let Some(log_dir) = log_dir() else {
        return "(no log directory)".into();
    };
    let today = Local::now().format(&format!("{LOG_PREFIX}.%Y-%m-%d")).to_string();
    let path = log_dir.join(today);
    let Ok(contents) = std::fs::read_to_string(&path) else {
        return "(no log entries today)".into();
    };
    let lines: Vec<&str> = contents.lines().collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

/// `%LOCALAPPDATA%\komodash\logs\`. `None` when no local-data dir is
/// resolvable — degrades to "no file logs" rather than crashing.
fn log_dir() -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join("komodash").join("logs"))
}

/// Remove daily-log files whose date is older than `retain_days` from
/// `today`. Filenames follow the tracing-appender daily pattern
/// `<prefix>.YYYY-MM-DD`. Files not matching the pattern are left alone.
fn prune_old_logs(dir: &Path, retain_days: i64, today: NaiveDate) -> Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir)? {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().to_string();
        if let Some(date) = parse_log_date(&name) {
            let age = (today - date).num_days();
            // `>=` so that "keep the last 7 daily files" means today + 6
            // previous days = 7 in total; the 8th file (age 7d) is pruned.
            if age >= retain_days {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    Ok(())
}

/// Extract the `YYYY-MM-DD` suffix from `komodash.YYYY-MM-DD` filenames
/// (tracing-appender's daily-rotation convention).
fn parse_log_date(filename: &str) -> Option<NaiveDate> {
    let suffix = filename.strip_prefix(LOG_PREFIX)?.strip_prefix('.')?;
    NaiveDate::parse_from_str(suffix, "%Y-%m-%d").ok()
}

/// Number of seconds tracing-appender's non-blocking sender flushes on
/// drop. Exposed only so tests can validate the constant is sane.
#[allow(dead_code)]
pub const SHUTDOWN_FLUSH: Duration = Duration::from_millis(500);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::komorebic::{KomorebicInfo, MIN_SUPPORTED_VERSION};
    use chrono::NaiveDate;
    use std::fs;
    use tempfile::tempdir;

    /// Local fake — kept module-private to avoid cross-module test fixture
    /// drift. Mirrors the trait surface only insofar as `build_diagnostic_info`
    /// uses it (currently just `discover`).
    struct FakeKomorebic {
        info: Option<KomorebicInfo>,
    }

    impl FakeKomorebic {
        fn installed(version: &str) -> Self {
            Self {
                info: Some(KomorebicInfo {
                    path: PathBuf::from("C:/test/komorebic.exe"),
                    version: version.into(),
                    supported: version >= MIN_SUPPORTED_VERSION,
                }),
            }
        }
        fn not_detected() -> Self {
            Self { info: None }
        }
    }

    impl Komorebic for FakeKomorebic {
        fn discover(&self) -> Option<KomorebicInfo> {
            self.info.clone()
        }
        fn is_running(&self) -> bool {
            false
        }
    }

    #[test]
    fn parses_canonical_daily_log_filename() {
        assert_eq!(
            parse_log_date("komodash.2026-05-14"),
            Some(NaiveDate::from_ymd_opt(2026, 5, 14).unwrap()),
        );
    }

    #[test]
    fn rejects_non_komodash_filenames() {
        assert!(parse_log_date("other.2026-05-14").is_none());
        assert!(parse_log_date("garbage").is_none());
    }

    #[test]
    fn rejects_bad_date_suffix() {
        assert!(parse_log_date("komodash.2026-13-99").is_none());
        assert!(parse_log_date("komodash.not-a-date").is_none());
    }

    #[test]
    fn prune_removes_files_older_than_retention() {
        let dir = tempdir().unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 5, 14).unwrap();
        let keep = ["komodash.2026-05-14", "komodash.2026-05-08"]; // today + 6d ago
        let prune = ["komodash.2026-05-07", "komodash.2026-04-01"]; // 7d, 43d ago
        for name in keep.iter().chain(prune.iter()) {
            fs::write(dir.path().join(name), "stub").unwrap();
        }
        prune_old_logs(dir.path(), RETAIN_DAYS, today).unwrap();
        for name in keep {
            assert!(dir.path().join(name).exists(), "{name} should be kept");
        }
        for name in prune {
            assert!(!dir.path().join(name).exists(), "{name} should be pruned");
        }
    }

    #[test]
    fn prune_leaves_non_komodash_files_alone() {
        let dir = tempdir().unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 5, 14).unwrap();
        fs::write(dir.path().join("random.log"), "x").unwrap();
        fs::write(dir.path().join("notes.md"), "x").unwrap();
        prune_old_logs(dir.path(), RETAIN_DAYS, today).unwrap();
        assert!(dir.path().join("random.log").exists());
        assert!(dir.path().join("notes.md").exists());
    }

    #[test]
    fn prune_handles_missing_directory() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join("nope");
        prune_old_logs(&missing, RETAIN_DAYS, Local::now().date_naive()).unwrap();
        // No panic, no error.
    }

    #[test]
    fn diagnostic_includes_required_sections() {
        let komorebic = FakeKomorebic::not_detected();
        let blob = build_diagnostic_info(&komorebic);
        assert!(blob.contains("# Komodash diagnostic info"));
        assert!(blob.contains("**Komodash:**"));
        assert!(blob.contains("**Komorebi:**"));
        assert!(blob.contains("**OS:**"));
        assert!(blob.contains("## Recent log"));
        assert!(blob.contains("## Active feature flags"));
    }

    #[test]
    fn diagnostic_reflects_komorebi_detection_state() {
        let detected = FakeKomorebic::installed("0.1.41");
        let blob = build_diagnostic_info(&detected);
        assert!(blob.contains("0.1.41"));

        let absent = FakeKomorebic::not_detected();
        let blob = build_diagnostic_info(&absent);
        assert!(blob.contains("not detected"));
    }
}
