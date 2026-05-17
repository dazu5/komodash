/**
 * Pill-style bar preset (issue #73).
 *
 * Produces a coordinated bar-config patch that turns komorebi-bar
 * into a centered, rounded, content-width pill — Mac/iOS-inspired —
 * using a combination of upstream komorebi-bar config fields AND
 * Komodash-fork-only additions (chip_inner_padding, chip_corner_radius,
 * chip_fill, chip_text_color, backdrop). The fork-only fields are
 * silently ignored by stock komorebi-bar, so the preset's geometry
 * still renders sensibly even without the patched binary — just
 * without the design's pixel-perfect chip styling.
 *
 * # Two non-obvious upstream behaviours we work around
 *
 * 1. **`Rect.right` is width, `Rect.bottom` is height.** Despite the
 *    names, `komorebi-layouts/src/rect.rs` docs spell it out and
 *    `komorebi/src/windows_api.rs:611` passes them directly to
 *    SetWindowPos as `cx`/`cy`. Same applies to `work_area_offset` —
 *    `bottom` is HEIGHT reduction.
 *
 * 2. **`position.start.x/y` gets reset to monitor top-left** by
 *    `update_monitor_coordinates` (komorebi-bar/src/bar.rs:832)
 *    every time it fires. So centering via `position.start.x` never
 *    sticks. We use symmetric `margin.left`/`right` — applied AFTER
 *    the reset.
 *
 * # `grouping.kind` is required
 *
 * `Grouping` is `#[serde(tag = "kind")]` (variants None / Bar /
 * Alignment / Widget). Without the `kind` discriminator the parser
 * bails out and the bar never starts. We use "Bar" — one container
 * holding all widgets — matching the reference design.
 *
 * # Trimmed widget set
 *
 * The reference design is sparse: workspaces + small layout icon on
 * the left, date + time on the right. The preset OVERWRITES the
 * user's `left_widgets` / `right_widgets` with this set. Undoable
 * via the global undo stack.
 */

/** Pill width sizing. All in physical pixels.
 *
 *  Goal: the pill takes ~half the monitor width on a typical 1080p
 *  display and scales reasonably outside that. The clamps keep it
 *  legible on narrow laptops (≤1366) and from ballooning on
 *  ultrawides (≥3440).
 *
 *  - PILL_WIDTH_RATIO 0.525 = ~52.5% of monitor width (chosen to
 *    leave room for desktop wallpaper on both sides while still
 *    showing all our minimal widget set comfortably).
 *  - MIN_PILL_WIDTH 675 = enough horizontal room for the typical
 *    workspaces + date + time set even on 1366×768 laptops.
 *  - MAX_PILL_WIDTH 1125 = caps the pill on 4K/ultrawide so it
 *    doesn't visually dominate the screen.
 *  - MIN_SIDE_MARGIN 40 = always keep at least 40 px of wallpaper
 *    visible on each side of the pill, regardless of monitor width.
 */
const MIN_SIDE_MARGIN = 40;
const MIN_PILL_WIDTH = 675;
const MAX_PILL_WIDTH = 1125;
const PILL_WIDTH_RATIO = 0.525;

/** Gap between the screen top and the pill's painted top edge.
 *  Symmetric with the gap BELOW the pill (the backend computes the
 *  work-area top reservation as `TOP_MARGIN_PX + height +
 *  TOP_MARGIN_PX`, so the user sees equal breathing room above and
 *  below the bar). */
const TOP_MARGIN_PX = 14;

/** Bar height in pixels. The Komodash backend reads this from the
 *  on-disk bar config to derive the work-area reservation — see
 *  `compute_bar_reservation` in src-tauri/src/lib.rs and CONTEXT.md
 *  → Bar geometry. Changing this value changes how much vertical
 *  space the bar reserves, so callers don't need to touch the
 *  reservation directly. */
const BAR_HEIGHT_PX = 45;

