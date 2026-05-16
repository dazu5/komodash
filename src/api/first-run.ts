import { invoke } from "@tauri-apps/api/core";

import type { DetectionResult } from "@/lib/first-run-fsm";

/**
 * Run all four wizard preconditions in one shot — backs the FSM that
 * decides which (if any) wizard cards to show.
 */
export async function detectFirstRunState(): Promise<DetectionResult> {
  return await invoke<DetectionResult>("detect_first_run_state");
}

/**
 * Write the bundled starter config (ADR-0010) to the canonical Static
 * config path. Refuses to overwrite an existing file — the wizard only
 * calls this when detection reports the config doesn't exist.
 */
export async function writeStarterConfig(): Promise<void> {
  await invoke<void>("write_starter_config");
}

/** `komorebic enable-autostart` — plants Startup-folder shortcut. */
export async function enableAutostart(): Promise<void> {
  await invoke<void>("enable_autostart");
}

/** `komorebic disable-autostart` — removes the Startup-folder shortcut. */
export async function disableAutostart(): Promise<void> {
  await invoke<void>("disable_autostart");
}
