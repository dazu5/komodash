//! Wrapper around the `komorebic.exe` CLI.
//!
//! This is the only place in the codebase that knows where `komorebic.exe`
//! lives, how to invoke it, and how to parse its output. Every other module
//! talks to Komorebi through the [`Komorebic`] trait so the binary can be
//! faked in tests.
//!
//! Per [ADR-0007](../../../docs/adr/0007-install-komorebi-via-winget.md),
//! Komodash declares a minimum-supported Komorebi version
//! ([`MIN_SUPPORTED_VERSION`]). Older installs surface as "unsupported"
//! through [`KomorebicInfo::supported`] so the UI can prompt the user
//! to upgrade.

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::Result;
use once_cell::sync::Lazy;
use regex::Regex;
use semver::Version;
use serde::Serialize;

/// Minimum-supported Komorebi version per ADR-0007.
pub const MIN_SUPPORTED_VERSION: &str = "0.1.41";

/// The two places Komodash looks for `komorebic.exe`, in priority order.
///
/// First `which()` is consulted (handles winget shim, Scoop shim, anything
/// else on PATH); then the Komorebi installer's default location is checked
/// as a fallback for users who installed but never restarted their shell.
const FALLBACK_INSTALL_PATH: &str = r"C:\Program Files\komorebi\bin\komorebic.exe";

/// `komorebic --version` first line: `komorebic 0.1.41`
static VERSION_LINE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^komorebic\s+(\d+\.\d+\.\d+)").expect("static regex compiles"));

/// What [`Komorebic::discover`] returns when a working `komorebic.exe` is found.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct KomorebicInfo {
    /// Absolute path to the binary we resolved.
    pub path: PathBuf,
    /// Parsed semver from `komorebic --version`.
    pub version: String,
    /// Whether `version >= MIN_SUPPORTED_VERSION` (see ADR-0007).
    pub supported: bool,
}

/// What `detect_komorebi` returns to the frontend.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct KomorebiState {
    /// `Some` iff a working `komorebic.exe` could be discovered.
    pub installed: Option<KomorebicInfo>,
    /// `true` iff `komorebi.exe` (the long-running WM process) is alive.
    pub running: bool,
}

/// The trait every consumer talks to. Implemented by [`WinKomorebic`] in
/// production and by fakes in tests.
///
/// All optional methods (`help`, `help_for_subcommand`, `subscribe_pipe`,
/// `unsubscribe_pipe`, `static_config_path`, `bar_config_path`,
/// `whkdrc_path`, `static_config_schema`, `toggle_pause`,
/// `toggle_mouse_follows_focus`, `toggle_float_override`, `retile`,
/// `focus_workspace`, `start`, `stop`, `replace_configuration`,
/// `bar_config_schema`, `restart_bar`) carry default-bail impls so
/// pre-existing fakes that only implement
/// `discover` / `is_running` keep compiling.
pub trait Komorebic: Send + Sync {
    /// Locate `komorebic.exe` and read its version. Returns `None` if the
    /// binary cannot be found or fails `--version`.
    fn discover(&self) -> Option<KomorebicInfo>;

    /// `true` iff the long-running `komorebi.exe` process is currently
    /// alive on this machine. Independent of [`discover`]: the CLI binary
    /// can be present without the daemon running.
    fn is_running(&self) -> bool;

    /// Raw stdout of `komorebic --help`. Used by the
    /// [`crate::command_catalog`] builder to discover available subcommands.
    fn help(&self) -> Result<String> {
        anyhow::bail!("help is not implemented for this Komorebic")
    }

    /// Raw stdout of `komorebic <subcommand> --help`. Used by the
    /// [`crate::command_catalog`] builder to learn per-subcommand args.
    fn help_for_subcommand(&self, _subcommand: &str) -> Result<String> {
        anyhow::bail!("help_for_subcommand is not implemented for this Komorebic")
    }