/** Pill corner radius. ~0.4× the bar height keeps the visual
 *  softness ratio consistent. NOT half-height — full hemisphere
 *  ends would dominate at this compact bar size; the slightly-
 *  understated curve reads as a rounded rect with personality. */
const PILL_ROUNDING = 18;

/** Grouping style. "Default" = no drop shadow. We tried
 *  DefaultWithShadowB4O1S3 earlier; the shadow read as a smudge
 *  against the desktop wallpaper. */
const PILL_STYLE = "Default";

/** Bar fill colour. `#505050` matches the SVG reference; combined
 *  with `PILL_TRANSPARENCY` it produces a frosted-grey overlay over
 *  the desktop. Without DWM Acrylic (see ADR-0013) this is the
 *  entire "glass" effect. */
const BAR_FILL_HEX = "#505050";
/** Alpha component, 0–255. 51 ≈ 20 % opacity (matches the SVG's
 *  `fill-opacity="0.2"`). Goes far enough to read as a translucent
 *  panel without obscuring the wallpaper underneath. */
const PILL_TRANSPARENCY = 51;

/** Max width per widget label before truncation. Keeps date/time
 *  from pushing other widgets off-screen on narrow monitors. */
const MAX_LABEL_WIDTH = 165;

/** Inter-widget gap. Lower → date/time sit closer together (paired
 *  with a vertical Separator widget between them). */
const WIDGET_SPACING = 3;

/** Inner margin INSIDE the pill — pixels of empty space between the
 *  painted pill edge and the widget area. Combined with chip exterior
 *  padding, gives the chips visible breathing room from the pill
 *  curve. Same value on X and Y for symmetric inset. */
const FRAME_INNER_MARGIN_X = 6;
const FRAME_INNER_MARGIN_Y = 6;

/** Chip exterior padding — gap between each chip's painted edge and
 *  the pill edge (or adjacent chip). Symmetric on all four sides so
 *  chips look uniformly inset. Fork-only field. */
const CHIP_EXTERIOR_PADDING_PX = 9;

/** Chip interior padding — gap between chip edge and the text inside.
 *  Vertical (Y) is calibrated against `PILL_FONT_SIZE`: at 12 px font
 *  the rendered glyph height is ~15 px; a 6/6 split gives a 27 px
 *  chip that fits exactly within (BAR_HEIGHT_PX − 2×exterior) = 27 px.
 *  Horizontal (X) is intentionally larger so single-digit chips
 *  ("2", "3") read as pill-shaped rather than circles. Fork-only. */
const CHIP_INTERIOR_PADDING_X = 15;
const CHIP_INTERIOR_PADDING_Y = 6;

/** Chip corner radius. ~half the chip height (27 / 2) keeps the chip
 *  perfectly pill-shaped (full hemisphere ends — UNLIKE the bar
 *  itself, where the same ratio looks too aggressive). Fork-only. */
const CHIP_CORNER_RADIUS = 13;

/** Chip fill colour. `#D9D9D9` = light grey from the SVG reference
 *  (NOT pure white — pure white blew out the contrast on the dark
 *  bar fill, the slight grey reads as "inset" rather than "glowing").
 *  Fork-only override that bypasses `theme.auto_select_fill`. */
const CHIP_FILL_HEX = "#D9D9D9";
/** Chip text colour — pure black for max contrast on the light chip
 *  fill. Fork-only. */
const CHIP_TEXT_HEX = "#000000";
/** Chip border colour — 1 px black at 50 % opacity (encoded as 8-char
 *  hex `#RRGGBBAA`). Subtle inset stroke that defines the chip edge
 *  against the bar fill. Fork-only. */
const CHIP_BORDER_HEX = "#00000080";
const CHIP_BORDER_WIDTH_PX = 1;

/** Font family for all bar text. Falls back to the system default if
 *  Inter isn't installed (komorebi-bar tries the system font cache). */
