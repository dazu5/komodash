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

/**
 * Release a monitor's runtime work-area offset (set it back to all
 * zeros). Used when the bar moves to a different monitor — without
 * this, Komorebi keeps the previous monitor's reserved bar pixels and
 * windows there don't reflow into the freed space.
 *
 * Best-effort: throws if Komorebi isn't running or the monitor index
 * is bogus, but the caller (BarConfig Apply path) should swallow the
 * failure and continue with the bar restart.
 */
export async function resetMonitorWorkAreaOffset(
  monitorIndex: number,
): Promise<void> {
  await invoke<void>("reset_monitor_work_area_offset", { monitorIndex });
}

/**
 * Read the effective DPI scale factor of the monitor that contains
 * the given screen point. `1.0` = 100% (96 DPI), `1.25` = 125%, etc.
 * Falls back to `1.0` silently on any Win32 failure.
 *
 * Uses a screen point (not a monitor index) because Win32's
 * `EnumDisplayMonitors` ordering doesn't necessarily match Komorebi's
 * monitor index on multi-monitor setups. The caller is expected to
 * look up the monitor's bounding rect from the live-state snapshot
 * and pass its center point.
 *
 * Used by the pill preset to scale physical-pixel bar geometry
 * (height, margin, sidePadding) so the bar looks proportionally
 * identical across monitors with different DPI scales — see
 * CONTEXT.md → Bar geometry for the logical-vs-physical pixel
 * split.
 */
export async function getMonitorDpiScale(x: number, y: number): Promise<number> {
  return await invoke<number>("get_monitor_dpi_scale", { x, y });
}

/** Monitor bounding rect + DPI scale, queried from Win32 directly. */
export interface MonitorGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  /** DPI scale (1.0 = 96 DPI, 1.25 = 120 DPI, ...). */
  scale: number;
}

/**
 * Read the bounding rect + DPI scale of the monitor at the given
 * Win32 enumeration index, queried from Win32 directly (NOT from
 * komorebi's live snapshot). The snapshot drops monitor info while
 * komorebi-bar restarts to move the bar — which is exactly the
 * moment auto-refit needs the data — so anything depending on the
 * snapshot is unreliable. Win32 is always available.
 *
 * Caveat: assumes Win32's `EnumDisplayMonitors` order matches
 * Komorebi's monitor index. True for typical 1–2 monitor setups.
 */
export async function getMonitorGeometry(
  index: number,
): Promise<MonitorGeometry | null> {
  return await invoke<MonitorGeometry | null>("get_monitor_geometry", {
    index,
  });
}

/**
 * Merged save for the bar configuration (issue #56). The editor passes
 * its current working buffer (`edits`) plus the **set of top-level keys
 * it actually touched** (`touchedFields`); every other top-level key on
 * disk is preserved verbatim. Prevents the bar editor from stripping
 * `komorebi-bar.exe`'s required fields (widgets, theme, fonts, etc.)
 * just by editing the monitor block.
 */
export async function writeBarConfigMerged(
  edits: Record<string, unknown>,
  touchedFields: string[],
): Promise<void> {
  await invoke<void>("write_bar_config_merged", {
    edits,
    touchedFields,
  });
}