    /// Register a named-pipe subscriber with the running Komorebi.
    /// `name` is the bare pipe name (no `\\.\pipe\` prefix). After
    /// success, Komorebi will connect to `\\.\pipe\<name>` and write
    /// JSON `Notification` events line-by-line.
    fn subscribe_pipe(&self, _name: &str) -> Result<()> {
        anyhow::bail!("subscribe_pipe is not implemented for this Komorebic")
    }

    /// Unregister a previously-subscribed pipe so Komorebi stops trying
    /// to push to it. Idempotent at the Komorebic level.
    fn unsubscribe_pipe(&self, _name: &str) -> Result<()> {
        anyhow::bail!("unsubscribe_pipe is not implemented for this Komorebic")
    }

    /// Path to the **Static configuration** file as reported by
    /// `komorebic configuration`. Typically `~/komorebi.json`.
    fn static_config_path(&self) -> Result<PathBuf> {
        anyhow::bail!("static_config_path is not implemented for this Komorebic")
    }

    /// Path to the **Bar configuration** file as reported by
    /// `komorebic bar-configuration`. Typically `~/komorebi.bar.json`.
    fn bar_config_path(&self) -> Result<PathBuf> {
        anyhow::bail!("bar_config_path is not implemented for this Komorebic")
    }

    /// Path to the `whkdrc` file as reported by `komorebic whkdrc`.
    /// Typically `~/.config/whkdrc`.
    fn whkdrc_path(&self) -> Result<PathBuf> {
        anyhow::bail!("whkdrc_path is not implemented for this Komorebic")
    }

    /// Raw JSON Schema for the **Static configuration** as emitted by
    /// `komorebic static-config-schema`. The string is returned verbatim
    /// so the schema cache can stash it and Komodash never tries to
    /// reshape what Komorebi publishes (per ADR-0002).
    fn static_config_schema(&self) -> Result<String> {
        anyhow::bail!("static_config_schema is not implemented for this Komorebic")
    }

    // ---- Issue #14: runtime quick-toggles --------------------------------

    /// Toggle Komorebi's global pause state.
    fn toggle_pause(&self) -> Result<()> {
        anyhow::bail!("toggle_pause is not implemented for this Komorebic")
    }

    /// Toggle the "mouse follows focus" behaviour at runtime. This is
    /// a runtime override of the static config setting; the config file
    /// itself is not touched (that path is the Configuration editor in
    /// #18). Lasts until Komorebi restarts.
    fn toggle_mouse_follows_focus(&self) -> Result<()> {
        anyhow::bail!("toggle_mouse_follows_focus is not implemented for this Komorebic")
    }

    /// Toggle Komorebi's "float override" — when on, every new window is
    /// floated rather than tiled. Runtime-only (same lifetime semantics
    /// as `toggle_mouse_follows_focus`).
    fn toggle_float_override(&self) -> Result<()> {
        anyhow::bail!("toggle_float_override is not implemented for this Komorebic")
    }

    /// Re-tile every managed window on every workspace. Used as a
    /// recovery affordance when layout state has drifted (e.g. after a
    /// resolution change). Idempotent and fast.
    fn retile(&self) -> Result<()> {
        anyhow::bail!("retile is not implemented for this Komorebic")
    }

    /// Focus the workspace at `workspace_index` on the monitor at
    /// `monitor_index`. Both indices are zero-based and match the
    /// `Ring<Workspace>.elements` order in the **Live state**
    /// snapshot — so the Dashboard tree can pass them through directly
    /// (issue #13).
    fn focus_workspace(&self, _monitor_index: usize, _workspace_index: usize) -> Result<()> {
        anyhow::bail!("focus_workspace is not implemented for this Komorebic")
    }

    /// Start the Komorebi daemon. `with_whkd` toggles `--whkd` so whkd
    /// also launches; `with_bar` toggles `--bar` so the status bar
    /// daemon launches. Both default to `true` from the frontend per
    /// issue #15.
    ///
    /// Returns once `komorebic start` exits — Komorebi is still warming
    /// up at that point. The frontend should poll `is_running` (or
    /// wait for the Live state subscription to reconnect) to know when
    /// the daemon is actually serving.
    fn start(&self, _with_whkd: bool, _with_bar: bool) -> Result<()> {
        anyhow::bail!("start is not implemented for this Komorebic")
    }

