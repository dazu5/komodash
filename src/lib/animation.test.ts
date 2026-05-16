import { describe, expect, it } from "vitest";

import type { JsonSchema } from "@/api/schema";

import {
  extractAnimationStyles,
  parseAnimationConfig,
  setAnimationField,
} from "./animation";

describe("parseAnimationConfig", () => {
  it("returns sensible defaults for undefined input", () => {
    const parsed = parseAnimationConfig(undefined);
    expect(parsed.simple).toEqual({
      enabled: false,
      duration: 250,
      style: "Linear",
      fps: 60,
    });
    expect(parsed.advanced).toBe(false);
  });

  it("returns the simple shape verbatim when fields are scalars", () => {
    const parsed = parseAnimationConfig({
      enabled: true,
      duration: 400,
      style: "EaseOutCubic",
      fps: 120,
    });
    expect(parsed.simple).toEqual({
      enabled: true,
      duration: 400,
      style: "EaseOutCubic",
      fps: 120,
    });
    expect(parsed.advanced).toBe(false);
  });

  it("flags advanced=true when any field uses the per-prefix object shape", () => {
    const parsed = parseAnimationConfig({
      enabled: { movement: true, transparency: false },
      duration: 250,
    });
    expect(parsed.advanced).toBe(true);
  });
});

describe("extractAnimationStyles", () => {
  it("returns the AnimationStyle enum values from $defs.oneOf consts", () => {
    const schema: JsonSchema = {
      $defs: {
        AnimationStyle: {
          oneOf: [
            { type: "string", const: "Linear" },
            { type: "string", const: "EaseInSine" },
            { type: "string", const: "EaseOutCubic" },
          ],
        },
      },
    };
    expect(extractAnimationStyles(schema)).toEqual([
      "Linear",
      "EaseInSine",
      "EaseOutCubic",
    ]);
  });

  it("falls back to a built-in list when the schema doesn't define it", () => {
    expect(extractAnimationStyles({})).toContain("Linear");
    expect(extractAnimationStyles({}).length).toBeGreaterThan(2);
  });
});

describe("setAnimationField", () => {
  it("patches one field on the simple shape, preserving others", () => {
    const prev = {
      enabled: true,
      duration: 250,
      style: "Linear",
      fps: 60,
    };
    const next = setAnimationField(prev, "duration", 400);
    expect(next.duration).toBe(400);
    expect(next.enabled).toBe(true);
    expect(next.style).toBe("Linear");
    expect(next.fps).toBe(60);
    expect(prev.duration).toBe(250);
  });
});
