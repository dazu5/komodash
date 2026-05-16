/**
 * Pure helpers for the border-colours widget (issue #75).
 *
 * Komorebi's `BorderColours` shape has six per-state slots: `single`,
 * `stack`, `monocle`, `floating`, `unfocused`, `unfocused_locked`.
 * Each slot accepts a hex string OR an `{r,g,b}` object. We normalise
 * to hex for the UI (HTML `<input type="color">` only speaks hex) and
 * tolerate RGB on read so a user who hand-edited the JSON doesn't see
 * their values blown away.
 */

export const BORDER_COLOUR_STATES = [
  "single",
  "stack",
  "monocle",
  "floating",
  "unfocused",
  "unfocused_locked",
] as const;

export type BorderColourState = (typeof BORDER_COLOUR_STATES)[number];

const KNOWN: ReadonlySet<string> = new Set(BORDER_COLOUR_STATES);

/**
 * Parse the on-disk `border_colours` value into a stable six-slot
 * record. Unknown keys are dropped; missing slots become null.
 */
export function parseBorderColours(
  value: unknown,
): Record<BorderColourState, string | null> {
  const out = emptyColours();
  if (!isRecord(value)) return out;
  for (const [k, v] of Object.entries(value)) {
    if (!KNOWN.has(k)) continue;
    out[k as BorderColourState] = toHex(v);
  }
  return out;
}

/**
 * Immutable single-slot patch. Other slots passed through verbatim.
 */
export function setBorderColour(
  prev: Record<BorderColourState, string | null>,
  state: BorderColourState,
  next: string | null,
): Record<BorderColourState, string | null> {
  return { ...prev, [state]: next };
}

function emptyColours(): Record<BorderColourState, string | null> {
  return {
    single: null,
    stack: null,
    monocle: null,
    floating: null,
    unfocused: null,
    unfocused_locked: null,
  };
}

function toHex(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (isRecord(v) && typeof v.r === "number" && typeof v.g === "number" && typeof v.b === "number") {
    return rgbToHex(v.r, v.g, v.b);
  }
  return null;
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const h = (n: number) => clamp(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
