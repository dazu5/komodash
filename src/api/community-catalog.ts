import { invoke } from "@tauri-apps/api/core";

/**
 * Download the latest community catalog (`applications.json`) into the
 * user's home directory via `komorebic fetch-app-specific-configuration`.
 * Throws on failure with the friendly message from the Tauri side.
 */
export async function fetchCommunityCatalog(): Promise<void> {
  await invoke<void>("fetch_community_catalog");
}

/**
 * Read the on-disk community catalog as a JSON string. Returns an empty
 * string if `applications.json` doesn't exist yet (the UI shows a
 * "Download library" affordance in that case).
 */
export async function readCommunityCatalog(): Promise<string> {
  return await invoke<string>("read_community_catalog");
}
