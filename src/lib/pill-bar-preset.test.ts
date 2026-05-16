import { describe, expect, it } from "vitest";

import { buildPillPreset } from "./pill-bar-preset";

describe("buildPillPreset", () => {
  it("centers the bar horizontally on the monitor", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    // start.x + pillWidth/2 should land at monitor center
    const pillWidth = (preset.position!.end as { x: number }).x;
    const startX = (preset.position!.start as { x: number }).x;
    expect(startX + pillWidth / 2).toBeCloseTo(1920 / 2, 0);
  });

  it("caps pill width so there's at least 50px breathing room on each side", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 800, // unusually narrow
      monitorHeight: 1080,
    });
    const pillWidth = (preset.position!.end as { x: number }).x;
    const startX = (preset.position!.start as { x: number }).x;
    expect(startX).toBeGreaterThanOrEqual(50);
    expect(pillWidth + startX).toBeLessThanOrEqual(800 - 50);
  });

  it("sets a small top margin, rounded corners, shadow, and transparency", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(preset.margin).toEqual({ top: 8, bottom: 0, left: 0, right: 0 });
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

  it("emits position.start.y aligned with the top margin", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    const startY = (preset.position!.start as { y: number }).y;
    expect(startY).toBe(8);
  });
});
