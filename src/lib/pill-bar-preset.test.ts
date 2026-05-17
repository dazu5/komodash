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
    expect((preset.position!.end as { y: number }).y).toBe(52);
  });

  it("centers the bar via symmetric margin.left / margin.right (the only durable mechanism)", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    const m = preset.margin!;
    expect(m.left).toBe(m.right);
  });

  it("scales pill width with the monitor (~70% target), clamped to a comfortable range", () => {
    // Narrow monitor: floor at MIN
    const narrow = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1366,
      monitorHeight: 768,
    });
    const narrowWidth = 1366 - 2 * narrow.margin!.left;
    expect(narrowWidth).toBeGreaterThanOrEqual(900);

    // Standard 1920p: ~70% target lands in the middle
    const standard = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    const standardWidth = 1920 - 2 * standard.margin!.left;
    expect(standardWidth).toBeGreaterThan(1000);
    expect(standardWidth).toBeLessThanOrEqual(1500);

    // Ultrawide: cap at MAX
    const ultra = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 3440,
      monitorHeight: 1440,
    });
    const ultraWidth = 3440 - 2 * ultra.margin!.left;
    expect(ultraWidth).toBeLessThanOrEqual(1500);
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
    expect(preset.position!.start).toBeUndefined();
  });

  it("sets rounded corners — radius equals half the bar height for a true pill shape", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(preset.grouping!.rounding).toBe(26);
    expect(preset.grouping!.rounding * 2).toBe(preset.height);
  });

  it("uses no drop shadow (clean macOS-style container, glass effect carries the visual interest)", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(preset.grouping!.style).toBe("Default");
  });

  it("uses solid-dark transparency (~90%) for strong contrast against the desktop, not glass", () => {
    // egui doesn't do backdrop blur, so true glassmorphism isn't
    // available. Lower alpha (e.g. 180) looks washed out on a dark
    // wallpaper. The reference design we're matching is solid-dark,
    // ~90% alpha — depth comes from the wallpaper bleed-through at
    // the edges, not a translucent fill.
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(preset.transparency_alpha).toBeGreaterThan(220);
    expect(preset.transparency_alpha).toBeLessThanOrEqual(255);
  });

  it("uses Bar grouping so the whole widget set renders as one pill", () => {
    // Reverted from Alignment after the user's reference design
    // showed a single pill, not three. Side effect: the focused-
    // workspace chip fills the pill height (SelectableFrame ->
    // ui.max_rect), which we accept — the chip's colour is what
    // visually matters, set via theme.bar_accent below.
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(preset.grouping!.kind).toBe("Bar");
  });

  it("overrides theme.bar_accent to a light token for a cream chip on the dark pill", () => {
    // Without this, the chip uses the user's accent (often a
    // saturated colour that clashes with the pill background).
    // Per-palette mapping: Base16 -> Base07, Catppuccin -> Lavender.
    const base16 = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
      currentTheme: { palette: "Base16", name: "Ashes" },
    });
    expect(base16.theme.bar_accent).toBe("Base07");
    expect(base16.theme.palette).toBe("Base16");
    expect(base16.theme.name).toBe("Ashes");

    const catppuccin = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
      currentTheme: { palette: "Catppuccin", name: "Mocha" },
    });
    expect(catppuccin.theme.bar_accent).toBe("Lavender");
    expect(catppuccin.theme.palette).toBe("Catppuccin");
    expect(catppuccin.theme.name).toBe("Mocha");
  });

  it("falls back to Base16 Ashes when there's no current theme or an unknown palette", () => {
    const noTheme = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(noTheme.theme).toEqual({
      palette: "Base16",
      name: "Ashes",
      bar_accent: "Base07",
    });

    const customTheme = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
      currentTheme: { palette: "Custom", base_palette: {} },
    });
    expect(customTheme.theme).toEqual({
      palette: "Base16",
      name: "Ashes",
      bar_accent: "Base07",
    });
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

  it("reserves at least as much height as the top offset so the work area stays within the screen", () => {
    // Regression: komorebi/src/workspace.rs:633-636 applies offset as
    //   with_offset.top    += offset.top
    //   with_offset.bottom -= offset.bottom   (where bottom = HEIGHT)
    // So an asymmetric `{top: N, bottom: 0}` pushes the work area
    // N pixels DOWN without shrinking its height — windows overflow
    // past the screen edge. The fix is bottom >= top: the top edge
    // moves down by N, the height shrinks by at least N, keeping
    // the bottom edge at or above the screen bottom.
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    const offset = preset.monitor.work_area_offset;
    expect(offset.bottom).toBeGreaterThanOrEqual(offset.top);
  });

  it("adds widget spacing, label truncation, and inner frame margin so widgets aren't cramped", () => {
    // The bare-minimum-fields version of this preset rendered a
    // visibly cramped bar (overlapping widgets, no breathing room).
    // Pinning the four typography fields ensures the preset always
    // ships the spacing it needs.
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(preset.widget_spacing).toBeGreaterThanOrEqual(10);
    expect(preset.max_label_width).toBeGreaterThan(0);
    expect(preset.frame.inner_margin.x).toBeGreaterThan(0);
    expect(preset.frame.inner_margin.y).toBeGreaterThanOrEqual(0);
  });

  it("keeps inner_margin.x strictly greater than rounding so inner-widget backgrounds don't bleed past the pill curve", () => {
    // Regression: with inner_margin.x = 22 and rounding = 26, the
    // focused-workspace chip's background visibly bled outside the
    // pill's rounded edge because the chip's left edge fell inside
    // the curve's bounding box. The invariant must hold across any
    // future rounding tweak.
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(preset.frame.inner_margin.x).toBeGreaterThan(preset.grouping.rounding);
  });

  it("reserves more height at the bottom than the top so windows have a visible bottom gap", () => {
    // komorebi/src/workspace.rs:633-636: `offset.bottom` shrinks
    // the work area's height. To leave a gap at the screen bottom
    // (matching the visual breathing room the pill has at the top)
    // we must reserve more height than just the bar reservation.
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    const offset = preset.monitor.work_area_offset;
    expect(offset.bottom).toBeGreaterThan(offset.top);
  });

  it("makes the bar-bottom-to-windows gap equal the screen-top-to-bar gap", () => {
    // The visible top gap is `margin.top` (pill renders inside the
    // bar window, starting at the bar window's top + margin.top).
    // The visible bottom gap (bar bottom to window top) is
    // offset.top - (margin.top + bar_height). Match them:
    //   offset.top = margin.top + bar_height + margin.top
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    const topGap = preset.margin.top;
    const bottomGap =
      preset.monitor.work_area_offset.top - (preset.margin.top + preset.height);
    expect(bottomGap).toBe(topGap);
  });

  it("sets explicit `height` so it stays in sync with position.end.y", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(preset.height).toBe(52);
    expect(preset.height).toBe((preset.position!.end as { y: number }).y);
  });

  it("sets Inter as the font family — modern Mac/iOS aesthetic, falls back to system default if not installed", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(preset.font_family).toBe("Inter");
    expect(preset.font_size).toBeGreaterThanOrEqual(12);
  });
});