const PILL_FONT_FAMILY = "Inter";
/** All-bar text size. Workspaces, date, time share this single value
 *  (they all render in the egui `Body` text style). 12 px is the
 *  sweet spot: large enough that date/time read as prominently as
 *  the focused-workspace chip text (which reads heavier due to
 *  black-on-white), small enough to fit in a 45 px bar. */
const PILL_FONT_SIZE = 12;
// NOTE: work_area_offset is NO LONGER written by the preset. Komodash
// derives it at apply time from this file's `height` + `margin.top` +
// the live taskbar height of the target monitor (see Rust
// `compute_bar_reservation` in src-tauri/src/lib.rs). The reservation
// is therefore single-sourced; users edit bar geometry, not the
// offset. See CONTEXT.md → Bar geometry.

export interface PillBarInput {
  /** Target monitor (komorebi index). Goes into the bar config as a
   *  bare integer; Komodash derives the per-monitor reservation. */
  monitorIndex: number;
  /** Pixel width of the target monitor — used only to scale the
   *  pill width (centered within a percentage of the screen). */
  monitorWidth: number;
  /** Pixel height of the target monitor. Currently unused (kept on
   *  the interface for callers that already pass it; the offset
   *  reservation no longer depends on monitor height — that decision
   *  moved into the backend, see CONTEXT.md → Bar geometry). */
  monitorHeight?: number;
  /** DPI scale factor of the target monitor (`1.0` for 100%, `1.25`
   *  for 125%, etc.). Komodash multiplies all physical-pixel bar
   *  fields by this so the bar renders at the same VISUAL size
   *  across monitors with different DPI. Defaults to `1.0` if the
   *  caller can't query it. */
  monitorScale?: number;
  /** Komorebi's `container_padding` (read from komorebi.json). The
   *  preset bumps `margin.top` to at least this value so the visible
   *  gap ABOVE the bar matches the gap BELOW it. Without that bump
   *  the bottom gap inherits container_padding while the top gap
   *  stays at the bare TOP_MARGIN_PX — asymmetric. Pass 0 when the
   *  caller can't read komorebi.json. */
  containerPadding?: number;
  /** Current theme block — preserved + augmented with cream chip
   *  defaults via the legacy `auto_select_fill` / `auto_select_text`
   *  fields (still useful on unpatched binaries). */
  currentTheme?: unknown;
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
  /** Outer chip padding — chip-to-pill gap. Fork-only field; stock
   *  komorebi-bar ignores it. */
  chip_padding: { top: number; bottom: number; left: number; right: number };
  /** Inner chip padding — text-to-chip-edge gap. Fork-only. */
  chip_inner_padding: { top: number; bottom: number; left: number; right: number };
  /** Chip corner radius. Fork-only. Set to chip_height/2 for pill shape. */
  chip_corner_radius: number;
  /** Chip background hex. Fork-only. */
  chip_fill: string;
  /** Chip text + selected widget text hex. Fork-only. */
  chip_text_color: string;
  /** Chip border color hex (supports 8-char hex for alpha). Fork-only. */
  chip_border_color: string;
  /** Chip border width in px. Fork-only. */
  chip_border_width: number;
  /** Bar pill fill hex (overrides theme bg). Fork-only. */
  bar_fill: string;
  /** Disable the hover-only chip fill. Selected chip still paints,
   *  but hovering non-selected widgets shows no chip. Fork-only. */
  chip_hover_disabled: boolean;
  /** Window backdrop effect. Fork-only. */
  backdrop: "None" | "Mica" | "Acrylic";
  theme: Record<string, unknown>;
  frame: { inner_margin: { x: number; y: number } };
  grouping: {
    kind: "Bar";
    rounding: number;
    style: string;
    transparency_alpha: number;
  };
  transparency_alpha: number;
  /** Target monitor for the bar. Bare integer (the SSOT design has
   *  Komodash compute `work_area_offset` at apply time — see CONTEXT
   *  .md → Bar geometry, ADR-0013). */
  monitor: number;
  /** Trimmed widget list. Overwrites the user's `left_widgets`. */
  left_widgets: unknown[];
  /** Trimmed widget list. Overwrites the user's `right_widgets`. */
  right_widgets: unknown[];
}

