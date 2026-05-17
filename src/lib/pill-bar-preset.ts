/**
 * Pill-style bar preset (issue #73).
 *
 * Produces a coordinated bar-config patch that turns komorebi-bar
 * into a centered, rounded, content-width pill — Mac-style — without
 * any upstream changes. Composed of fields komorebi-bar's schema
 * already exposes:
 *
 *   - `position.start` / `position.end`     bar window rect (see note)
 *   - `grouping.rounding` + `grouping.style` rounded corners + shadow
 *   - `transparency_alpha`                  soften the outline
 *   - `monitor.work_area_offset.top`        reserve vertical space —
 *                                           corners stay tileable
 *
 * # `position.end` semantics
 *
 * The bar config's schema description for `end` reads "desired size
 * of the bar from the starting position", but komorebi-bar's source
 * (komorebi-bar/src/bar.rs, in `apply_config`) uses the values
 * verbatim as the right/bottom edges of a `Rect {left, top, right,
 * bottom}`. So `end.x` is the ABSOLUTE right-edge X coord (e.g. 1360
 * for a pill ending 1360 px from the screen-left), not the bar's
 * width. Same for `end.y` — absolute bottom edge.
 *
 * # `margin` interaction
 *
 * komorebi-bar mutates `start.x += margin.left` and `end.x -=
 * margin.left + margin.right` — that's asymmetric and would shift
 * our explicit centering off. We emit a zero margin so the position
 * field is the single source of truth.
 *
 * # `position.start` and monitor reloads
 *
 * komorebi-bar overrides `position.start.x/y` to the monitor's
 * top-left whenever it processes a monitor-coords update — see
 * `update_monitor_coordinates` in bar.rs. For the common single-
 * monitor case this only fires at startup so our centering survives;
 * users who add/remove monitors at runtime may see the pill snap
 * back to the top-left of monitor 0 and need to reapply.
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
    start: { x: number; y: number };
    end: { x: number; y: number };
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
  const startX = Math.round((input.monitorWidth - pillWidth) / 2);
  const endX = startX + pillWidth;
  const endY = TOP_MARGIN_PX + BAR_HEIGHT_PX;

  return {
    position: {
      start: { x: startX, y: TOP_MARGIN_PX },
      end: { x: endX, y: endY },
    },
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
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
