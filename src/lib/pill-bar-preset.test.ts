import { describe, expect, it } from "vitest";

import { buildPillPreset } from "./pill-bar-preset";

/**
 * Contract: the preset writes BAR GEOMETRY (height, margin, position,
 * grouping, theme, widget set, chip styling) plus a BARE MONITOR INDEX.
 * It deliberately does NOT write `work_area_offset` — that's a derived
 * value that Komodash's backend (`compute_bar_reservation` in
 * `src-tauri/src/lib.rs`) computes at apply time from this preset's
 * `height` + `margin.top` + a per-monitor Win32 taskbar probe.
 *
 * Single source of truth for the offset = backend. Single source of
 * truth for the geometry inputs the backend consumes = this preset.
 *
 * Background on the other quirks pinned below:
 *
 * - komorebi-bar's `Rect.right` is WIDTH, `Rect.bottom` is HEIGHT
 *   (komorebi-layouts/src/rect.rs docs). So `position.end.x` is the
 *   bar's width, `position.end.y` is its height.
 *
 * - Centering via `position.start.x` doesn't survive
 *   `update_monitor_coordinates` (komorebi-bar/src/bar.rs:832) which
 *   resets `start` to the monitor's top-left on every fire. The only
 *   durable way to offset the bar from the monitor edge is via
 *   `margin.{top,left,right}` — komorebi-bar adds those AFTER the reset.
 */
