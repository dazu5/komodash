import { describe, expect, it } from "vitest";

import { buildPillPreset } from "./pill-bar-preset";

describe("buildPillPreset", () => {
  it("emits position.end as absolute screen-edge coords, not size", () => {
    // Regression: komorebi-bar treats position.end as the absolute
    // right / bottom edge of the bar rect (Rect {left, top, right,
    // bottom}), NOT as width / height from start. The schema docs say
    // "desired size from starting position" but the source proves
    // otherwise (komorebi-bar/src/bar.rs:613). If we ever pass width
    // here again, the resulting bar is too narrow and invisible.
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    const start = preset.position!.start as { x: number; y: number };
    const end = preset.position!.end as { x: number; y: number };
    const width = end.x - start.x;
    const height = end.y - start.y;
    expect(width).toBeGreaterThan(200); // sanity floor — pill is wider than 200 px
    expect(height).toBeGreaterThan(20);
  });

  it("centers the bar horizontally on the monitor", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    const start = preset.position!.start as { x: number };
    const end = preset.position!.end as { x: number };
    const center = (start.x + end.x) / 2;
    expect(center).toBeCloseTo(1920 / 2, 0);
  });

  it("caps pill width so there's at least 50px breathing room each side", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 800,
      monitorHeight: 1080,
    });
    const start = preset.position!.start as { x: number };
    const end = preset.position!.end as { x: number };
    expect(start.x).toBeGreaterThanOrEqual(50);
    expect(end.x).toBeLessThanOrEqual(800 - 50);
  });

  it("clears margin to zero so position is honored verbatim", () => {
    // Regression: komorebi-bar mutates `start.x += margin.left` and
    // `end.x -= margin.left + margin.right`, which is asymmetric and
    // breaks the explicit centering computed via position. Belt-and-
    // braces: emit zero margin so position is the single source of
    // truth.
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(preset.margin).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });

  it("sets a small top margin via position.start.y, not the margin field", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    const start = preset.position!.start as { y: number };
    expect(start.y).toBeGreaterThan(0);
    expect(start.y).toBeLessThan(50);
  });

  it("sets rounded corners, shadow, and transparency", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(preset.grouping!.rounding).toBe(18);
    expect(preset.grouping!.style).toBe("DefaultWithShadowB4O0S3");
    expect(typeof preset.transparency_alpha).toBe("number");
    expect(preset.transparency_alpha!).toBeGreaterThan(0);
    expect(preset.transparency_alpha!).toBeLessThanOrEqual(255);
  });

  it("reserves vertical work area on the targeted monitor", () => {
    const preset = buildPillPreset({
      monitorIndex: 2,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    const monitor = preset.monitor as {
      index: number;
      work_area_offset: { top: number; bottom: number; left: number; right: number };
    };
    expect(monitor.index).toBe(2);
    expect(monitor.work_area_offset.top).toBeGreaterThan(0);
    expect(monitor.work_area_offset.left).toBe(0);
    expect(monitor.work_area_offset.right).toBe(0);
  });
});
