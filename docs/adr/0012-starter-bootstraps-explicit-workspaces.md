# Starter config bootstraps explicit `monitors[].workspaces[]` sized to the user's displays

The **First-run wizard**'s Starter-config write injects an explicit `monitors[].workspaces[]` array sized to the detected monitor count (5 named workspaces per monitor) before writing `komorebi.json`. The bundled file on disk still omits `monitors` — the injection happens at write time in `starter_config::inject_workspaces`.

## Why

The status bar's workspace widget renders pips for workspaces Komorebi has actually created — it subscribes to live state, not the static config. With no `monitors` declared, Komorebi creates workspaces lazily on first focus (Alt+1 → workspace 0 spawned → 1 pip; Alt+2 → workspace 1 spawned → 2 pips; etc.). End users read the empty bar as a Komodash bug. See [issue #69](https://github.com/dazu5/komodash/issues/69).

Three options were considered (per the issue body):

- **A. Toggle the bar to "live state" mode.** Doesn't exist. `KomorebiWorkspacesConfig` only exposes `enable`/`display`/`hide_empty_workspaces` — there's no "always show N pips" option. The bar is already in live-state mode; that *is* the bug.
- **B. Bootstrap explicit workspaces in the Starter.** Reverses one line of ADR-0010's posture ("Starter currently omits `monitors`") but matches the Workspaces editor (#64), which is structured around explicit declaration. Chosen.
- **C. Document it.** Tells the user the bar is fine. Not a fix.

## Why per-monitor injection at write time, not in the bundled file

The Starter file is a static `include_str!` baked into the binary. Hardcoding `N` monitor blocks would either:
- Under-declare for multi-monitor users (the original bug),
- Over-declare for single-monitor users (extra phantom tabs in the Workspaces editor).

`GetSystemMetrics(SM_CMONITORS)` is a thread-safe Win32 read with no setup cost. Calling it during the wizard's `create_config` step (which runs before `start_komorebi`, so Komorebi's own monitor enumeration isn't available yet) yields the same count the user actually sees, modulo Remote-Desktop session shadows which the metric correctly excludes.

## Why 5 workspaces

- The default whkdrc binds Alt+1..Alt+5 to `focus-workspace 0..4`. 5 covers every default hotkey.
- More than 5 makes the bar wide and noisy on single-monitor laptops, undermining the "non-technical audience" posture of ADR-0003.
- Users wanting more (or fewer) can edit via the Workspaces editor (#64), which now ships and handles add/remove cleanly.

## Why `Workspace 1`..`Workspace 5` instead of opinionated names

Names like `Web`/`Code`/`Chat` impose intent. Generic `Workspace N` matches the Workspaces editor's `Add workspace` default so a user renaming through the editor sees continuous, recognisable defaults. Layout defaults to BSP, mirroring the rest of the Starter.

## Consequences

- ADR-0010's table doesn't mention `monitors` — that table covered deviations from `komorebic quickstart`'s defaults, not omissions. No revision needed; this ADR is additive.
- The Workspaces editor's empty-state ("Create explicit monitors config") will rarely trigger after first-run, because the Starter now seeds the array. It remains the path for users who arrived from a pre-#69 install or a hand-edited config that dropped `monitors`.
- If the injection fails (malformed bundled starter, serde error), `write_starter_config` falls back to the unmodified starter. Empty bar > broken first run.
- A user with 0 attached monitors (Remote Desktop edge case) gets no injection. Komorebi will handle that path itself.
