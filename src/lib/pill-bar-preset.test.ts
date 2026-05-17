import { describe, expect, it } from "vitest";

import { buildPillPreset } from "./pill-bar-preset";

/**
 * komorebi-bar's `Rect` struct (in komorebi-layouts/src/rect.rs)
 * names its fields `left, top, right, bottom`, but the doc comments
 * make clear that `right` is WIDTH and `bottom` is HEIGHT — and the
 * Win32 boundary in windows_api.rs:611 passes them directly to
 * SetWindowPos as `cx` and `cy`. So in this codebase: position.end.x
 * is the bar's width, position.end.y is its height.
 *
 * Centering via `position.start.x` doesn't survive because
 * bar.rs:832's `update_monitor_coordinates` overrides start to the
 * monitor's top-left every time it fires (which is at least on
 * startup). The only durable way to offset the bar from the monitor
 * edge is via `margin.{top,left,right}` — komorebi-bar adds those
 * after the override.
 */
describe("buildPillPreset", () => {
  it("emits position.end as (monitor width, bar height) — komorebi-bar's `right` field is width, `bottom` is height", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect((preset.position!.end as { x: number }).x).toBe(1920);
    expect((preset.position!.end as { y: number }).y).toBe(32);
  });

  it("centers the bar via symmetric margin.left / margin.right (the only durable mechanism)", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    const m = preset.margin!;
    expect(m.left).toBe(m.right);
    // After komorebi-bar applies margin: end.x_width = monitorWidth - left - right
    // We want that to equal pillWidth (800 for 1920 monitor)
    expect(1920 - m.left - m.right).toBe(800);
  });

  it("caps pill width so there's at least 50px breathing room each side on narrow monitors", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 800,
      monitorHeight: 1080,
    });
    const m = preset.margin!;
    expect(m.left).toBeGreaterThanOrEqual(50);
    expect(m.right).toBeGreaterThanOrEqual(50);
    const pillWidth = 800 - m.left - m.right;
    expect(pillWidth).toBeGreaterThan(0);
  });

  it("offsets vertically via margin.top, not position.start (which gets overridden)", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(preset.margin!.top).toBeGreaterThan(0);
    expect(preset.margin!.top).toBeLessThan(50);
  });

  it("omits position.start so komorebi-bar uses monitor.left/top defaults — works for any monitor index without recomputing", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    // start is either undefined entirely (preferred) or null — never an
    // explicit (0,0) which would still get reset by komorebi-bar but
    // looks deliberate-but-wrong to a reader.
    expect(preset.position!.start).toBeUndefined();
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
