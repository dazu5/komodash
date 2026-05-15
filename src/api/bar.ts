import { invoke } from "@tauri-apps/api/core";

import type { FieldCatalog } from "@/api/field-catalog";
import type { JsonSchema } from "@/api/schema";

/**
 * Fetch the cached Bar JSON Schema (issue #19, per ADR-0002). The Rust
 * side shells out to `komorebi-bar.exe --schema` once and stashes the
 * result; subsequent calls return cached bytes unless the Komorebi
 * version changes.
 *
 * Returned as parsed `JsonSchema` (same shape as the Static schema)
 * because the bar schema is also a JSON Schema document — just with
 * different property paths (`monitor`, `font_family`, `left_widgets`,
 * `right_widgets`, …).
 */
export async function getBarSchema(): Promise<JsonSchema> {
  const raw = await invoke<string>("get_bar_schema");
  return JSON.parse(raw) as JsonSchema;
}

/**
 * Fetch the bundled Bar Field-catalog overlay (issue #19). Different
 * fields and sections from the Static catalog; the renderer is
 * agnostic.
 */
export async function getBarFieldCatalog(): Promise<FieldCatalog> {
  return invoke<FieldCatalog>("get_bar_field_catalog");
}

/**
 * Apply the on-disk `komorebi.bar.json` by restarting the bar daemon
 * (issue #19, per ADR-0006 buffered-apply). The bar doesn't hot-reload
 * — Komodash kills `komorebi-bar.exe` and re-launches it via
 * `komorebic start --bar`.
 *
 * Throws a stringified error on failure (e.g. komorebi-bar.exe not
 * found, or the user's edited bar config doesn't validate).
 */
export async function applyBarConfig(): Promise<void> {
  await invoke<void>("apply_bar_config");
}