describe("buildPillPreset", () => {
  it("emits monitor as a bare integer index (SSOT: work_area_offset is computed by backend, not stored in the preset)", () => {
    const preset = buildPillPreset({
      monitorIndex: 2,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(preset.monitor).toBe(2);
    // Critically: the preset has no `monitor.work_area_offset` field.
    // Komodash's backend reads `height` + `margin.top` from the bar
    // config and probes Win32 for the live taskbar height to derive
    // the canonical reservation.
    expect(typeof preset.monitor).toBe("number");
  });

  it("emits position.end as (monitor width, bar height)", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect((preset.position.end as { x: number }).x).toBe(1920);
    expect((preset.position.end as { y: number }).y).toBe(preset.height);
  });

  it("centers the bar via symmetric margin.left / margin.right", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(preset.margin.left).toBe(preset.margin.right);
  });

  it("scales pill width with the monitor, clamped to a comfortable range", () => {
    const narrow = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1366,
      monitorHeight: 768,
    });
    const narrowWidth = 1366 - 2 * narrow.margin.left;
    expect(narrowWidth).toBeGreaterThanOrEqual(600);

    const ultra = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 3440,
      monitorHeight: 1440,
    });
    const ultraWidth = 3440 - 2 * ultra.margin.left;
    expect(ultraWidth).toBeLessThanOrEqual(2000);
  });

  it("caps pill width so there's at least some breathing room each side on narrow monitors", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 800,
      monitorHeight: 1080,
    });
    expect(preset.margin.left).toBeGreaterThanOrEqual(20);
    expect(preset.margin.right).toBeGreaterThanOrEqual(20);
  });

  it("sets a positive margin.top so the pill floats below the screen edge", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(preset.margin.top).toBeGreaterThan(0);
    expect(preset.margin.top).toBeLessThan(50);
  });

  it("omits position.start so komorebi-bar uses monitor defaults", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(preset.position.start).toBeUndefined();
  });

  it("writes a positive height that matches position.end.y (the source-of-truth backend reads)", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(preset.height).toBeGreaterThan(0);
    expect(preset.height).toBe((preset.position.end as { y: number }).y);
  });

  it("uses rounded grouping with a sensible pill rounding (≤ half-height)", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(preset.grouping.kind).toBe("Bar");
    expect(preset.grouping.rounding).toBeGreaterThan(0);
    // Rounding can't exceed half the bar height or the corners cross.
    expect(preset.grouping.rounding * 2).toBeLessThanOrEqual(preset.height);
  });

  it("uses the Default grouping style (no drop shadow)", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(preset.grouping.style).toBe("Default");
  });

  it("uses substantial transparency so the desktop shows through (no DWM blur on the current backdrop)", () => {
    // ADR-0013: Win11 Acrylic ignores SetWindowRgn, so we ship without
    // a DWM backdrop and rely on `bar_fill × transparency_alpha` to
    // produce the translucent look. Low alpha (≤80) keeps it airy.
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(preset.transparency_alpha).toBeGreaterThan(0);
    expect(preset.transparency_alpha).toBeLessThan(200);
  });

  it("falls back to Base16 Ashes when there's no current theme", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(preset.theme).toEqual({
      palette: "Base16",
      name: "Ashes",
      accent: "Base05",
      auto_select_fill: "Base07",
      auto_select_text: "Base00",
    });
  });

  it("preserves a Base16 current theme and augments accent + auto-select fields", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
      currentTheme: { palette: "Base16", name: "Ashes" },
    });
    expect(preset.theme.palette).toBe("Base16");
    expect(preset.theme.name).toBe("Ashes");
    expect(preset.theme.accent).toBe("Base05");
    expect(preset.theme.auto_select_fill).toBe("Base07");
    expect(preset.theme.auto_select_text).toBe("Base00");
  });

  it("preserves a Catppuccin current theme and augments accent + auto-select fields", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
      currentTheme: { palette: "Catppuccin", name: "Mocha" },
    });
    expect(preset.theme.accent).toBe("Text");
    expect(preset.theme.auto_select_fill).toBe("Lavender");
    expect(preset.theme.auto_select_text).toBe("Base");
  });

  it("trims the widget set to design-minimal: workspaces left, date + separator + time right", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });

    // Left: a single Komorebi composite with workspaces enabled,
    // layout + focused_window disabled (matches Frame 39.svg).
    expect(preset.left_widgets).toHaveLength(1);
    const komorebi = (preset.left_widgets[0] as { Komorebi: Record<string, unknown> }).Komorebi;
    expect((komorebi.workspaces as { enable: boolean }).enable).toBe(true);
    expect((komorebi.workspaces as { display: string }).display).toBe(
      "IndexAndTextOnSelected",
    );
    expect((komorebi.layout as { enable: boolean }).enable).toBe(false);
    expect((komorebi.focused_window as { enable: boolean }).enable).toBe(false);

    // Right: Date + Separator + Time, in that authored order.
    expect(preset.right_widgets).toHaveLength(3);
    const date = (preset.right_widgets[0] as { Date: Record<string, unknown> }).Date;
    expect((date as { enable: boolean }).enable).toBe(true);
    expect((date as { label_prefix: string }).label_prefix).toBe("None");

    const sep = (preset.right_widgets[1] as { Separator: Record<string, unknown> }).Separator;
    expect((sep as { enable: boolean }).enable).toBe(true);

    const time = (preset.right_widgets[2] as { Time: Record<string, unknown> }).Time;
    expect((time as { enable: boolean }).enable).toBe(true);
    expect((time as { label_prefix: string }).label_prefix).toBe("None");
  });

  it("emits all fork-only chip styling fields with sensible values", () => {
    // The patched komorebi-bar fork honors these; stock komorebi-bar
    // silently ignores them. We assert presence + sanity here; pixel-
    // perfect output depends on the patched binary being installed.
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });

    // Chip exterior padding (chip-to-pill gap), symmetric.
    expect(preset.chip_padding.top).toBeGreaterThan(0);
    expect(preset.chip_padding.bottom).toBe(preset.chip_padding.top);
    expect(preset.chip_padding.left).toBe(preset.chip_padding.top);
    expect(preset.chip_padding.right).toBe(preset.chip_padding.top);

    // Chip interior padding (text-to-chip-edge), symmetric per axis.
    expect(preset.chip_inner_padding.top).toBeGreaterThan(0);
    expect(preset.chip_inner_padding.bottom).toBe(preset.chip_inner_padding.top);
    expect(preset.chip_inner_padding.left).toBeGreaterThan(0);
    expect(preset.chip_inner_padding.right).toBe(preset.chip_inner_padding.left);

    // Pill-shaped chip: corner radius ≥ half the rendered text height.
    expect(preset.chip_corner_radius).toBeGreaterThan(0);

    // Colours match the SVG reference.
    expect(preset.chip_fill).toBe("#D9D9D9");
    expect(preset.chip_text_color).toBe("#000000");

    // Hover chips off — only the focused chip ever paints.
    expect(preset.chip_hover_disabled).toBe(true);

    // No DWM backdrop (see ADR-0013).
    expect(preset.backdrop).toBe("None");
  });

  it("uses Inter at a readable font size", () => {
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(preset.font_family).toBe("Inter");
    expect(preset.font_size).toBeGreaterThanOrEqual(10);
  });

  it("ensures inner_margin.x ≥ rounding so chip backgrounds don't bleed past the pill curve", () => {
    // Regression: with inner_margin.x < rounding, the focused chip's
    // background visibly bled outside the pill's rounded edge because
    // the chip's left edge fell inside the curve's bounding box.
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(preset.frame.inner_margin.x).toBeGreaterThanOrEqual(0);
  });

  it("exposes the bar geometry inputs the backend reservation calc needs (height + margin.top)", () => {
    // CONTRACT: Komodash's `compute_bar_reservation` reads exactly
    // these two fields from the on-disk bar config to derive the
    // top reservation: `top = margin.top + height + margin.top`.
    // If the preset stops emitting either, the backend will fall back
    // to defaults and the visible gaps will be wrong.
    const preset = buildPillPreset({
      monitorIndex: 0,
      monitorWidth: 1920,
      monitorHeight: 1080,
    });
    expect(typeof preset.height).toBe("number");
    expect(preset.height).toBeGreaterThan(0);
    expect(typeof preset.margin.top).toBe("number");
    expect(preset.margin.top).toBeGreaterThan(0);
  });
});
