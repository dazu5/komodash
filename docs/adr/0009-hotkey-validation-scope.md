# Hotkey validation scope: what counts as a problem

The Hotkey editor surfaces five kinds of issue. Three are **errors** that disable the "Apply changes to hotkeys" button until resolved; one is a **warning** that does not block apply; one is silent **normalisation** with no UI surface at all.

| Kind | What | Surfaced as |
|---|---|---|
| Duplicate chord | Same chord bound twice | **Error** — both rows highlighted, Apply disabled |
| Invalid `komorebic` subcommand | Right-hand-side names a subcommand the **Command catalog** doesn't know | **Error** — Apply disabled |
| Missing/extra args for subcommand | `focus` without a direction, etc. | **Error** — Apply disabled |
| Windows-reserved chord | User binds e.g. `win+d` (OS owns it; the binding will silently not fire) | **Warning** — Apply still enabled |
| Modifier-order variance | `alt+shift+h` vs `shift+alt+h` | **Silent normalisation** — canonical order on display and save |

Explicitly **not detected** in v1:

- **Per-application reserved chords** (Discord, VS Code, etc. — anything that grabs hotkeys when focused). The false-positive surface is huge — *any* binding might collide with *some* app — and there's no authoritative catalog. We say nothing.
- **Chord-prefix sequences** (`alt+space` followed by `1`). whkd does not support sequences; the case does not arise.

## Considered options

- *Catch everything we can imagine* — including per-app reserved chords via a hand-maintained list. Rejected: a hand-maintained list would be wrong constantly and the warning UI would cry wolf.
- *No validation, save whatever the user typed* — simplest, but a non-technical user has no way to know why a binding silently doesn't work. Rejected.

## Consequences

- Komodash bundles a short list of **Windows-reserved chords** (~30 entries: Win+L, Win+D, Win+R, Win+Tab, Win+1..0, Alt+Tab, Alt+F4, Ctrl+Alt+Del, Ctrl+Shift+Esc, common media keys). The list is maintained in-repo, not fetched.
- The **Command catalog** is built by invoking `komorebic --help` and `komorebic <sub> --help` at first run and on Komorebi upgrade detection. Cached in `%LOCALAPPDATA%\komodash\`.
- The clear separation of *errors* (binding won't work) from *warnings* (binding might be eaten) gives the **End user** a predictable Apply experience: they can ship a config with warnings but never an invalid one.
- A future enhancement could add OS-API-based hotkey-collision detection on capture (try to register the chord, see if it fails). Out of scope for v1.
