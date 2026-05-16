import { invoke } from "@tauri-apps/api/core";

import {
  parseVisibleWindowsResponse,
  type VisibleWindow,
} from "@/lib/visible-windows";

/**
 * Run `komorebic visible-windows` and parse the result. Returns `[]`
 * if komorebic isn't running or returns an unexpected shape.
 */
export async function getVisibleWindows(): Promise<VisibleWindow[]> {
  const json = await invoke<string>("get_visible_windows");
  return parseVisibleWindowsResponse(json);
}
