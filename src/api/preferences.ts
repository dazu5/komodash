import { invoke } from "@tauri-apps/api/core";

/**
 * Komodash user preferences (issue #72). Mirrors the Rust struct in
 * `src-tauri/src/preferences/mod.rs`. App-level UX flags only —
 * komorebi-specific config lives in `komorebi.json`.
 */
export interface Preferences {
  close_to_tray: boolean;
  close_to_tray_notice_seen: boolean;
}

export async function getPreferences(): Promise<Preferences> {
  return invoke<Preferences>("get_preferences");
}

export async function setCloseToTray(enabled: boolean): Promise<void> {
  return invoke("set_close_to_tray", { enabled });
}

export async function markCloseToTrayNoticeSeen(): Promise<void> {
  return invoke("mark_close_to_tray_notice_seen");
}
