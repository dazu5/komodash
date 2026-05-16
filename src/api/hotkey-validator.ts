import { invoke } from "@tauri-apps/api/core";

/**
 * A keyboard chord matching the Rust `whkdrc_parser::Chord` shape — modifiers
 * in canonical order plus a single uppercase base key.
 *
 * Modifier names match the Rust enum's serde representation (PascalCase).
 */
export interface Chord {
  modifiers: Array<"Win" | "Ctrl" | "Alt" | "Shift">;
  key: string;
}

/**
 * One validation finding for one binding. Matches Rust
 * `hotkey_validator::ValidationIssue` with `serde(rename_all = "kebab-case")`
 * applied to the `kind` enum.
 */
export interface ValidationIssue {
  kind:
    | "duplicate-chord"
    | "unknown-command"
    | "invalid-args"
    | "windows-reserved";
  bindingIndex: number;
  message: string;
}

/**
 * Fetch the bundled Windows-reserved chord list (issue #12, per ADR-0009).
 * The editor uses this to flag reserved chords inline as the user types
 * them, before the full validator runs. Safe to call repeatedly — the
 * Rust side parses the bundled JSON once at first call.
 */
export async function getReservedChords(): Promise<Chord[]> {
  return invoke<Chord[]>("get_reserved_chords");
}
