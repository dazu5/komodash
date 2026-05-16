/**
 * Pill-style bar preset (issue #73).
 *
 * Produces a coordinated bar-config patch that turns komorebi-bar
 * into a centered, rounded, content-width pill — Mac-style — without
 * any upstream changes. Everything composed here is already in
 * `komorebi-bar`'s schema:
 *
 *   - `position.start` / `position.end`     content-width window
 *   - `margin.top`                          float away from screen edge
 *   - `grouping.rounding` + `grouping.style` rounded corners + shadow
 *   - `transparency_alpha`                  soften the outline
 *   - `monitor.work_area_offset.top`        only reserve vertical space
 *                                           — corners stay tileable
 *
 * The pure helper takes the targeted monitor's dimensions and emits a
 * `Partial<BarConfig>`-shaped patch the page applies via `setField`
 * per top-level key. Width is clamped so we always leave at least
 * 50 px of breathing room on each side, even on unusually narrow
 * setups.
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

  return {
    position: {
      start: { x: startX, y: TOP_MARGIN_PX },
      end: { x: pillWidth, y: BAR_HEIGHT_PX },
    },
    margin: { top: TOP_MARGIN_PX, bottom: 0, left: 0, right: 0 },
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
