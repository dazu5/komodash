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
 * config parse fails entirely and the bar never starts.
 *
 * We use `Alignment`, not `Bar`: the left / center / right widget
 * groups each become their own content-sized pill instead of all
 * sharing one big pill. This matters because the focused-workspace
 * chip (`SelectableFrame` in komorebi-bar/src/selected_frame.rs)
 * always fills its parent UI's `max_rect` — with `Bar` grouping the
 * chip fills the whole bar height; with `Alignment` it only fills
 * the left group's height (a much smaller pill), matching the
 * reference design's "smaller chip inside a bigger pill" feel.
 */

const MIN_SIDE_MARGIN = 50;
const MIN_PILL_WIDTH = 900;
const MAX_PILL_WIDTH = 1500;
/** Pill width target — share of monitor width, clamped to MIN/MAX. */
const PILL_WIDTH_RATIO = 0.7;
const TOP_MARGIN_PX = 12;
const BAR_HEIGHT_PX = 52;
/** Half the bar height — gives the bar a true pill shape (semi-
 *  circular ends) rather than a softened rectangle. */
const PILL_ROUNDING = 26;
/** Clean container, no drop shadow. The dark solid fill against the
 *  desktop wallpaper carries the visual depth — matches the
 *  reference design's flat-but-premium feel. */
const PILL_STYLE = "Default";
/** High alpha (~92%) for a solid-dark pill — the reference design
 *  reads premium because the dark background gives strong contrast
 *  with the icons, not because of transparency. egui doesn't support
 *  backdrop blur so glass-style transparency just makes the pill
 *  look washed out on a dark wallpaper. */
const PILL_TRANSPARENCY = 235;
/** Truncate long window-title labels so one widget can't dominate
 *  the pill's horizontal real estate. Matches what a modern OS bar
 *  does instead of growing without bound. */
const MAX_LABEL_WIDTH = 180;
/** Gap between adjacent widgets. */
const WIDGET_SPACING = 16;
/** Inner padding inside the pill's rounded background. Must be
 *  STRICTLY GREATER than `PILL_ROUNDING` — otherwise content
 *  positioned at the inner-margin offset still falls inside the
 *  pill's curve, and inner-widget backgrounds (e.g. the focused-
 *  workspace chip) bleed past the rounded edge. */
const FRAME_INNER_MARGIN_X = 32;
const FRAME_INNER_MARGIN_Y = 8;
/** Inter is widely available on modern Windows installs (ships with
 *  some apps, common dev font). egui falls back to system default if
 *  it isn't installed — no parse failure. */
const PILL_FONT_FAMILY = "Inter";
const PILL_FONT_SIZE = 13;
/** Vertical work-area reservation. komorebi-bar's offset semantics:
 *  - `top` is added to the work area's top edge (pushes it down)
 *  - `bottom` is subtracted from the work area's HEIGHT
 *  Top reserve = top_margin + bar_height + top_margin again, so the
 *  gap from bar bottom to window top exactly equals the gap from
 *  screen top to bar top. Bottom reserve adds extra at the screen
 *  bottom so windows have visible breathing room from the screen
 *  edge (and from a Windows taskbar if present). */
const WORK_AREA_TOP_RESERVE = TOP_MARGIN_PX + BAR_HEIGHT_PX + TOP_MARGIN_PX;
const WORK_AREA_BOTTOM_PADDING = 24;
const WORK_AREA_BOTTOM_RESERVE = WORK_AREA_TOP_RESERVE + WORK_AREA_BOTTOM_PADDING;

export interface PillBarInput {
  monitorIndex: number;
  monitorWidth: number;
  monitorHeight: number;
  /** The user's current `theme` value from the bar config, if any.
   *  The preset reads its palette to pick a matching light-accent
   *  token (so the focused-workspace chip comes out cream against
   *  the dark pill instead of using the theme's default accent,
   *  which is often a saturated colour that clashes with the pill
   *  background). Pass `null` / `undefined` to let the preset fall
   *  back to Base16 Ashes with Base07 accent. */
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
  /** Theme block — preset writes this to set a light bar_accent so
   *  the focused-workspace chip comes out cream against the dark
   *  pill. Palette + name preserved from the user's existing theme
   *  when we know how to map; otherwise falls back to Base16 Ashes. */
  theme: Record<string, unknown>;
  frame: {
    inner_margin: { x: number; y: number };
  };
  grouping: {
    /** Discriminator for komorebi-bar's `#[serde(tag = "kind")]`
     *  Grouping enum. Without this field komorebi-bar fails parse
     *  with "missing field `kind`" and the bar never starts. "Bar"
     *  renders the whole widget set as ONE pill — matches the
     *  reference design's single-pill layout. (We tried "Alignment"
     *  briefly to dodge the chip-fills-pill-height issue but the
     *  user's design has one pill, not three.) */
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
  const theme = buildPillTheme(input.currentTheme);

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
    monitor: {
      // komorebi/src/workspace.rs:633-636 applies the offset as
      //   with_offset.top    += offset.top
      //   with_offset.bottom -= offset.bottom
      // where `bottom` is HEIGHT (Rect naming again). Asymmetric
      // values give us both a top reservation (for the pill) AND a
      // visual gap at the screen bottom (so windows don't touch the
      // monitor edge).
      index: input.monitorIndex,
      work_area_offset: {
        top: WORK_AREA_TOP_RESERVE,
        bottom: WORK_AREA_BOTTOM_RESERVE,
        left: 0,
        right: 0,
      },
    },
  };
}

/**
 * Build the theme block the preset will write. The goal is to
 * guarantee a CREAM/light focused-workspace chip against the dark
 * pill — komorebi-bar's `SelectableFrame` fill is driven by
 * `theme.bar_accent`, so this is the only knob that controls chip
 * colour. The value type for `bar_accent` is palette-dependent:
 * Base16 wants a `BaseNN` token, Catppuccin wants a colour name like
 * `Lavender`. So we read the user's current palette and pick the
 * matching light-accent token; for unknown shapes we fall back to
 * Base16 Ashes.
 */
function buildPillTheme(current: unknown): Record<string, unknown> {
  const cur = isRecord(current) ? current : {};
  const palette = typeof cur.palette === "string" ? cur.palette : null;

  if (palette === "Base16") {
    return {
      ...cur,
      // Base07 is the lightest base16 base colour ("light highlight"),
      // which reads as cream against most Base16 dark themes.
      bar_accent: "Base07",
    };
  }
  if (palette === "Catppuccin") {
    return {
      ...cur,
      // Lavender / Subtext1 read as soft cream against the dark
      // Catppuccin palettes (Frappe / Macchiato / Mocha).
      bar_accent: "Lavender",
    };
  }
  // Unknown / Custom / missing — fall back to a known-good dark
  // theme with cream accent so the design renders correctly.
  return {
    palette: "Base16",
    name: "Ashes",
    bar_accent: "Base07",
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
