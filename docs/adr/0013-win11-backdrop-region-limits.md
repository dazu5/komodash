# Win11 Acrylic, SetWindowRgn, and rounded corners — known OS limits

When implementing the pill-bar redesign (issue #73) we hit a cluster of Win32 limits that aren't well documented anywhere. Future bar-rendering work will run into the same walls; this ADR records what we learned so the next contributor doesn't have to re-research.

## What you can and can't do on Windows 11

| Want | Reality |
|---|---|
| Custom rounded-corner radius (e.g. 18 px) on a window | **No**. The only OS-honoured rounding APIs are `DWMWA_WINDOW_CORNER_PREFERENCE` (fixed at `~8` px Round or `~4` px RoundSmall) and `SetWindowRgn` (custom shape but jagged GDI clip with no antialiasing). Pick one. |
| Custom rounded corners with DWM Acrylic backdrop blur | **No**. DWM Acrylic (`DWMWA_SYSTEMBACKDROP_TYPE`) is composited by the OS *outside* the SetWindowRgn clip path. The Acrylic fills the full window rectangle regardless of region. Only `DWMWA_WINDOW_CORNER_PREFERENCE` clips the backdrop, and it's limited to the 4/8 px presets. |
| Anti-aliased rounded corners via `SetWindowRgn` | **No**. GDI region clipping is pixel-exact (no AA). Corners look jagged. |
| Anti-aliased rounded corners via egui paint | **Yes** — egui paints with smooth AA. Just don't apply `SetWindowRgn` on top, which would override AA with a hard clip. |
| Discover the Windows taskbar height programmatically | **Yes** — `GetMonitorInfoW` returns `rcMonitor` (full screen) and `rcWork` (excludes taskbar). `taskbar_height = rcMonitor.bottom - rcWork.bottom` (positive iff taskbar is at the bottom edge of that monitor). Auto-hidden taskbar → 0. |
| Per-monitor taskbar configuration | **Yes** — each monitor's `MONITORINFO` reports its own `rcWork`. Walk monitors via `EnumDisplayMonitors`. |
| Reliable mid-bar relocation without process restart | **Partially**. Bar window position is set via `SetWindowPos`; reliable. But work-area reservation (`MonitorWorkAreaOffset`) goes through komorebi's socket and is value-compared (`new != prev`) on the bar side, so identical values across a monitor switch get silently skipped. Komodash bypasses by always pushing via komorebic CLI directly. |

## Decisions we made in Komodash

1. **No Acrylic backdrop on the pill bar.** Trying to combine Acrylic + custom 18–24 px corners always leaves a rectangular halo behind the rounded pill. We paint our own translucent fill (`bar_fill` × `transparency_alpha`) on a transparent window instead. We lose GPU blur but get a clean silhouette at any corner radius.

2. **No `SetWindowRgn` on the bar window.** With no Acrylic to clip, the GDI region adds nothing visually and removes egui's anti-aliasing. Window stays rectangular and transparent; the painted pill defines the visible silhouette.

3. **Work-area-offset bottom is taskbar-aware.** `compute_bar_reservation()` (Komodash backend) probes `GetMonitorInfoW` per monitor to set `bottom = taskbar_height`. Visible taskbar → window stops above it; auto-hidden → bottom=0 and `container_padding` alone gives the gap.

## What we would do differently

If Microsoft eventually exposes a custom corner-radius DWM attribute (the unofficial `WCA_ACCENT_POLICY` API hints at this), we'd switch back to Acrylic. Worth a re-check every couple of Windows releases.

## Consequences

- The pill bar's `backdrop` config field stays in the schema (fork-only) for forward-compat but the preset writes `None`.
- `apply_pill_region` was removed from the komorebi-bar fork.
- All future "make this window's chrome look like X" requests should consult this matrix before promising a result.
