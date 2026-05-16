//! Komodash user preferences (issue #72).
//!
//! Small JSON blob stored in the platform config dir, separate from
//! `komorebi.json` (which is Komorebi's territory). Covers app-level
//! UX preferences that don't belong in komorebi's static config: tray
//! behaviour, dismissed first-time notices, etc.
//!
//! Pure-IO. The Tauri layer wraps these helpers as commands.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Preferences {
    /// When `true`, clicking the window's X button hides Komodash to
    /// the system tray instead of exiting (#72). Default: `true`. The
    /// tray still exposes "Quit Komodash" for explicit exit.
    #[serde(default = "default_true")]
    pub close_to_tray: bool,
    /// Whether the user has already seen the one-shot toast that
    /// explains close-to-tray behaviour. Set once on first close-to-
    /// tray event so we don't nag.
    #[serde(default)]
    pub close_to_tray_notice_seen: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            close_to_tray_notice_seen: false,
        }
    }
}

fn default_true() -> bool {
    true
}

/// Load preferences from `path`. Returns defaults for any failure
/// path: missing file, malformed JSON, IO error. A bad prefs file
/// must not break the app at startup.
pub fn load(path: &Path) -> Preferences {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Preferences::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

/// Persist preferences to `path`, creating parent dirs as needed.
pub fn save(path: &Path, prefs: &Preferences) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).context("creating preferences directory")?;
    }
    let body = serde_json::to_string_pretty(prefs).context("serialising preferences")?;
    std::fs::write(path, body).context("writing preferences file")
}

/// Canonical on-disk path. Lives next to other Komodash-only state
/// under the platform config dir.
pub fn canonical_path() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("komodash").join("preferences.json"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn defaults_have_close_to_tray_on() {
        let p = Preferences::default();
        assert!(p.close_to_tray);
        assert!(!p.close_to_tray_notice_seen);
    }

    #[test]
    fn load_returns_defaults_for_missing_file() {
        let dir = TempDir::new().unwrap();
        let p = load(&dir.path().join("nope.json"));
        assert_eq!(p, Preferences::default());
    }

    #[test]
    fn load_returns_defaults_for_malformed_json() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("prefs.json");
        std::fs::write(&path, "{not json").unwrap();
        assert_eq!(load(&path), Preferences::default());
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("nested").join("prefs.json");
        let prefs = Preferences {
            close_to_tray: false,
            close_to_tray_notice_seen: true,
        };
        save(&path, &prefs).unwrap();
        assert_eq!(load(&path), prefs);
    }

    #[test]
    fn missing_field_falls_back_to_default() {
        // A prefs file written by an older Komodash that didn't know
        // about `close_to_tray_notice_seen` should load cleanly.
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("prefs.json");
        std::fs::write(&path, r#"{"close_to_tray": false}"#).unwrap();
        let loaded = load(&path);
        assert!(!loaded.close_to_tray);
        assert!(!loaded.close_to_tray_notice_seen);
    }
}
