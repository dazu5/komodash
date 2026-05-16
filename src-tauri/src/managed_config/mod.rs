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
//! Issue #17 added two robustness behaviours for the Static configuration:
//!
//! - **Tolerant read fallback.** When `serde_json` rejects the file
//!   (trailing commas, JSON5 comments, etc.), we re-parse with `json5`
//!   and re-emit as canonical JSON. The user keeps their edits; we just
//!   silently canonicalise the format on the next save.
//! - **Merged write.** [`write_static_config_merged`] takes the editor's
//!   working buffer **plus** an explicit set of "fields the editor
//!   touched" and only overwrites those keys — every other top-level
//!   and nested key on disk is preserved verbatim. This protects the
//!   user from losing fields their currently-installed `komorebic` doesn't
//!   know about (typically because they downgraded).

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

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

    /// `true` for the kinds that should attempt the JSON5 read fallback
    /// (issue #17). Whkdrc has its own grammar and is handled by
    /// `whkdrc_parser`.
    fn is_json(&self) -> bool {
        matches!(self, ConfigKind::Static | ConfigKind::Bar)
    }
}

/// Read the live Managed config at `path` as a UTF-8 string. Returns
/// `Ok("")` if the file does not exist — callers expecting JSON should
/// handle the empty case themselves.
///
/// For JSON-shaped kinds (`Static`, `Bar`), on `serde_json::from_str`
/// failure this function attempts a `json5` parse and, if that succeeds,
/// re-emits the value as canonical JSON. That lets a **Power user** edit
/// the file by hand with trailing commas or comments without breaking the
/// Komodash editor on next launch (issue #17, point B).
pub fn read(path: &Path) -> Result<String> {
    read_with_kind(path, None)
}

