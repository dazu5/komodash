# Komodash ships an opinionated Starter config that differs from `komorebic quickstart`

When the **First-run wizard** needs to create a `komorebi.json` for an **End user** with no existing config, Komodash uses its own bundled **Starter config** rather than just running `komorebic quickstart` and taking the output verbatim. The Starter config seeds the user with defaults chosen for the non-technical audience, where they differ from upstream's developer-tuned quickstart.

## Defaults that differ from `komorebic quickstart`

| Setting | Komodash Starter | `komorebic quickstart` | Why we differ |
|---|---|---|---|
| `mouse_follows_focus` | `true` | `false` | A non-coder switches focus by clicking, not by keyboard. With it off, clicking a window doesn't make it the Komorebi-focused window, and hotkeys then feel inconsistent. |
| `animation.enabled` | `true` (250 ms ease-out-cubic, 60 fps) | (default off / unset) | Tile transitions explain what just happened. For first-timers, "the window jumped" without animation looks like a bug. |
| `border.enabled` | `true`, 4 px, focused colour distinct | (default — varies) | The focused tile must be visually unambiguous for someone who hasn't internalised the mental model yet. |
| Default **Layout** | `bsp` | `bsp` (same) | No divergence — BSP is the most intuitive starter layout regardless of audience. |
| Float override | `false` | `false` (same) | Start in tile-everything mode. |
| Status bar | `enabled` with default widget set | `enabled` (same) | No divergence. |
| Hotkeys (`whkdrc`) | Copied verbatim from quickstart | (the file itself) | The quickstart bindings are good. No reason to deviate. |

## Considered options

- *Take `komorebic quickstart` verbatim* — simpler (no Komodash-owned starter file to maintain) but ships our **End users** with defaults that hurt them, specifically `mouse_follows_focus = false`. Rejected.
- *Empty config (let Komorebi compute defaults)* — even simpler, but leaves no editable rows in the editor on first launch and skips the chance to introduce sensible visual feedback. Rejected.

## Consequences

- The Starter config lives in-repo at a fixed path (e.g. `src-tauri/resources/starter-config.json`) and is bundled into the Tauri binary. Updates ship with Komodash releases.
- When the upstream `komorebic quickstart` schema changes, Komodash's Starter must be updated to stay valid. This is detected in CI by running `komorebic --version` against the latest pinned Komorebi and validating the Starter against `komorebic static-config-schema`.
- The Starter is **not** read again after first-run setup. Once the user has a `komorebi.json`, it is theirs — Komodash does not overwrite or "reset to defaults" without an explicit user action.
