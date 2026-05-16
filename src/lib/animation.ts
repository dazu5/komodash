/**
 * Pure helpers for the animation settings widget (issue #76).
 *
 * Komorebi's `AnimationsConfig` accepts each field (`enabled`,
 * `duration`, `style`) either as a primitive applied globally OR as
 * a per-prefix object (`{movement: ..., transparency: ...}`). The
 * widget supports the simple global case and degrades to a warning
 * panel when the on-disk value uses the per-prefix shape, so we don't
 * silently overwrite a power user's per-animation overrides.
 */

import type { JsonSchema } from "@/api/schema";

export interface SimpleAnimationConfig {
  enabled: boolean;
  duration: number;
  style: string;
  fps: number;
}

export interface ParsedAnimation {
  simple: SimpleAnimationConfig;
  /** True when one or more on-disk fields use the per-prefix object
   *  shape — the widget shows a "Advanced config in use" notice and
   *  declines to overwrite. */
  advanced: boolean;
}

const DEFAULTS: SimpleAnimationConfig = {
  enabled: false,
  duration: 250,
  style: "Linear",
  fps: 60,
};

const FALLBACK_STYLES = [
  "Linear",
  "EaseInSine",
  "EaseOutSine",
  "EaseInOutSine",
  "EaseInQuad",
  "EaseOutQuad",
  "EaseInOutQuad",
  "EaseInCubic",
  "EaseOutCubic",
  "EaseInOutCubic",
];

/**
 * Normalise the on-disk `animation` value into the simple shape used
 * by the widget. Detects per-prefix object usage and flips
 * `advanced=true` so the renderer can present a safe read-only view.
 */
export function parseAnimationConfig(value: unknown): ParsedAnimation {
  if (!isRecord(value)) {
    return { simple: { ...DEFAULTS }, advanced: false };
  }

  let advanced = false;
  const isPerPrefix = (v: unknown) => isRecord(v);

  if (isPerPrefix(value.enabled)) advanced = true;
  if (isPerPrefix(value.duration)) advanced = true;
  if (isPerPrefix(value.style)) advanced = true;

  return {
    simple: {
      enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULTS.enabled,
      duration:
        typeof value.duration === "number" ? value.duration : DEFAULTS.duration,
      style: typeof value.style === "string" ? value.style : DEFAULTS.style,
      fps: typeof value.fps === "number" ? value.fps : DEFAULTS.fps,
    },
    advanced,
  };
}

/**
 * Pull the AnimationStyle enum from the static-config schema's
 * `$defs.AnimationStyle`. Falls back to a built-in list if the schema
 * doesn't ship it (older Komorebi versions, stripped cache).
 */
export function extractAnimationStyles(schema: JsonSchema): string[] {
  const def =
    schema.$defs?.["AnimationStyle"] ?? schema.definitions?.["AnimationStyle"];
  if (!def || !Array.isArray(def.oneOf)) return FALLBACK_STYLES;
  const out: string[] = [];
  for (const entry of def.oneOf) {
    const c = (entry as { const?: unknown }).const;
    if (typeof c === "string") out.push(c);
  }
  return out.length > 0 ? out : FALLBACK_STYLES;
}

/**
 * Immutable single-field patch on the simple shape.
 */
export function setAnimationField<K extends keyof SimpleAnimationConfig>(
  prev: SimpleAnimationConfig,
  key: K,
  value: SimpleAnimationConfig[K],
): SimpleAnimationConfig {
  return { ...prev, [key]: value };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
