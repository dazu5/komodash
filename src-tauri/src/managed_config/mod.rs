//! Lifecycle for the three **Managed configs** (per
//! [ADR-0003](../../../docs/adr/0003-sole-writer-non-technical-audience.md)):
//! `komorebi.json` (Static), `komorebi.bar.json` (Bar), and `whkdrc`.
//!
//! Komodash is the sole writer of these files. Every write:
//!
//! 1. Snapshots the current on-disk content into [`crate::backup_store`]
//!    (per-kind, up to `MAX_RETAINED` entries).
//! 2. Performs an atomic temp-file-then-rename swap so a crash mid-write
//!    can't leave the live file half-truncated.
//!
//! The module is intentionally I/O-only — no schema validation, no
//! formatting opinions. Validation/formatting live in the editor layer
//! that knows what shape each kind should have.

use std::fs;
use std::path::Path;

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::backup_store;

/// Which Managed config a request is about. Serialised to lowercase so the
/// frontend sees `"static" | "bar" | "whkdrc"`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ConfigKind {
    /// `komorebi.json`
    Static,
    /// `komorebi.bar.json`
    Bar,
    /// `~/.config/whkdrc`
    Whkdrc,
}

impl ConfigKind {
    /// Stable string used for backup subdirectory names. Do not change
    /// without writing a migration — existing backups encode this in their
    /// filesystem layout.
    pub fn as_str(&self) -> &'static str {
        match self {
            ConfigKind::Static => "static",
            ConfigKind::Bar => "bar",
            ConfigKind::Whkdrc => "whkdrc",
        }
    }

    /// File extension used when writing backups. The `whkdrc` file has no
    /// extension on disk, but using `whkdrc` here keeps backups visually
    /// grouped.
    pub fn ext(&self) -> &'static str {
        match self {
            ConfigKind::Static | ConfigKind::Bar => "json",
            ConfigKind::Whkdrc => "whkdrc",
        }
    }
}

/// Read the live Managed config at `path` as a UTF-8 string. Returns
/// `Ok("")` if the file does not exist — callers expecting JSON should
/// handle the empty case themselves.
pub fn read(path: &Path) -> Result<String> {
    if !path.exists() {
        return Ok(String::new());
    }
    Ok(fs::read_to_string(path)?)
}

/// Write `content` to `path` atomically, backing up the previous content
/// first. The temp file lives in the same directory as the target so the
/// rename is guaranteed atomic by the filesystem.
pub fn write(path: &Path, content: &str, kind: ConfigKind, backups_root: &Path) -> Result<()> {
    if path.exists() {
        let existing = fs::read_to_string(path)?;
        backup_store::save(backups_root, kind.as_str(), &existing, kind.ext())?;
    } else if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp = tmp_path(path, kind.ext());
    fs::write(&temp, content)?;
    fs::rename(&temp, path)?;
    Ok(())
}

/// List the per-kind backups under `backups_root`, newest-first.
pub fn list_backups(
    backups_root: &Path,
    kind: ConfigKind,
) -> Result<Vec<backup_store::BackupRecord>> {
    backup_store::list(backups_root, kind.as_str())
}

/// Restore a previously-saved backup into the live config path. The
/// pre-restore content gets backed up first via [`write`], so the user
/// can undo a restore.
pub fn restore_backup(
    backups_root: &Path,
    kind: ConfigKind,
    id: &str,
    write_to: &Path,
) -> Result<()> {
    let content = backup_store::restore(backups_root, kind.as_str(), id)?;
    write(write_to, &content, kind, backups_root)
}

/// `<path>.<ext>.tmp` for atomic-write staging.
fn tmp_path(path: &Path, ext: &str) -> std::path::PathBuf {
    path.with_extension(format!("{ext}.tmp"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn read_missing_file_returns_empty_string() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("komorebi.json");
        assert_eq!(read(&path).unwrap(), "");
    }

    #[test]
    fn write_creates_file_when_absent() {
        let dir = tempdir().unwrap();
        let backups = tempdir().unwrap();
        let path = dir.path().join("komorebi.json");
        write(&path, "{}", ConfigKind::Static, backups.path()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "{}");
    }

    #[test]
    fn write_backs_up_previous_content() {
        let dir = tempdir().unwrap();
        let backups = tempdir().unwrap();
        let path = dir.path().join("komorebi.json");
        write(&path, "{\"v\":1}", ConfigKind::Static, backups.path()).unwrap();
        write(&path, "{\"v\":2}", ConfigKind::Static, backups.path()).unwrap();
        let backed_up = list_backups(backups.path(), ConfigKind::Static).unwrap();
        // First write had no previous content -> no backup. Second write
        // backs up the {"v":1} value.
        assert_eq!(backed_up.len(), 1);
        let restored =
            backup_store::restore(backups.path(), "static", &backed_up[0].id).unwrap();
        assert_eq!(restored, "{\"v\":1}");
    }

    #[test]
    fn write_creates_parent_directories_when_missing() {
        let dir = tempdir().unwrap();
        let backups = tempdir().unwrap();
        let path = dir.path().join("nested").join("deep").join("whkdrc");
        write(&path, "alt+h : focus left", ConfigKind::Whkdrc, backups.path()).unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "alt+h : focus left"
        );
    }

    #[test]
    fn restore_backup_round_trip() {
        let dir = tempdir().unwrap();
        let backups = tempdir().unwrap();
        let path = dir.path().join("komorebi.json");
        write(&path, "{\"v\":1}", ConfigKind::Static, backups.path()).unwrap();
        write(&path, "{\"v\":2}", ConfigKind::Static, backups.path()).unwrap();
        let backed_up = list_backups(backups.path(), ConfigKind::Static).unwrap();
        restore_backup(backups.path(), ConfigKind::Static, &backed_up[0].id, &path).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "{\"v\":1}");
    }

    #[test]
    fn config_kind_serialises_as_lowercase() {
        let json = serde_json::to_string(&ConfigKind::Static).unwrap();
        assert_eq!(json, "\"static\"");
        assert_eq!(serde_json::to_string(&ConfigKind::Bar).unwrap(), "\"bar\"");
        assert_eq!(
            serde_json::to_string(&ConfigKind::Whkdrc).unwrap(),
            "\"whkdrc\""
        );
    }

    #[test]
    fn config_kind_round_trips_through_serde() {
        let kinds = [ConfigKind::Static, ConfigKind::Bar, ConfigKind::Whkdrc];
        for kind in kinds {
            let json = serde_json::to_string(&kind).unwrap();
            let parsed: ConfigKind = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, kind);
        }
    }
}