/**
 * Recompute the monitor-dependent slice of the pill style — pill
 * width centering + the bar-window position rectangle + the
 * top-gap margin that mirrors `container_padding`. All of these
 * depend on the target monitor's width and on komorebi's workspace
 * inset; if either changes, the bar config needs updating.
 *
 * Used by both [[buildPillPreset]] (full preset application) and
 * the [[BarConfig]] auto-refit hook (which triggers when the user
 * switches the bar's monitor via the placement dropdown — without
 * the auto-refit, `position.end.x` and `margin.left/right` stay
 * locked to the OLD monitor's width, producing a compressed,
 * off-center pill on a wider new monitor).
 */
export function computePillMonitorGeometry(
  monitorWidth: number,
  containerPadding: number,
  monitorScale: number = 1,
): {
  position: { end: { x: number; y: number }; start?: undefined };
  margin: { top: number; bottom: number; left: number; right: number };
  height: number;
} {
  // The pill's LOGICAL dimensions are the same on every monitor —
  // BAR_HEIGHT_PX, TOP_MARGIN_PX, pillWidth etc. are constants
  // chosen for how the bar should look (text size, breathing room,
  // chip proportions). Komorebi-bar interprets the values we put in
  // the bar config as PHYSICAL pixels, so on a HiDPI monitor we
  // have to multiply them by the monitor's DPI scale — otherwise
  // egui (which renders bar contents in logical pixels =
  // physical/scale) gets fewer logical pixels to work with on
  // higher-DPI monitors and the bar looks cramped.
  const scale = monitorScale > 0 ? monitorScale : 1;
  const phys = (logical: number) => Math.round(logical * scale);

  // pillWidth is computed in LOGICAL pixels first (so the clamps
  // make sense at the same logical proportions across monitors)
  // then converted to physical for the bar window.
  const monitorWidthLogical = monitorWidth / scale;
  const targetWidthLogical = Math.round(monitorWidthLogical * PILL_WIDTH_RATIO);
  const maxAllowedLogical = Math.max(
    0,
    monitorWidthLogical - 2 * MIN_SIDE_MARGIN,
  );
  const pillWidthLogical = Math.max(
    Math.min(MIN_PILL_WIDTH, maxAllowedLogical),
    Math.min(targetWidthLogical, MAX_PILL_WIDTH, maxAllowedLogical),
  );
  const sidePaddingLogical = Math.round(
    (monitorWidthLogical - pillWidthLogical) / 2,
  );
  const effectiveTopMarginLogical = Math.max(
    TOP_MARGIN_PX,
    Math.max(0, containerPadding),
  );

  return {
    position: { end: { x: monitorWidth, y: phys(BAR_HEIGHT_PX) } },
    margin: {
      top: phys(effectiveTopMarginLogical),
      bottom: 0,
      left: phys(sidePaddingLogical),
      right: phys(sidePaddingLogical),
    },
    height: phys(BAR_HEIGHT_PX),
  };
}

