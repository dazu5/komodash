/**
 * Pill-style bar preset (issue #73).
 *
 * Produces a coordinated bar-config patch that turns komorebi-bar
 * into a centered, rounded, content-width pill — Mac/iOS-inspired —
 * using only fields komorebi-bar's schema already exposes.
 *
 * The preset writes a coordinated set covering geometry, grouping,
 * inner padding, widget spacing, label truncation, and the work-area
 * reservation. Everything else (widgets, theme, fonts) stays untouched
 * — the merged-save endpoint only writes the fields the editor
 * declares.
 *
 * # Two non-obvious komorebi-bar behaviours we work around
 *
 * 1. **`Rect.right` is width, `Rect.bottom` is height.** Despite the
 *    field names, `komorebi-layouts/src/rect.rs` docs spell it out
 *    and `komorebi/src/windows_api.rs:611` passes them directly to
 *    `SetWindowPos` as `cx`/`cy`. So `position.end.x` is the bar's
 *    width, not its right-edge coord. Same applies to
 *    `work_area_offset.bottom` — it's a HEIGHT reduction, not a
 *    bottom-edge offset, so symmetric top/bottom values keep the
 *    work area within the screen.
 *
 * 2. **`position.start.x/y` gets reset to monitor top-left** by
 *    `update_monitor_coordinates` (komorebi-bar/src/bar.rs:832)
 *    every time the bar processes a monitor-coords update. So we
 *    can't center via `position.start.x` — we use symmetric
 *    `margin.left`/`right` instead. komorebi-bar applies margin
 *    *after* the start reset, so it survives.
 *
 * # `grouping.kind` is required
 *
 * komorebi-bar's `Grouping` is `#[serde(tag = "kind")]` (variants
 * None / Bar / Alignment / Widget). Without the `kind` discriminator,
 * config parse fails entirely and the bar never starts. "Bar" groups
 * the whole widget set as one pill.
 */

const MIN_SIDE_MARGIN = 50;
const MIN_PILL_WIDTH = 900;
const MAX_PILL_WIDTH = 1500;
/** Pill width target — share of monitor width, clamped to MIN/MAX. */
const PILL_WIDTH_RATIO = 0.7;
const TOP_MARGIN_PX = 10;
const BAR_HEIGHT_PX = 48;
/** Half the bar height — gives the bar a true pill shape (semi-
 *  circular ends) rather than a softened rectangle. */
const PILL_ROUNDING = 24;
/** macOS-style: clean container, no drop shadow. The translucency +
 *  rounded shape carry the visual interest. komorebi-bar's other
 *  shadow styles read as heavy/dated in a system-bar context. */
const PILL_STYLE = "Default";
/** Lower alpha (~70%) for a glass / translucent feel. egui doesn't
 *  do backdrop blur, so true glassmorphism isn't available — this is
 *  the closest approximation. */
const PILL_TRANSPARENCY = 180;
/** Truncate long window-title labels so one widget can't dominate
 *  the pill's horizontal real estate. Matches what a modern OS bar
 *  does instead of growing without bound. */
const MAX_LABEL_WIDTH = 180;
/** Gap between adjacent widgets. */
const WIDGET_SPACING = 16;
/** Inner padding inside the pill's rounded background so widget
 *  content doesn't touch the curved edge. */
const FRAME_INNER_MARGIN_X = 18;
const FRAME_INNER_MARGIN_Y = 6;
/** Inter is widely available on modern Windows installs (ships with
 *  some apps, common dev font). egui falls back to system default if
 *  it isn't installed — no parse failure. */
const PILL_FONT_FAMILY = "Inter";
const PILL_FONT_SIZE = 13;
/** Vertical work-area reservation. Symmetric so the work area's
 *  bottom edge stays anchored at the screen bottom — see the
 *  Rect-naming note above. */
const WORK_AREA_RESERVE = TOP_MARGIN_PX + BAR_HEIGHT_PX + 10;

export interface PillBarInput {
  monitorIndex: number;
  monitorWidth: number;
  monitorHeight: number;
}

export interface PillBarPatch {
  position: {
    end: { x: number; y: number };
    start?: undefined;
  };
  margin: { top: number; bottom: number; left: number; right: number };
  height: number;
  widget_spacing: number;
  max_label_width: number;
  font_family: string;
  font_size: number;
  frame: {
    inner_margin: { x: number; y: number };
  };
  grouping: {
    /** Discriminator for komorebi-bar's `#[serde(tag = "kind")]`
     *  Grouping enum. "Bar" groups the whole widget set as one — the
     *  shape we want for a pill. Without this field komorebi-bar fails
     *  parse with "missing field `kind`" and the bar never starts. */
    kind: "Bar";
    rounding: number;
    style: string;
    transparency_alpha: number;
  };
  transparency_alpha: number;
  monitor: {
    index: number;
    work_area_offset: {
      top: number;
      bottom: number;
      left: number;
      right: number;
    };
  };
}

export function buildPillPreset(input: PillBarInput): PillBarPatch {
  const targetWidth = Math.round(input.monitorWidth * PILL_WIDTH_RATIO);
  const maxAllowed = Math.max(0, input.monitorWidth - 2 * MIN_SIDE_MARGIN);
  const pillWidth = Math.max(
    Math.min(MIN_PILL_WIDTH, maxAllowed),
    Math.min(targetWidth, MAX_PILL_WIDTH, maxAllowed),
  );
  const sidePadding = Math.round((input.monitorWidth - pillWidth) / 2);

  return {
    position: {
      // start omitted intentionally: komorebi-bar defaults it to the
      // monitor's top-left, and overrides any value we set anyway.
      end: { x: input.monitorWidth, y: BAR_HEIGHT_PX },
    },
    margin: {
      top: TOP_MARGIN_PX,
      bottom: 0,
      left: sidePadding,
      right: sidePadding,
    },
    height: BAR_HEIGHT_PX,
    widget_spacing: WIDGET_SPACING,
    max_label_width: MAX_LABEL_WIDTH,
    font_family: PILL_FONT_FAMILY,
    font_size: PILL_FONT_SIZE,
    frame: {
      inner_margin: { x: FRAME_INNER_MARGIN_X, y: FRAME_INNER_MARGIN_Y },
    },
    grouping: {
      kind: "Bar",
      rounding: PILL_ROUNDING,
      style: PILL_STYLE,
      transparency_alpha: PILL_TRANSPARENCY,
    },
    transparency_alpha: PILL_TRANSPARENCY,
    monitor: {
      // komorebi/src/workspace.rs:633-636 applies the offset as
      //   with_offset.top    += offset.top
      //   with_offset.bottom -= offset.bottom
      // where `bottom` is HEIGHT (Rect naming again). Symmetric N/N
      // keeps the bottom edge anchored at the screen bottom — matches
      // what MonitorPlacementWidget does for the bar's own monitor
      // field.
      index: input.monitorIndex,
      work_area_offset: {
        top: WORK_AREA_RESERVE,
        bottom: WORK_AREA_RESERVE,
        left: 0,
        right: 0,
      },
    },
  };
}
