import { invoke } from "@tauri-apps/api/core";

import type { Chord, ValidationIssue } from "@/api/hotkey-validator";

/**
 * Mirrors Rust `whkdrc_parser::WhkdrcModel`. The Tauri serde bridge
 * round-trips this verbatim — the Hotkeys page manipulates the typed
 * shape rather than raw whkdrc text.
 */
export interface WhkdrcModel {
  shell: string | null;
  imports: string[];
  bindings: Binding[];
  preserved_lines: string[];
}

/** One binding row: chord + command + args (issue #20). */
export interface Binding {
  chord: Chord;
  command: string;
  args: string[];
}

/** Read the live whkdrc and parse it into a typed model. */
export async function readWhkdrc(): Promise<WhkdrcModel> {
  return invoke<WhkdrcModel>("read_whkdrc");
}

/**
 * Write the model to disk in canonical whkdrc form (per ADR-0003).
 * Does NOT restart whkd — that's `applyWhkdrc`'s job, called
 * separately per ADR-0006 buffered-apply semantics.
 */
export async function writeWhkdrc(model: WhkdrcModel): Promise<void> {
  await invoke<void>("write_whkdrc", { model });
}

/**
 * Run the hotkey validator (from #12) over a model. Returns the full
 * `ValidationIssue` list per ADR-0009. Errors disable Apply; warnings
 * don't.
 */
export async function validateHotkeys(
  model: WhkdrcModel,
): Promise<ValidationIssue[]> {
  return invoke<ValidationIssue[]>("validate_hotkeys", { model });
}

/**
 * Restart whkd so the on-disk whkdrc changes take effect. Called when
 * the user clicks "Apply changes to hotkeys".
 */
export async function applyWhkdrc(): Promise<void> {
  await invoke<void>("apply_whkdrc");
}
