import { invoke } from "@tauri-apps/api/core";

/**
 * Fetch the diagnostic-info markdown blob. Contents are local-only —
 * Komodash never sends this anywhere; the caller decides what to do with
 * it (typically: copy to clipboard for the user to paste into a GitHub
 * issue).
 */
export async function getDiagnosticInfo(): Promise<string> {
  return await invoke<string>("get_diagnostic_info");
}