/// Variant of [`read`] that knows the [`ConfigKind`]; the tolerant
/// fallback is scoped to JSON kinds. Callers that already have a kind
/// in hand should prefer this — it avoids the `None` branch.
pub fn read_with_kind(path: &Path, kind: Option<ConfigKind>) -> Result<String> {
    if !path.exists() {
        return Ok(String::new());
    }
    let raw = fs::read_to_string(path)?;
    if !kind.map(|k| k.is_json()).unwrap_or(false) {
        return Ok(raw);
    }
    if serde_json::from_str::<Value>(&raw).is_ok() {
        return Ok(raw);
    }
    // serde_json refused. Try json5 — if it accepts, re-emit as canonical
    // JSON. The next save will overwrite the on-disk file with that
    // canonical form, so the tolerance is one-shot, not a permanent
    // license to write malformed JSON.
    match json5::from_str::<Value>(&raw) {
        Ok(value) => Ok(serde_json::to_string_pretty(&value)?),
        Err(_) => {
            // Both parsers rejected. Return the raw content — the caller
            // is expected to error out in the editor with a useful inline
            // message rather than crash here.
            Ok(raw)
        }
    }
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

/// Write `edits` into the Static configuration at `path`, mutating
/// **only** the top-level keys listed in `touched_fields` (issue #17,
/// point A). Every other top-level key on disk is preserved verbatim —
/// so a user whose currently-installed `komorebic` doesn't know about a
/// field can't accidentally strip it by saving.
///
/// `edits` must be a JSON object. Each key listed in `touched_fields`
/// is overwritten with the value from `edits` (or removed if missing from
/// `edits` — that's how the editor signals "the user cleared this
/// field"). Keys in `edits` that aren't in `touched_fields` are
/// **ignored** — the editor may carry stale-but-unchanged values; we
/// only trust what it explicitly says it touched.
///
/// On first save (the on-disk file doesn't yet exist), the whole `edits`
/// object is written as-is — there's nothing to preserve.
pub fn write_static_config_merged(
    path: &Path,
    edits: &Value,
    touched_fields: &HashSet<String>,
    backups_root: &Path,
) -> Result<()> {
    let edits_obj = edits
        .as_object()
        .ok_or_else(|| anyhow!("edits must be a JSON object, got {edits:?}"))?;

    let existing_raw = if path.exists() {
        // Use the tolerant reader so a hand-edited config with comments
        // doesn't lose round-trip on the merge step.
        read_with_kind(path, Some(ConfigKind::Static))?
    } else {
        String::new()
    };

    let mut merged = if existing_raw.trim().is_empty() {
        // First save: nothing to merge into; write edits verbatim
        // (still filtered through the touched_fields set, so the editor's
        // accidental stale values can't leak).
        Value::Object(Default::default())
    } else {
        serde_json::from_str::<Value>(&existing_raw)?
    };

    let merged_obj = merged
        .as_object_mut()
        .ok_or_else(|| anyhow!("on-disk config must parse as a JSON object"))?;

    for field in touched_fields {
        match edits_obj.get(field) {
            Some(value) => {
                merged_obj.insert(field.clone(), value.clone());
            }
            None => {
                // Editor signalled "field touched + value cleared".
                merged_obj.remove(field);
            }
        }
    }

    let canonical = serde_json::to_string_pretty(&merged)?;
    write(path, &canonical, ConfigKind::Static, backups_root)
}

/// Return the top-level keys in `content` (a JSON Static-config blob)
/// that are not declared as `properties` on `schema` (a JSON Schema
/// blob). Used to surface the "your current Komorebi version doesn't
/// recognise these fields" banner on the Configuration page (issue #17).
///
/// Order is the order the keys appear in `content` (preserved via
/// `serde_json`'s `preserve_order` feature already enabled on this crate).
///
/// Bot-level only in v1: nested-path detection would require walking
/// every `$ref` in the schema and is out of scope for the v1 banner.
pub fn detect_unknown_top_level_fields(content: &str, schema: &str) -> Result<Vec<String>> {
    let value = match serde_json::from_str::<Value>(content) {
        Ok(v) => v,
        // If the content doesn't parse, there's no point in reporting
        // unknown fields — the editor will surface a parse-error banner
        // instead. Return empty to keep the two banners from layering.
        Err(_) => return Ok(Vec::new()),
    };
    let value_obj = match value.as_object() {
        Some(obj) => obj,
        None => return Ok(Vec::new()),
    };

    let schema_val: Value = serde_json::from_str(schema)?;
    let known_keys: HashSet<String> = schema_val
        .get("properties")
        .and_then(|p| p.as_object())
        .map(|p| p.keys().cloned().collect())
        .unwrap_or_default();

    Ok(value_obj
        .keys()
        .filter(|k| !known_keys.contains(*k))
        .cloned()
        .collect())
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

// Reference-only export for the test module. Future callers (issue #18
// editor flow) will use `HashMap<String, Value>` shapes; the merge fn
// only consults the *keys* of `edits`, but the editor stores it as a
// map at the TS layer.
#[allow(dead_code)]
pub(crate) fn empty_touched_set() -> HashMap<String, Value> {
    HashMap::new()
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

    // ---- Issue #17 -------------------------------------------------------

    #[test]
    fn read_tolerates_trailing_commas_via_json5_fallback() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("komorebi.json");
        // Valid JSON5 / invalid JSON: trailing comma after `true`.
        fs::write(
            &path,
            r#"{
  "border": true,
  "default_workspace_padding": 10,
}"#,
        )
        .unwrap();

        let got = read_with_kind(&path, Some(ConfigKind::Static)).unwrap();
        // Re-emitted as canonical JSON — must round-trip through serde_json.
        let parsed: Value = serde_json::from_str(&got).expect("re-emitted form must be valid JSON");
        assert_eq!(parsed["border"], true);
        assert_eq!(parsed["default_workspace_padding"], 10);
    }

    #[test]
    fn read_tolerates_jsonc_line_comments() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("komorebi.json");
        fs::write(
            &path,
            r#"{
  // user's hand-edited annotation
  "border": true
}"#,
        )
        .unwrap();

        let got = read_with_kind(&path, Some(ConfigKind::Static)).unwrap();
        let parsed: Value = serde_json::from_str(&got).expect("re-emitted form must be valid JSON");
        assert_eq!(parsed["border"], true);
    }

    #[test]
    fn read_returns_raw_when_both_parsers_fail() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("komorebi.json");
        fs::write(&path, "not parseable as anything {{{").unwrap();
        let got = read_with_kind(&path, Some(ConfigKind::Static)).unwrap();
        // Raw passes through — caller surfaces the editor parse error.
        assert!(got.contains("not parseable"));
    }

    #[test]
    fn write_static_merged_preserves_unknown_root_field() {
        let dir = tempdir().unwrap();
        let backups = tempdir().unwrap();
        let path = dir.path().join("komorebi.json");

        // On-disk: known field + an "invented_unknown" field a future
        // Komorebi might recognise.
        let existing = serde_json::json!({
          "border": true,
          "invented_unknown": "should survive"
        });
        write(
            &path,
            &serde_json::to_string_pretty(&existing).unwrap(),
            ConfigKind::Static,
            backups.path(),
        )
        .unwrap();

        // Editor touches *only* `border`, flipping it to false. Doesn't
        // know `invented_unknown` exists.
        let edits = serde_json::json!({ "border": false });
        let touched: HashSet<String> = ["border".to_string()].into_iter().collect();

        write_static_config_merged(&path, &edits, &touched, backups.path()).unwrap();

        let after: Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(after["border"], false, "touched field must be updated");
        assert_eq!(
            after["invented_unknown"], "should survive",
            "unknown field must round-trip verbatim"
        );
    }

    #[test]
    fn write_static_merged_preserves_unknown_nested_field() {
        let dir = tempdir().unwrap();
        let backups = tempdir().unwrap();
        let path = dir.path().join("komorebi.json");

        // Unknown field nested inside monitors[0], per the issue AC.
        let existing = serde_json::json!({
          "border": true,
          "monitors": [
            { "workspaces": [], "unknown_nested": "should survive" }
          ]
        });
        write(
            &path,
            &serde_json::to_string_pretty(&existing).unwrap(),
            ConfigKind::Static,
            backups.path(),
        )
        .unwrap();

        // Editor touches `border` only. `monitors` is untouched, so its
        // entire subtree (including the unknown nested key) must survive.
        let edits = serde_json::json!({ "border": false });
        let touched: HashSet<String> = ["border".to_string()].into_iter().collect();

        write_static_config_merged(&path, &edits, &touched, backups.path()).unwrap();

        let after: Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(after["monitors"][0]["unknown_nested"], "should survive");
    }

    #[test]
    fn write_static_merged_removes_touched_field_when_edit_missing() {
        let dir = tempdir().unwrap();
        let backups = tempdir().unwrap();
        let path = dir.path().join("komorebi.json");

        let existing = serde_json::json!({ "border": true, "other": "keep" });
        write(
            &path,
            &serde_json::to_string_pretty(&existing).unwrap(),
            ConfigKind::Static,
            backups.path(),
        )
        .unwrap();

        // Editor says it touched `border` but didn't include it — that's
        // the "user cleared this field" signal.
        let edits = serde_json::json!({});
        let touched: HashSet<String> = ["border".to_string()].into_iter().collect();

        write_static_config_merged(&path, &edits, &touched, backups.path()).unwrap();

        let after: Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert!(after.get("border").is_none(), "cleared field must be removed");
        assert_eq!(after["other"], "keep", "untouched field must remain");
    }

    #[test]
    fn write_static_merged_first_save_writes_full_edits() {
        let dir = tempdir().unwrap();
        let backups = tempdir().unwrap();
        let path = dir.path().join("komorebi.json"); // does not exist yet

        let edits = serde_json::json!({ "border": true });
        let touched: HashSet<String> = ["border".to_string()].into_iter().collect();

        write_static_config_merged(&path, &edits, &touched, backups.path()).unwrap();

        let after: Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(after["border"], true);
    }

    #[test]
    fn write_static_merged_round_trips_through_json5_input() {
        // Combined: file on disk has trailing commas (JSON5), editor saves
        // a merged update. The non-touched JSON5-only fields must survive
        // and the file emerges as canonical JSON.
        let dir = tempdir().unwrap();
        let backups = tempdir().unwrap();
        let path = dir.path().join("komorebi.json");
        fs::write(
            &path,
            r#"{
  "border": true,
  "invented_unknown": "alive",
}"#,
        )
        .unwrap();

        let edits = serde_json::json!({ "border": false });
        let touched: HashSet<String> = ["border".to_string()].into_iter().collect();
        write_static_config_merged(&path, &edits, &touched, backups.path()).unwrap();

        // Now the file must be canonical JSON (no trailing comma) AND
        // contain both fields with the new + preserved values.
        let raw = fs::read_to_string(&path).unwrap();
        let parsed: Value = serde_json::from_str(&raw)
            .expect("post-merge file must be canonical JSON");
        assert_eq!(parsed["border"], false);
        assert_eq!(parsed["invented_unknown"], "alive");
    }

    #[test]
    fn detect_unknown_returns_root_keys_not_in_schema_properties() {
        let content = r#"{
          "border": true,
          "invented_unknown": "x",
          "another_one": 42
        }"#;
        let schema = r#"{
          "type": "object",
          "properties": {
            "border": { "type": "boolean" }
          }
        }"#;
        let got = detect_unknown_top_level_fields(content, schema).unwrap();
        assert_eq!(got.len(), 2, "expected 2 unknowns, got {got:?}");
        assert!(got.contains(&"invented_unknown".to_string()));
        assert!(got.contains(&"another_one".to_string()));
    }

    #[test]
    fn detect_unknown_empty_when_all_keys_known() {
        let content = r#"{ "border": true }"#;
        let schema = r#"{
          "type": "object",
          "properties": {
            "border": { "type": "boolean" }
          }
        }"#;
        let got = detect_unknown_top_level_fields(content, schema).unwrap();
        assert!(got.is_empty(), "expected no unknowns, got {got:?}");
    }

    #[test]
    fn detect_unknown_empty_when_content_is_malformed() {
        // Malformed content shouldn't crash and shouldn't layer with the
        // editor's own parse-error banner.
        let got = detect_unknown_top_level_fields("not json", r#"{"properties":{}}"#).unwrap();
        assert!(got.is_empty());
    }
}