    /// Stop the Komorebi daemon. Idempotent — calling this when Komorebi
    /// is not running succeeds quietly. Used by Restart (after a crash)
    /// and by the Dashboard's Stop affordance.
    fn stop(&self) -> Result<()> {
        anyhow::bail!("stop is not implemented for this Komorebic")
    }

    /// Tell the running Komorebi daemon to reload the Static configuration
    /// from disk (hot-reload, per ADR-0006). Called after every settled
    /// edit in the Live-apply path (issue #18). The path is the live
    /// `komorebi.json` location; Komorebi reads it on this call.
    ///
    /// Errors surface verbatim — the frontend translates them into
    /// friendly inline messages.
    fn replace_configuration(&self, _path: &Path) -> Result<()> {
        anyhow::bail!("replace_configuration is not implemented for this Komorebic")
    }

    /// Raw JSON Schema for the **Bar configuration** as emitted by
    /// `komorebi-bar.exe --schema` (per [`crate::schema_cache`]'s
    /// pattern for the static schema). Issue #19.
    fn bar_config_schema(&self) -> Result<String> {
        anyhow::bail!("bar_config_schema is not implemented for this Komorebic")
    }

    /// Restart the Komorebi bar daemon (issue #19, per ADR-0006
    /// buffered-apply). The bar doesn't hot-reload — kill `komorebi-
    /// bar.exe` and re-launch via `komorebic start --bar`. Same
    /// idempotent pattern as `restart_whkd`.
    fn restart_bar(&self) -> Result<()> {
        anyhow::bail!("restart_bar is not implemented for this Komorebic")
    }
}

/// Production implementation.
pub struct WinKomorebic;

impl WinKomorebic {
    /// Resolve `komorebic.exe` via PATH first, fallback path second.
    fn locate(&self) -> Option<PathBuf> {
        if let Ok(path) = which::which("komorebic.exe") {
            return Some(path);
        }
        let fallback = PathBuf::from(FALLBACK_INSTALL_PATH);
        fallback.exists().then_some(fallback)
    }

    /// Read `komorebic --version` and parse out the first-line version.
    fn read_version(&self, path: &Path) -> Result<String> {
        let output = Command::new(path).arg("--version").output()?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        parse_version(&stdout)
            .ok_or_else(|| anyhow::anyhow!("could not parse version from komorebic --version"))
    }
}

impl Komorebic for WinKomorebic {
    fn discover(&self) -> Option<KomorebicInfo> {
        let path = self.locate()?;
        let version = self.read_version(&path).ok()?;
        Some(KomorebicInfo {
            supported: is_supported(&version),
            path,
            version,
        })
    }

    fn is_running(&self) -> bool {
        use sysinfo::{ProcessRefreshKind, RefreshKind, System};
        // `new()` here = empty refresh spec (nothing kept by default); the
        // builder then opts back into process-existence refresh. We don't
        // need CPU/memory data — only the name list — so this is the
        // cheapest refresh that still answers the question.
        let sys = System::new_with_specifics(
            RefreshKind::new().with_processes(ProcessRefreshKind::new()),
        );
        sys.processes().values().any(|p| {
            p.name()
                .to_string_lossy()
                .eq_ignore_ascii_case("komorebi.exe")
        })
    }

    fn help(&self) -> Result<String> {
        self.run_help(&[])
    }

    fn help_for_subcommand(&self, subcommand: &str) -> Result<String> {
        self.run_help(&[subcommand])
    }

    fn subscribe_pipe(&self, name: &str) -> Result<()> {
        self.run_subcommand(&["subscribe-pipe", name])
    }

    fn unsubscribe_pipe(&self, name: &str) -> Result<()> {
        self.run_subcommand(&["unsubscribe-pipe", name])
    }

    fn static_config_path(&self) -> Result<PathBuf> {
        self.subcommand_path("configuration")
    }

    fn bar_config_path(&self) -> Result<PathBuf> {
        self.subcommand_path("bar-configuration")
    }