export function buildPillPreset(input: PillBarInput): PillBarPatch {
  const geom = computePillMonitorGeometry(
    input.monitorWidth,
    input.containerPadding ?? 0,
    input.monitorScale ?? 1,
  );
  const theme = buildPillTheme(input.currentTheme);

  return {
    position: geom.position,
    margin: geom.margin,
    height: geom.height,
    widget_spacing: WIDGET_SPACING,
    max_label_width: MAX_LABEL_WIDTH,
    font_family: PILL_FONT_FAMILY,
    font_size: PILL_FONT_SIZE,
    chip_padding: {
      top: CHIP_EXTERIOR_PADDING_PX,
      bottom: CHIP_EXTERIOR_PADDING_PX,
      left: CHIP_EXTERIOR_PADDING_PX,
      right: CHIP_EXTERIOR_PADDING_PX,
    },
    chip_inner_padding: {
      top: CHIP_INTERIOR_PADDING_Y,
      bottom: CHIP_INTERIOR_PADDING_Y,
      left: CHIP_INTERIOR_PADDING_X,
      right: CHIP_INTERIOR_PADDING_X,
    },
    chip_corner_radius: CHIP_CORNER_RADIUS,
    chip_fill: CHIP_FILL_HEX,
    chip_text_color: CHIP_TEXT_HEX,
    chip_border_color: CHIP_BORDER_HEX,
    chip_border_width: CHIP_BORDER_WIDTH_PX,
    bar_fill: BAR_FILL_HEX,
    chip_hover_disabled: true,
    /**
     * No DWM backdrop. Win11's Acrylic backdrop is rendered by the
     * OS compositor and ignores SetWindowRgn, so it can't be clipped
     * to our custom-radius pill — instead it bleeds past the rounded
     * corners as a rectangular halo. DWMWA_WINDOW_CORNER_PREFERENCE
     * is the only OS-honoured clip but only supports ~4 or ~8 px
     * (no custom radii). We pick design fidelity (clean pill at our
     * chosen radius) over OS blur. The bar fill stays translucent
     * so the desktop still shows through, just without GPU blur.
     */
    backdrop: "None",
    theme,
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
    monitor: input.monitorIndex,
    left_widgets: buildLeftWidgets(),
    right_widgets: buildRightWidgets(),
  };
}

/**
 * Build the theme block. We still write `auto_select_fill` /
 * `auto_select_text` as a fallback for users running stock komorebi-
 * bar without the fork's `chip_fill` / `chip_text_color` overrides
 * — that way the chip is at least cream-on-dark via the theme even
 * without the fork.
 */
function buildPillTheme(current: unknown): Record<string, unknown> {
  const cur = isRecord(current) ? current : {};
  const palette = typeof cur.palette === "string" ? cur.palette : null;

  if (palette === "Base16") {
    return {
      ...cur,
      accent: "Base05",
      auto_select_fill: "Base07",
      auto_select_text: "Base00",
    };
  }
  if (palette === "Catppuccin") {
    return {
      ...cur,
      accent: "Text",
      auto_select_fill: "Lavender",
      auto_select_text: "Base",
    };
  }
  return {
    palette: "Base16",
    name: "Ashes",
    accent: "Base05",
    auto_select_fill: "Base07",
    auto_select_text: "Base00",
  };
}

/**
 * Minimal left widget set: workspaces (with on-selected text
 * format) + small layout icon.
 */
function buildLeftWidgets(): unknown[] {
  return [
    {
      Komorebi: {
        workspaces: {
          enable: true,
          hide_empty_workspaces: false,
          /** Fork-only variant: selected workspace shows its name
           *  (e.g. "Workspace 1"), unselected show just their 1-based
           *  index ("2", "3", ...). Matches the SVG reference. */
          display: "IndexAndTextOnSelected",
        },
        // Layout widget intentionally omitted — Frame 39.svg is sparse
        // (workspaces left, date+time right). Re-enable in komorebi.
        // bar.json by hand if you want it back.
        layout: {
          enable: false,
        },
        focused_window: {
          enable: false,
        },
      },
    },
  ];
}

/**
 * Minimal right widget set: date + time, both with no leading icon
 * (the design shows just text).
 */
function buildRightWidgets(): unknown[] {
  return [
    {
      Date: {
        enable: true,
        format: "DayDateMonthYear",
        label_prefix: "None",
      },
    },
    {
      /** Vertical line between Date and Time. Fork-only widget type;
       *  stock komorebi-bar would fail to parse this so this preset
       *  REQUIRES the patched binary. Translucent white to read on
       *  the gray pill. */
      Separator: {
        enable: true,
        height: 11,
        width: 1,
        color: "#FFFFFF66",
      },
    },
    {
      Time: {
        enable: true,
        format: "TwentyFourHour",
        label_prefix: "None",
      },
    },
  ];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
