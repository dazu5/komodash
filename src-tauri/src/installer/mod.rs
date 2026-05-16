//! Detect host package managers (winget, Scoop) and shell out to them to
//! install Komorebi. Per [ADR-0007](../../../docs/adr/0007-install-komorebi-via-winget.md):
//! winget is preferred, Scoop is the fallback, and neither is *installed*
//! by Komodash — only invoked.
//!
//! Streaming output is a callback parameter (`FnMut(&str)`) rather than a
//! trait object so the Tauri command can wire it directly to a Tauri
//! event emitter without ceremony. Tests pass a `Vec<String>` collector
//! to assert what the command spec ended up sending.

use std::path::PathBuf;

use anyhow::Result;
use serde::Serialize;

/// Which package manager we're talking to.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PackageManagerKind {
    Winget,
    Scoop,
}

/// A package manager Komodash discovered on the host.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PackageManager {
    pub kind: PackageManagerKind,
    pub path: PathBuf,
}

/// Outcome of an install invocation. Streaming log lines are delivered
/// out-of-band via the callback — this struct just records the verdict.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct InstallResult {
    pub success: bool,
    pub exit_code: i32,
}

/// Detect available package managers on the host, in preference order
/// (winget first, Scoop second). An empty vec means neither is on PATH
/// — Komodash falls back to the "install Komorebi yourself" doc link
/// page in that case.
pub fn available_package_managers() -> Vec<PackageManager> {
    let mut out = Vec::new();
    if let Ok(path) = which::which("winget") {
        out.push(PackageManager {
            kind: PackageManagerKind::Winget,
            path,
        });
    }
    if let Ok(path) = which::which("scoop") {
        out.push(PackageManager {
            kind: PackageManagerKind::Scoop,
            path,
        });
    }
    out
}

/// Pure: the `(binary, args)` Komodash invokes to install Komorebi via
/// `manager`. Exposed for unit testing — the actual subprocess plumbing
/// uses this same construction.
pub fn install_command(manager: PackageManagerKind) -> (&'static str, &'static [&'static str]) {
    match manager {
        PackageManagerKind::Winget => (
            "winget",
            &[
                "install",
                "LGUG2Z.komorebi",
                "--silent",
                "--accept-package-agreements",
                "--accept-source-agreements",
            ],
        ),
        PackageManagerKind::Scoop => ("scoop", &["install", "extras/komorebi"]),
    }
}

/// Pure: the `(binary, args)` Komodash invokes to **upgrade** an
/// already-installed Komorebi via `manager`. The verb differs from
/// `install_command` — winget uses `upgrade`, Scoop uses `update` —
/// and Scoop's update only takes the package name (no bucket prefix).
/// Issue #16.
pub fn upgrade_command(manager: PackageManagerKind) -> (&'static str, &'static [&'static str]) {
    match manager {
        PackageManagerKind::Winget => (
            "winget",
            &[
                "upgrade",
                "LGUG2Z.komorebi",
                "--silent",
                "--accept-package-agreements",
                "--accept-source-agreements",
            ],
        ),
        PackageManagerKind::Scoop => ("scoop", &["update", "komorebi"]),
    }
}

/// Run the install command synchronously. `on_line` is called once per
/// line of combined stdout/stderr output, in the order it arrives.
/// Returns an [`InstallResult`] reflecting the child's exit status.
///
/// Note: invoked from a `tokio::task::spawn_blocking` context by the
/// Tauri command — this function itself is sync and does not need a
/// runtime.
pub fn install_komorebi<F>(manager: PackageManagerKind, on_line: F) -> Result<InstallResult>
where
    F: FnMut(&str),
{
    let (cmd, args) = install_command(manager);
    run_streaming(cmd, args, on_line)
}

/// Run the upgrade command synchronously. Same streaming semantics as
/// [`install_komorebi`]. Issue #16.
pub fn upgrade_komorebi<F>(manager: PackageManagerKind, on_line: F) -> Result<InstallResult>
where
    F: FnMut(&str),
{
    let (cmd, args) = upgrade_command(manager);
    run_streaming(cmd, args, on_line)
}

/// Shared subprocess-with-streaming helper used by both install and
/// upgrade paths. Reads stdout then stderr line by line.
fn run_streaming<F>(cmd: &str, args: &[&str], mut on_line: F) -> Result<InstallResult>
where
    F: FnMut(&str),
{
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};

    let mut child = Command::new(cmd)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines().flatten() {
            on_line(&line);
        }
    }
    if let Some(stderr) = child.stderr.take() {
        for line in BufReader::new(stderr).lines().flatten() {
            on_line(&line);
        }
    }

    let status = child.wait()?;
    Ok(InstallResult {
        success: status.success(),
        exit_code: status.code().unwrap_or(-1),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn winget_upgrade_uses_upgrade_verb() {
        let (cmd, args) = upgrade_command(PackageManagerKind::Winget);
        assert_eq!(cmd, "winget");
        assert_eq!(args[0], "upgrade", "winget verb must be `upgrade`, not `install`");
        assert!(args.contains(&"LGUG2Z.komorebi"));
        // Silent + accept-* must be present for the same reason as install:
        // an interactive prompt would hang the streaming reader forever.
        assert!(args.contains(&"--silent"));
        assert!(args.contains(&"--accept-package-agreements"));
    }

    #[test]
    fn scoop_upgrade_uses_update_verb_and_bare_name() {
        let (cmd, args) = upgrade_command(PackageManagerKind::Scoop);
        assert_eq!(cmd, "scoop");
        assert_eq!(args[0], "update");
        // Scoop's `update` takes the bare package name, not the bucket/name
        // form `install` accepts. Drifting from that would just no-op.
        assert_eq!(args[1], "komorebi");
        assert!(
            !args.contains(&"extras/komorebi"),
            "scoop update takes bare name; bucket prefix is for install only"
        );
    }

    #[test]
    fn winget_install_command_is_silent_and_accepts_agreements() {
        let (cmd, args) = install_command(PackageManagerKind::Winget);
        assert_eq!(cmd, "winget");
        assert!(args.contains(&"LGUG2Z.komorebi"));
        // Silent + accept-* flags are required for a non-interactive
        // install — without them winget will prompt and our streaming
        // capture will hang forever.
        assert!(args.contains(&"--silent"));
        assert!(args.contains(&"--accept-package-agreements"));
        assert!(args.contains(&"--accept-source-agreements"));
    }

    #[test]
    fn scoop_install_command_uses_extras_bucket() {
        let (cmd, args) = install_command(PackageManagerKind::Scoop);
        assert_eq!(cmd, "scoop");
        assert!(args.contains(&"extras/komorebi"));
    }

    #[test]
    fn winget_command_is_install_subcommand() {
        let (_, args) = install_command(PackageManagerKind::Winget);
        // The first arg should be the verb so the package id is the
        // second token (a sanity check that our arg order didn't drift).
        assert_eq!(args[0], "install");
        assert_eq!(args[1], "LGUG2Z.komorebi");
    }

    #[test]
    fn package_manager_kind_serialises_lowercase() {
        assert_eq!(
            serde_json::to_string(&PackageManagerKind::Winget).unwrap(),
            "\"winget\"",
        );
        assert_eq!(
            serde_json::to_string(&PackageManagerKind::Scoop).unwrap(),
            "\"scoop\"",
        );
    }

    #[test]
    fn install_result_serialises_with_named_fields() {
        let r = InstallResult { success: true, exit_code: 0 };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"exit_code\":0"));
    }
}
