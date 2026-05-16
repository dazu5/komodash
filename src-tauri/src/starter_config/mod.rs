//! Starter-config workspace bootstrap (issue #69).
//!
//! The bundled Starter config (ADR-0010) omits the `monitors` array so
//! Komorebi creates anonymous workspaces on demand. That leaves the
//! status bar's workspace widget showing nothing until the user
//! presses Alt+1..N — which they read as a bar bug.
//!
//! This module injects an explicit `monitors[].workspaces[]` array
//! sized to the user's actual monitor count at first-run time, so the
//! bar shows N pips from boot. The workspaces use Komodash's default
//! naming ("Workspace 1".."Workspace N") and BSP layout, matching the
//! Workspaces editor's `Add workspace` defaults (#64) so a user
//! renaming via the editor sees a continuous experience.

use anyhow::{Context, Result};
use serde_json::{json, Value};

const WORKSPACES_PER_MONITOR: usize = 5;

/// Inject an explicit `monitors[].workspaces[]` array into the starter
/// JSON, sized to the detected monitor count.
///
/// `monitor_count == 0` → return the input unchanged (we have no
/// monitors to seed; Komorebi will fall back to its own defaults).
/// An existing `monitors` field is preserved verbatim (defensive — the
/// bundled starter omits the field, but we shouldn't clobber a hand-
/// edited starter either).
pub fn inject_workspaces(starter_json: &str, monitor_count: usize) -> Result<String> {
    let mut value: Value =
        serde_json::from_str(starter_json).context("starter config is not valid JSON")?;

    if monitor_count == 0 {
        return Ok(starter_json.to_string());
    }

    let obj = value
        .as_object_mut()
        .context("starter config must be a JSON object at the root")?;

    if obj.contains_key("monitors") {
        return Ok(starter_json.to_string());
    }

    let monitors: Vec<Value> = (0..monitor_count)
        .map(|_| {
            json!({
                "workspaces": (1..=WORKSPACES_PER_MONITOR)
                    .map(|n| json!({ "name": format!("Workspace {n}"), "layout": "BSP" }))
                    .collect::<Vec<_>>()
            })
        })
        .collect();
    obj.insert("monitors".to_string(), Value::Array(monitors));

    serde_json::to_string_pretty(&value).context("re-serialising starter config failed")
}

/// Detect the number of physical displays via Win32
/// `GetSystemMetrics(SM_CMONITORS)`. Returns `0` on the non-Windows
/// build (we don't ship one, but `cargo test --all-targets` from a
/// dev machine without the cfg gate would otherwise fail).
///
/// SM_CMONITORS counts only display monitors, not pseudo-monitors or
/// the Remote Desktop session shadow — matching what the user
/// physically sees and matching Komorebi's own monitor enumeration.
pub fn detect_monitor_count() -> usize {
    detect_monitor_count_impl()
}

#[cfg(windows)]
fn detect_monitor_count_impl() -> usize {
    // SAFETY: GetSystemMetrics is a thread-safe Win32 read with no
    // pointer arguments. SM_CMONITORS returns 0 if no monitors are
    // attached, which we want to surface as "skip injection".
    let n = unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::GetSystemMetrics(
            windows_sys::Win32::UI::WindowsAndMessaging::SM_CMONITORS,
        )
    };
    n.max(0) as usize
}

#[cfg(not(windows))]
fn detect_monitor_count_impl() -> usize {
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINIMAL_STARTER: &str = r#"{ "border": true, "default_layout": "BSP" }"#;

    #[test]
    fn injects_one_monitor_with_five_workspaces() {
        let out = inject_workspaces(MINIMAL_STARTER, 1).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        let monitors = v.get("monitors").and_then(|m| m.as_array()).unwrap();
        assert_eq!(monitors.len(), 1);
        let workspaces = monitors[0]
            .get("workspaces")
            .and_then(|w| w.as_array())
            .unwrap();
        assert_eq!(workspaces.len(), 5);
    }

    #[test]
    fn injects_one_monitor_block_per_detected_monitor() {
        let out = inject_workspaces(MINIMAL_STARTER, 3).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        let monitors = v.get("monitors").and_then(|m| m.as_array()).unwrap();
        assert_eq!(monitors.len(), 3);
        for m in monitors {
            assert_eq!(
                m.get("workspaces").and_then(|w| w.as_array()).unwrap().len(),
                5,
            );
        }
    }

    #[test]
    fn default_workspace_uses_workspace_n_name_and_bsp_layout() {
        let out = inject_workspaces(MINIMAL_STARTER, 1).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        let workspaces = v["monitors"][0]["workspaces"].as_array().unwrap();
        assert_eq!(workspaces[0]["name"], "Workspace 1");
        assert_eq!(workspaces[0]["layout"], "BSP");
        assert_eq!(workspaces[4]["name"], "Workspace 5");
        assert_eq!(workspaces[4]["layout"], "BSP");
    }

    #[test]
    fn preserves_unrelated_top_level_keys() {
        let out = inject_workspaces(MINIMAL_STARTER, 1).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["border"], true);
        assert_eq!(v["default_layout"], "BSP");
    }

    #[test]
    fn zero_monitors_returns_input_unchanged() {
        let out = inject_workspaces(MINIMAL_STARTER, 0).unwrap();
        assert_eq!(out, MINIMAL_STARTER);
    }

    #[test]
    fn existing_monitors_field_is_left_alone() {
        let starter = r#"{ "monitors": [{ "workspaces": [{"name": "Mine"}] }] }"#;
        let out = inject_workspaces(starter, 5).unwrap();
        assert_eq!(out, starter);
    }
}
