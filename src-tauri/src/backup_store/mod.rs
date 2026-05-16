//! Timestamped backups of managed configs.
//!
//! Every write through [`crate::managed_config`] first asks `backup_store` to
//! save a copy of whatever is currently on disk. Backups live under a
//! per-kind subdirectory of a configurable root (in production:
//! `%LOCALAPPDATA%\komodash\backups\<kind>\`). Filenames are
//! `<kind>-<ISO8601-compact>.<ext>` so they sort lexicographically by age
//! and a quick stem-extract recovers the timestamp for display.
//!
//! The store keeps the most recent [`MAX_RETAINED`] entries per kind and
//! prunes older ones on every save. Restore is a plain read of the named
//! backup; the caller is responsible for then writing the restored content
//! through the normal [`crate::managed_config::write`] path so it itself
//! gets backed up.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::Result;
use chrono::Utc;
use serde::Serialize;

/// How many backups per kind we keep on disk. Older ones are pruned on
/// every [`save`].
pub const MAX_RETAINED: usize = 20;

/// A single backup file as surfaced to the frontend.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BackupRecord {
    /// Filename without directory (e.g. `static-20260514T093000Z.json`).
    pub id: String,
    /// ISO-8601 with hyphens/colons, for display.
    pub created_at: String,
    /// Absolute path on disk. Useful for "open in file explorer" affordances.
    pub path: PathBuf,
    /// Size on disk in bytes.
    pub size_bytes: u64,
}

/// Write `content` as a new backup for `kind` under `backups_root`. Returns
/// the filename (which doubles as the backup id). Side effects: creates
/// `<backups_root>/<kind>/` if missing; prunes oldest entries beyond
/// [`MAX_RETAINED`].
pub fn save(backups_root: &Path, kind: &str, content: &str, ext: &str) -> Result<String> {
    let dir = backups_root.join(kind);
    fs::create_dir_all(&dir)?;
    let stamp = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let filename = format!("{kind}-{stamp}.{ext}");
    let path = dir.join(&filename);
    fs::write(&path, content)?;
    prune(&dir, MAX_RETAINED)?;
    Ok(filename)
}

/// Newest-first list of backups for `kind`. Returns an empty vec if the
/// directory does not exist yet (i.e. no backups have ever been written).
pub fn list(backups_root: &Path, kind: &str) -> Result<Vec<BackupRecord>> {
    let dir = backups_root.join(kind);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut records = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        if !metadata.is_file() {
            continue;
        }
        let path = entry.path();
        let filename = entry.file_name().to_string_lossy().to_string();
        let created_at = extract_timestamp(&filename).unwrap_or_else(|| "unknown".to_string());
        records.push(BackupRecord {
            id: filename,
            created_at,
            path,
            size_bytes: metadata.len(),
        });
    }
    // Filenames embed timestamps, so lexicographic descending order = newest-first.
    records.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(records)
}

/// Read the raw bytes of a previously-saved backup as a UTF-8 string.
pub fn restore(backups_root: &Path, kind: &str, id: &str) -> Result<String> {
    let path = backups_root.join(kind).join(id);
    Ok(fs::read_to_string(&path)?)
}

/// Remove backups beyond the `max` most-recent. Newest is determined by
/// lexicographic sort of filenames (timestamps in the name).
fn prune(dir: &Path, max: usize) -> Result<()> {
    let mut entries: Vec<_> = fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .filter(|e| e.metadata().map(|m| m.is_file()).unwrap_or(false))
        .collect();
    entries.sort_by(|a, b| b.file_name().cmp(&a.file_name())); // newest first
    for entry in entries.into_iter().skip(max) {
        let _ = fs::remove_file(entry.path());
    }
    Ok(())
}

/// Pull the ISO-8601 timestamp out of a `<kind>-YYYYMMDDTHHMMSSZ.<ext>`
/// filename and reformat as hyphenated for display. Returns `None` if the
/// filename doesn't fit the expected shape — caller falls back to "unknown".
fn extract_timestamp(filename: &str) -> Option<String> {
    let after_dash = filename.split_once('-')?.1;
    let stem = after_dash.rsplit_once('.')?.0;
    // Expected: 16-char compact `YYYYMMDDTHHMMSSZ`.
    if stem.len() != 16 {
        return Some(stem.to_string());
    }
    Some(format!(
        "{}-{}-{}T{}:{}:{}Z",
        &stem[0..4],
        &stem[4..6],
        &stem[6..8],
        &stem[9..11],
        &stem[11..13],
        &stem[13..15],
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;
    use std::time::Duration;
    use tempfile::tempdir;

    #[test]
    fn save_creates_file_and_returns_id() {
        let dir = tempdir().unwrap();
        let id = save(dir.path(), "static", "hello", "json").unwrap();
        assert!(id.starts_with("static-"));
        assert!(id.ends_with(".json"));
        assert!(dir.path().join("static").join(&id).exists());
    }

    #[test]
    fn list_returns_empty_when_no_backups_yet() {
        let dir = tempdir().unwrap();
        let listed = list(dir.path(), "static").unwrap();
        assert!(listed.is_empty());
    }

    #[test]
    fn list_returns_newest_first() {
        let dir = tempdir().unwrap();
        let id1 = save(dir.path(), "static", "first", "json").unwrap();
        // sleep ensures distinct second-level timestamps in the filename
        sleep(Duration::from_millis(1100));
        let id2 = save(dir.path(), "static", "second", "json").unwrap();
        let listed = list(dir.path(), "static").unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, id2, "newest should come first");
        assert_eq!(listed[1].id, id1);
    }

    #[test]
    fn restore_reads_saved_content() {
        let dir = tempdir().unwrap();
        let id = save(dir.path(), "static", "the content", "json").unwrap();
        let restored = restore(dir.path(), "static", &id).unwrap();
        assert_eq!(restored, "the content");
    }

    #[test]
    fn prune_keeps_only_max_retained() {
        let dir = tempdir().unwrap();
        // Save MAX_RETAINED + 5 backups, sleeping between to get distinct
        // timestamps. The 5 oldest should be pruned automatically.
        for i in 0..(MAX_RETAINED + 5) {
            save(dir.path(), "static", &format!("v{i}"), "json").unwrap();
            sleep(Duration::from_millis(1100));
        }
        let listed = list(dir.path(), "static").unwrap();
        assert_eq!(listed.len(), MAX_RETAINED);
    }

    #[test]
    fn different_kinds_are_isolated() {
        let dir = tempdir().unwrap();
        save(dir.path(), "static", "a", "json").unwrap();
        save(dir.path(), "bar", "b", "json").unwrap();
        save(dir.path(), "whkdrc", "c", "whkdrc").unwrap();
        assert_eq!(list(dir.path(), "static").unwrap().len(), 1);
        assert_eq!(list(dir.path(), "bar").unwrap().len(), 1);
        assert_eq!(list(dir.path(), "whkdrc").unwrap().len(), 1);
    }

    #[test]
    fn extract_timestamp_handles_canonical_filename() {
        assert_eq!(
            extract_timestamp("static-20260514T093000Z.json").as_deref(),
            Some("2026-05-14T09:30:00Z"),
        );
    }

    #[test]
    fn extract_timestamp_falls_back_for_unexpected_shape() {
        assert_eq!(extract_timestamp("garbage").as_deref(), None);
    }

    #[test]
    fn list_records_carry_size() {
        let dir = tempdir().unwrap();
        save(dir.path(), "static", "abcdef", "json").unwrap();
        let listed = list(dir.path(), "static").unwrap();
        assert_eq!(listed[0].size_bytes, 6);
    }
}
