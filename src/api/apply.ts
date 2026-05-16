import { invoke } from "@tauri-apps/api/core";

/**
 * Frontend-friendly error from a failed Live-apply (issue #18, per
 * ADR-0006). Mirrors Rust `apply_static::ApplyError`.
 *
 * - `friendly` — one-line plain-English message for inline error UI.
 * - `raw` — the original Komorebi/komorebic stderr, surfaced via Copy
 *   diagnostic info so support requests retain the verbatim message.
 */
export interface ApplyError {
  friendly: string;
  raw: string;
}

/**
 * Tell Komorebi to reload the Static configuration from disk. Called
 * after every settled edit in the editor's live-apply flow.
 *
 * Throws `ApplyError` on failure — caller renders `.friendly` inline.
 * Tauri wraps any thrown value in an Error-shaped object; we re-parse
 * it back to the original shape here.
 */
export async function applyStaticConfig(): Promise<void> {
  try {
    await invoke<void>("apply_static_config");
  } catch (e) {
    // Tauri's serde bridge serialises the Rust error as the inner shape.
    if (isApplyError(e)) {
      throw e;
    }
    // Fallback for anything else (e.g. invoke layer failure) — synthesise
    // an ApplyError so the caller has a uniform shape to render.
    throw {
      friendly: e instanceof Error ? e.message : String(e),
      raw: e instanceof Error ? e.message : String(e),
    } satisfies ApplyError;
  }
}

function isApplyError(v: unknown): v is ApplyError {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Record<string, unknown>).friendly === "string" &&
    typeof (v as Record<string, unknown>).raw === "string"
  );
}