    fn whkdrc_path(&self) -> Result<PathBuf> {
        self.subcommand_path("whkdrc")
    }

    fn static_config_schema(&self) -> Result<String> {
        let path = self
            .locate()
            .ok_or_else(|| anyhow::anyhow!("komorebic.exe could not be located"))?;
        let output = Command::new(&path).arg("static-config-schema").output()?;
        if !output.status.success() {
            anyhow::bail!(
                "komorebic static-config-schema failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    fn toggle_pause(&self) -> Result<()> {
        self.run_subcommand(&["toggle-pause"])
    }

    fn toggle_mouse_follows_focus(&self) -> Result<()> {
        self.run_subcommand(&["toggle-mouse-follows-focus"])
    }

    fn toggle_float_override(&self) -> Result<()> {
        self.run_subcommand(&["toggle-float-override"])
    }

    fn retile(&self) -> Result<()> {
        self.run_subcommand(&["retile"])
    }

    fn focus_workspace(&self, monitor_index: usize, workspace_index: usize) -> Result<()> {
        let monitor = monitor_index.to_string();
        let workspace = workspace_index.to_string();
        self.run_subcommand(&["focus-workspace", &monitor, &workspace])
    }

    fn start(&self, with_whkd: bool, with_bar: bool) -> Result<()> {
        let mut args: Vec<&str> = vec!["start"];
        if with_whkd {
            args.push("--whkd");
        }
        if with_bar {
            args.push("--bar");
        }
        self.run_subcommand(&args)
    }

    fn stop(&self) -> Result<()> {
        // Idempotent at our layer: if Komorebi isn't running, `komorebic
        // stop` exits non-zero with "Komorebi is not running" — treat
        // that as success.
        let path = self
            .locate()
            .ok_or_else(|| anyhow::anyhow!("komorebic.exe could not be located"))?;
        let output = Command::new(&path).arg("stop").output()?;
        if output.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
        if stderr.contains("not running") || stderr.contains("could not connect") {
            return Ok(());
        }
        anyhow::bail!(
            "komorebic stop failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }

    fn replace_configuration(&self, config_path: &Path) -> Result<()> {
        let config_str = config_path
            .to_str()
            .ok_or_else(|| anyhow::anyhow!("config path is not valid UTF-8"))?;
        self.run_subcommand(&["replace-configuration", config_str])
    }

    fn bar_config_schema(&self) -> Result<String> {
        // `komorebi-bar.exe` sits next to `komorebic.exe` in the install
        // dir. Locate it from komorebic's path so we work for winget,
        // Scoop, or manual installs that may not have it on PATH.
        let bar_path = self.locate_bar()?;
        let output = Command::new(&bar_path).arg("--schema").output()?;
        if !output.status.success() {
            anyhow::bail!(
                "komorebi-bar --schema failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    fn restart_bar(&self) -> Result<()> {
        // Same shape as `restart_whkd` from #20.
        let _ = Command::new("taskkill")
            .args(["/F", "/IM", "komorebi-bar.exe"])
            .output();
        std::thread::sleep(std::time::Duration::from_millis(150));
        let path = self
            .locate()
            .ok_or_else(|| anyhow::anyhow!("komorebic.exe could not be located"))?;
        let output = Command::new(&path).args(["start", "--bar"]).output()?;
        if !output.status.success() {
            anyhow::bail!(
                "komorebic start --bar failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
        Ok(())
    }
}

impl WinKomorebic {
    /// Find `komorebi-bar.exe`. PATH first (winget shim, Scoop shim);
    /// fallback to the install dir alongside `komorebic.exe`.
    fn locate_bar(&self) -> Result<PathBuf> {
        if let Ok(p) = which::which("komorebi-bar.exe") {
            return Ok(p);
        }
        // Same install dir as komorebic — `<install>\bin\komorebic.exe`
        // → `<install>\bin\komorebi-bar.exe`.
        if let Some(komorebic) = self.locate() {
            if let Some(dir) = komorebic.parent() {
                let candidate = dir.join("komorebi-bar.exe");
                if candidate.exists() {
                    return Ok(candidate);
                }
            }
        }
        anyhow::bail!("komorebi-bar.exe could not be located")
    }
}

impl WinKomorebic {
    /// Invoke `komorebic.exe [extra...] --help` and return its stdout as
    /// a UTF-8 string. Used by both `help()` (no extra args) and
    /// `help_for_subcommand()` (single subcommand name).
    fn run_help(&self, extra: &[&str]) -> Result<String> {
        let path = self
            .locate()
            .ok_or_else(|| anyhow::anyhow!("komorebic.exe could not be located"))?;
        let mut cmd = Command::new(&path);
        for arg in extra {
            cmd.arg(arg);
        }
        cmd.arg("--help");
        let output = cmd.output()?;
        // clap writes help to stdout, but we accept either channel so a
        // future tooling change doesn't silently break us.
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        if stdout.trim().is_empty() {
            Ok(String::from_utf8_lossy(&output.stderr).to_string())
        } else {
            Ok(stdout)
        }
    }

    /// Shell out to `komorebic.exe <args...>` and surface any non-zero
    /// exit as an error. Used by the pipe register / unregister methods
    /// which don't need stdout, only success/failure.
    fn run_subcommand(&self, args: &[&str]) -> Result<()> {
        let path = self
            .locate()
            .ok_or_else(|| anyhow::anyhow!("komorebic.exe could not be located"))?;
        let output = Command::new(&path).args(args).output()?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("komorebic {} failed: {}", args.join(" "), stderr.trim());
        }
        Ok(())
    }

    /// Shell out to `komorebic <subcommand>` (one of the path-reporting
    /// subcommands: `configuration`, `bar-configuration`, `whkdrc`) and
    /// return the trimmed stdout as a `PathBuf`. Empty output is treated
    /// as "the config file does not yet exist at the canonical path Komorebi
    /// expects" — Komodash will still write to that path on first save.
    ///
    /// When the subcommand reports nothing, the canonical default for each
    /// kind is returned. This mirrors `komorebic quickstart` behaviour, so
    /// first-run Komodash on a clean machine can save somewhere sensible.
    fn subcommand_path(&self, sub: &str) -> Result<PathBuf> {
        let komorebic = self
            .locate()
            .ok_or_else(|| anyhow::anyhow!("komorebic.exe could not be located"))?;
        let output = Command::new(&komorebic).arg(sub).output()?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stdout.is_empty() {
            return Ok(PathBuf::from(stdout));
        }
        // Empty stdout: fall back to the documented canonical path so we
        // have a place to write.
        canonical_path_for(sub)
    }
}

/// Canonical default for each path subcommand when `komorebic` reports
/// nothing (e.g. fresh install with no config yet written).
fn canonical_path_for(sub: &str) -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("no home directory"))?;
    Ok(match sub {
        "configuration" => home.join("komorebi.json"),
        "bar-configuration" => home.join("komorebi.bar.json"),
        "whkdrc" => home.join(".config").join("whkdrc"),
        other => anyhow::bail!("unknown path subcommand: {other}"),
    })
}

/// Snapshot the current `(installed, running)` state. The default Komorebic
/// impl ([`WinKomorebic`]) is wired in `lib.rs`; tests supply their own.
pub fn detect(client: &dyn Komorebic) -> KomorebiState {
    KomorebiState {
        installed: client.discover(),
        running: client.is_running(),
    }
}

/// Extract `0.1.41` from `komorebic --version` output.
///
/// Public so the test module and any future tooling can reuse the same regex.
pub fn parse_version(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .find_map(|line| VERSION_LINE.captures(line))
        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
}

/// `true` iff `version` is at least [`MIN_SUPPORTED_VERSION`].
fn is_supported(version: &str) -> bool {
    let min = Version::parse(MIN_SUPPORTED_VERSION).expect("min version is valid semver");
    Version::parse(version).map(|v| v >= min).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    /// Fake double for the [`Komorebic`] trait. Each method's return value
    /// is configurable at construction time so individual tests stay
    /// readable without builder overhead.
    struct FakeKomorebic {
        discover_result: Option<KomorebicInfo>,
        is_running_result: bool,
        discover_calls: Cell<u32>,
    }

    impl FakeKomorebic {
        fn new(discover: Option<KomorebicInfo>, running: bool) -> Self {
            Self {
                discover_result: discover,
                is_running_result: running,
                discover_calls: Cell::new(0),
            }
        }
    }

    // SAFETY: the Cell makes FakeKomorebic non-Sync; this is fine for
    // single-threaded test use. We unsafely impl Sync because the trait
    // requires it and tests never share the fake across threads.
    unsafe impl Sync for FakeKomorebic {}

    impl Komorebic for FakeKomorebic {
        fn discover(&self) -> Option<KomorebicInfo> {
            self.discover_calls.set(self.discover_calls.get() + 1);
            self.discover_result.clone()
        }
        fn is_running(&self) -> bool {
            self.is_running_result
        }
    }

    fn info(version: &str) -> KomorebicInfo {
        KomorebicInfo {
            path: PathBuf::from("C:/test/komorebic.exe"),
            version: version.into(),
            supported: is_supported(version),
        }
    }

    #[test]
    fn detect_reports_installed_and_running_when_both_true() {
        let fake = FakeKomorebic::new(Some(info("0.1.41")), true);
        let state = detect(&fake);
        assert_eq!(state.installed.as_ref().map(|i| i.version.as_str()), Some("0.1.41"));
        assert!(state.running);
    }

    #[test]
    fn detect_reports_not_installed_when_discover_fails() {
        let fake = FakeKomorebic::new(None, false);
        let state = detect(&fake);
        assert!(state.installed.is_none());
        assert!(!state.running);
    }

    #[test]
    fn detect_reports_installed_but_not_running() {
        let fake = FakeKomorebic::new(Some(info("0.1.41")), false);
        let state = detect(&fake);
        assert!(state.installed.is_some());
        assert!(!state.running);
    }

    #[test]
    fn detect_invokes_discover_exactly_once_per_call() {
        let fake = FakeKomorebic::new(Some(info("0.1.41")), true);
        let _ = detect(&fake);
        let _ = detect(&fake);
        assert_eq!(fake.discover_calls.get(), 2);
    }

    #[test]
    fn parses_version_from_real_komorebic_output() {
        // The real `komorebic --version` output sampled from v0.1.41.
        let stdout = "komorebic 0.1.41\ntag:v0.1.41\ncommit_hash:24c0ce0b\nbuild_time:2026-05-03 20:22:26 +00:00\nbuild_env:rustc 1.95.0 (59807616e 2026-04-14),stable-x86_64-pc-windows-msvc\n";
        assert_eq!(parse_version(stdout), Some("0.1.41".into()));
    }

    #[test]
    fn parses_version_from_minimal_output() {
        assert_eq!(parse_version("komorebic 0.2.0\n"), Some("0.2.0".into()));
    }

    #[test]
    fn returns_none_when_version_line_missing() {
        assert_eq!(parse_version("garbage\nnonsense\n"), None);
    }

    #[test]
    fn returns_none_on_empty_output() {
        assert_eq!(parse_version(""), None);
    }

    #[test]
    fn min_supported_version_is_supported() {
        assert!(is_supported("0.1.41"));
    }

    #[test]
    fn newer_version_is_supported() {
        assert!(is_supported("0.2.0"));
        assert!(is_supported("1.0.0"));
    }

    #[test]
    fn older_version_is_not_supported() {
        assert!(!is_supported("0.1.40"));
        assert!(!is_supported("0.1.0"));
    }

    #[test]
    fn malformed_version_is_not_supported() {
        assert!(!is_supported("not-a-version"));
        assert!(!is_supported(""));
    }

    #[test]
    fn info_carries_supported_flag() {
        let supported = info("0.1.41");
        assert!(supported.supported);
        let unsupported = info("0.1.40");
        assert!(!unsupported.supported);
    }
}
