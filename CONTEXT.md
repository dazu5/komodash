# CONTEXT

Shared domain glossary for Komodash. **Glossary only** — no implementation details, no specs, no scratch notes. New terms are added during `/grill-with-docs` sessions as they crystallise.

## Upstream (Komorebi) terms

Komorebi is the tiling window manager Komodash sits on top of. Komodash inherits its vocabulary; do not invent synonyms.

- **Komorebi** — the tiling window manager itself. The long-running binary is `komorebi.exe`.
- **komorebic** — the command-line client (`komorebic.exe`) that talks to a running Komorebi over its socket. Every imperative action the dashboard takes is a `komorebic` invocation.
- **whkd** — Windows Hotkey Daemon. A separate binary that maps key chords to `komorebic` invocations. Configured via a plain-text file, not JSON.
- **Static configuration** — the JSON file Komorebi loads at startup (and on `replace-configuration`). Canonical path: `~/komorebi.json`. Its shape is described by the JSON Schema emitted by `komorebic static-config-schema`.
- **Bar configuration** — JSON file describing the Komorebi status bar (`~/komorebi.bar.json`). Separate from the static configuration.
- **whkdrc** — the whkd hotkey file. Canonical path: `~/.config/whkdrc`. Plain text; supports comments, `.shell`, `.imports`, and one binding per line.
- **applications.json** — Komorebi's per-application rules file: which apps to ignore, float, treat as layered, etc. Canonical path: `~/applications.json`.
- **Monitor** — a physical display. Indexed; the index is stable for a given hardware setup.
- **Workspace** — a virtual desktop bound to a monitor. A monitor has one or more workspaces; the user switches between them.
- **Container** — a group of windows tiled together on a workspace. Stacking and tabbing happen inside containers.
- **Window** — a top-level OS window that Komorebi has decided to manage. Unmanaged windows are visible but ignored by the tiler.
- **Layout** — the tiling algorithm a workspace uses (BSP, columns, rows, vertical-stack, ultrawide-vertical-stack, custom, etc.).
- **Hot reload** — applying a changed `komorebi.json` to a running instance without restarting it, via `komorebic replace-configuration <path>`.
- **Named pipe** — the Windows IPC mechanism Komorebi uses to push state to subscribers. Komodash subscribes via `komorebic subscribe-pipe <name>` and reads from `\\.\pipe\<name>`.
- **Application rule** — an entry in `applications.json` (or one of the rule arrays in `komorebi.json`) that tells Komorebi how to treat a specific application: ignore it, float it, route it to a workspace, etc.
