import { invoke } from "@tauri-apps/api/core";

/** `komorebic toggle-float` on the focused window. */
export async function toggleFocusedWindowFloat(): Promise<void> {
  await invoke<void>("toggle_focused_window_float");
}

/** `komorebic close` on the focused window. */
export async function closeFocusedWindow(): Promise<void> {
  await invoke<void>("close_focused_window");
}

/**
 * Focus the target monitor, then `komorebic move-to-workspace` to put
 * the focused window on the chosen workspace.
 */
export async function moveFocusedWindowToWorkspace(
  monitorIndex: number,
  workspaceIndex: number,
): Promise<void> {
  await invoke<void>("move_focused_window_to_workspace", {
    monitorIndex,
    workspaceIndex,
  });
}
