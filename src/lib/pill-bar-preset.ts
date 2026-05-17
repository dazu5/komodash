/**
 * Pill-style bar preset (issue #73).
 *
 * Produces a coordinated bar-config patch that turns komorebi-bar
 * into a centered, rounded, content-width pill — Mac-style — using
 * only fields komorebi-bar's schema already exposes:
 *
 *   - `position.end`                        bar width × height
 *   - `margin.{top,left,right}`             vertical + horizontal offset
 *   - `grouping.rounding` + `grouping.style` rounded corners + shadow
 *   - `transparency_alpha`                  soften the outline
 *   - `monitor.work_area_offset.top`        reserve vertical space —
 *                                           corners stay tileable
 *
 * # Two non-obvious komorebi-bar behaviours we work around
 *
 * 1. **`Rect.right` is width, `Rect.bottom` is height.** Despite the
 *    field names, `komorebi-layouts/src/rect.rs` docs spell it out
 *    and `komorebi/src/windows_api.rs:611` passes them directly to
 *    `SetWindowPos` as `cx`/`cy`. So `position.end.x` is the bar's
 *    width, not its right-edge coord.
 *
 * 2. **`position.start.x/y` gets reset to monitor top-left** by
 *    `update_monitor_coordinates` (komorebi-bar/src/bar.rs:832)
 *    every time the bar processes a monitor-coords update, which
 *    happens at least at startup. So we can't center via
 *    `position.start.x`. The durable mechanism is `margin.left` +
 *    `margin.right` — komorebi-bar applies those *after* the start
 *    reset:
 *      start.x += margin.left
 *      end.x_width -= margin.left + margin.right
 *
 *    Symmetric left/right margin gives exact centering regardless of
 *    which monitor the bar lives on (the bar uses the monitor's own
 *    width via `MONITOR_RIGHT`, so it works for multi-monitor and
 *    ultrawide alike).
 */

const DEFAULT_PILL_WIDTH = 800;
const MIN_SIDE_MARGIN = 50;
const TOP_MARGIN_PX = 8;
const BAR_HEIGHT_PX = 32;
const PILL_ROUNDING = 18;
const PILL_STYLE = "DefaultWithShadowB4O0S3";
const PILL_TRANSPARENCY = 230;
/** Vertical work-area reservation: top margin + bar height +
 *  breathing room below so tiled windows don't touch the pill. */
const WORK_AREA_TOP_RESERVE = TOP_MARGIN_PX + BAR_HEIGHT_PX + 12;

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
  grouping: {
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
  const maxAllowed = Math.max(0, input.monitorWidth - 2 * MIN_SIDE_MARGIN);
  const pillWidth = Math.min(DEFAULT_PILL_WIDTH, maxAllowed);
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
    grouping: {
      rounding: PILL_ROUNDING,
      style: PILL_STYLE,
      transparency_alpha: PILL_TRANSPARENCY,
    },
    transparency_alpha: PILL_TRANSPARENCY,
    monitor: {
      index: input.monitorIndex,
      work_area_offset: {
        top: WORK_AREA_TOP_RESERVE,
        bottom: 0,
        left: 0,
        right: 0,
      },
    },
  };
}
