import { describe, expect, it } from "vitest";

import {
  BORDER_COLOUR_STATES,
  parseBorderColours,
  setBorderColour,
  type BorderColourState,
} from "./border-colours";

describe("BORDER_COLOUR_STATES", () => {
  it("covers all six states komorebi's BorderColours defines", () => {
    expect(BORDER_COLOUR_STATES).toEqual([
      "single",
      "stack",
      "monocle",
      "floating",
      "unfocused",
      "unfocused_locked",
    ]);
  });
});

describe("parseBorderColours", () => {
  it("returns the hex string verbatim for hex-typed entries", () => {
    const parsed = parseBorderColours({
      single: "#3b82f6",
      stack: "#f59e0b",
    });
    expect(parsed.single).toBe("#3b82f6");
    expect(parsed.stack).toBe("#f59e0b");
    expect(parsed.unfocused).toBeNull();
  });

  it("converts RGB-typed entries to hex on read", () => {
    const parsed = parseBorderColours({
      single: { r: 255, g: 0, b: 0 },
      stack: { r: 0, g: 255, b: 0 },
    });
    expect(parsed.single).toBe("#ff0000");
    expect(parsed.stack).toBe("#00ff00");
  });

  it("returns all-null when value is undefined / null / non-object", () => {
    for (const v of [undefined, null, 7, "foo", []] as unknown[]) {
      const parsed = parseBorderColours(v);
      for (const state of BORDER_COLOUR_STATES) {
        expect(parsed[state]).toBeNull();
      }
    }
  });

  it("ignores keys that aren't a known border-colour state", () => {
    const parsed = parseBorderColours({
      single: "#3b82f6",
      garbage: "#ffffff",
    });
    expect(parsed.single).toBe("#3b82f6");
    expect(Object.keys(parsed)).not.toContain("garbage");
  });
});

describe("setBorderColour", () => {
  it("patches one state and preserves the others", () => {
    const prev = parseBorderColours({
      single: "#3b82f6",
      stack: "#f59e0b",
    });
    const next = setBorderColour(prev, "single", "#ff00ff");
    expect(next.single).toBe("#ff00ff");
    expect(next.stack).toBe("#f59e0b");
    expect(prev.single).toBe("#3b82f6"); // immutability
  });

  it("can clear a state with null", () => {
    const prev = parseBorderColours({ single: "#3b82f6" });
    const next = setBorderColour(prev, "single", null);
    expect(next.single).toBeNull();
  });

  it("only touches the named state when given a noisy starting record", () => {
    const prev: Record<BorderColourState, string | null> = {
      single: "#aaa",
      stack: "#bbb",
      monocle: "#ccc",
      floating: "#ddd",
      unfocused: "#eee",
      unfocused_locked: "#fff",
    };
    const next = setBorderColour(prev, "monocle", "#000");
    expect(next.monocle).toBe("#000");
    expect(next.single).toBe("#aaa");
    expect(next.stack).toBe("#bbb");
    expect(next.floating).toBe("#ddd");
    expect(next.unfocused).toBe("#eee");
    expect(next.unfocused_locked).toBe("#fff");
  });
});
