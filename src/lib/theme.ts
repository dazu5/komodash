/**
 * Pure helpers for the theme picker widget (issue #77).
 *
 * Komorebi's `KomorebiTheme` is a tagged union: Catppuccin (4 named
 * variants), Base16 (~150 named variants), or Custom (a user-defined
 * palette object). The widget exposes the two-dropdown UX — palette
 * kind, then variant — and falls back to a read-only notice when the
 * user has a Custom theme committed, since we don't yet ship a
 * structured Custom-palette editor.
 */

import type { JsonSchema } from "@/api/schema";

export const KNOWN_PALETTES = ["Catppuccin", "Base16", "Custom"] as const;
export type Palette = (typeof KNOWN_PALETTES)[number];

export interface ParsedTheme {
  palette: Palette | null;
  name: string | null;
  isCustom: boolean;
}

/**
 * Normalise the on-disk `theme` value. Returns nulls for missing /
 * malformed input; flags `isCustom` so the widget can render a safe
 * notice for the unsupported variant.
 */
export function parseTheme(value: unknown): ParsedTheme {
  if (!isRecord(value)) {
    return { palette: null, name: null, isCustom: false };
  }
  const palette =
    typeof value.palette === "string" && isKnownPalette(value.palette)
      ? (value.palette as Palette)
      : null;
  const name = typeof value.name === "string" ? value.name : null;
  return {
    palette,
    name,
    isCustom: palette === "Custom",
  };
}

/**
 * Build the on-disk shape from the widget's two selections. A null
 * palette clears the field entirely (returns null); the parent passes
 * that through to `onChange` to unset.
 */
export function buildThemeValue(
  palette: Palette | null,
  name: string | null,
): Record<string, unknown> | null {
  if (palette === null) return null;
  const out: Record<string, unknown> = { palette };
  if (name !== null) out.name = name;
  return out;
}

/**
 * Extract the variant `const` names for a named palette from the
 * static-config schema's `$defs`. Returns `[]` if the schema doesn't
 * ship the definition — the caller can decide whether to fall back to
 * a hardcoded list or just hide the variant dropdown.
 */
export function extractPaletteNames(
  schema: JsonSchema,
  palette: Palette,
): string[] {
  const def = schema.$defs?.[palette] ?? schema.definitions?.[palette];
  if (!def || !Array.isArray(def.oneOf)) return [];
  const out: string[] = [];
  for (const entry of def.oneOf) {
    const c = (entry as { const?: unknown }).const;
    if (typeof c === "string") out.push(c);
  }
  return out;
}

function isKnownPalette(s: string): boolean {
  return (KNOWN_PALETTES as readonly string[]).includes(s);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
