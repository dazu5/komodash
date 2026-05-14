# Hybrid save model: Live-apply the Static configuration, explicit Apply for the bar and whkdrc

The **End user** edits three **managed configs**. Two of them — `komorebi.bar.json` and `whkdrc` — drive separate daemons (the Komorebi status bar and whkd respectively) that have **no documented hot-reload** and must be restarted to pick up changes. Restarting either causes a brief but visible interruption: the bar disappears for ~1 second, or hotkeys are unbound for <1 second. The third — `komorebi.json` — *does* support hot reload via `komorebic replace-configuration`, and applying it is visually cheap (windows briefly retile).

Komodash therefore uses a **hybrid save model**:

- **`komorebi.json`** → **Live-apply** with a 300 ms debounce. No save button. Every edit settles into a write + hot reload on its own.
- **`komorebi.bar.json`** and **`whkdrc`** → live-write to disk, but an **explicit "Apply changes" button** controls when the bar / whkd subsystem is actually restarted. The button shows a pending-change count.

All applied changes — both kinds — feed a single global **undo stack** the user reaches with Ctrl+Z. Failed applies surface as **inline red errors** under the offending field, with the Komorebi error translated to plain English; the file on disk stays at the last valid value and the buffer keeps the broken value so the user can fix it.

When Komorebi is not running, **Live-apply** silently degrades to "write to disk only" and the global status indicator says *"Komorebi is not running — changes will take effect when you start it"* with a one-click **Start Komorebi** button.

## Considered options

- *Fully live-apply for everything* — uniform mental model, but a non-coder dragging a colour picker on the bar would see the bar restart on every pixel of drag. Rejected for the flicker.
- *Explicit "Save" / "Apply" for everything (no live-apply)* — uniform mental model, familiar, but for the **Static configuration** it breaks the "I changed it, did it look right?" feedback loop that is the whole reason a non-technical user wants a GUI.

## Consequences

- The renderer tracks a per-file save semantic. The component for a `komorebi.json` field knows it is live-apply; the component for a bar field knows it is buffered.
- Debounce timings are tunable but defaults are committed: 300 ms for **Live-apply**, no debounce for buffered writes (they just don't trigger reloads).
- A single Ctrl+Z stack across all three files keeps "undo" cognitively simple. Undo reapplies the previous state of whichever file the change touched, including (for the bar / whkd) re-triggering the subsystem restart.
- "Komorebi not running" is a first-class state, not an error. The dashboard shows it and offers the recovery path inline.
