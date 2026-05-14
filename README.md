# Komodash

A dashboard for customizing **[Komorebi](https://github.com/LGUG2Z/komorebi)**, the Rust-based tiling window manager for Windows.

Komorebi is configured via a JSON file (`komorebi.json`), a bar config (`komorebi.bar.json`), an application-rules file (`applications.json`), and a plain-text hotkey file (`whkdrc`). Editing them by hand is fiddly. Komodash gives you a GUI on top of all of it.

> **Status:** early scaffold. See "Roadmap" below.

## What it does

- **Live state view** — monitors → workspaces → containers/windows, updated in real time via Komorebi's named-pipe subscription.
- **Schema-driven config editor** — auto-generated from `komorebic static-config-schema`, so it stays in sync with whatever Komorebi version you have installed.
- **Status bar editor** — visual editor for `komorebi.bar.json`.
- **Hotkey editor** — parses and edits your `whkdrc`, flags conflicts, validates `komorebic` subcommands.
- **App rules manager** — UI on top of `applications.json` plus the rule arrays in `komorebi.json` (ignore, float, workspace-specific).
- **Hot reload** — every save runs `komorebic replace-configuration` so changes apply without restarting Komorebi.

## Requirements

- Windows 10/11
- [Komorebi](https://github.com/LGUG2Z/komorebi) ≥ 0.1.41 (`komorebic.exe` on `PATH` or under `C:\Program Files\komorebi\bin\`)
- For dev: Node ≥ 20, pnpm ≥ 9, Rust ≥ 1.77, [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/)

## Dev

```powershell
pnpm install
pnpm tauri dev
```

## Build

```powershell
pnpm tauri build
```

Produces an `.msi` and an `.exe` (NSIS) installer under `src-tauri/target/release/bundle/`.

## Stack

- **Tauri 2** (Rust backend) — talks to `komorebic.exe`, reads/writes config files, subscribes to the named pipe for live state.
- **React 19 + TypeScript + Vite**
- **Tailwind v4 + shadcn/ui** for the UI
- **React Router 7** for navigation, **Zustand** for client state, **Sonner** for toasts, **CodeMirror** for raw-JSON views

## Roadmap

- [x] Scaffold Tauri 2 + React + TS + Tailwind + shadcn
- [ ] Rust backend: config I/O, schema, hot-reload
- [ ] Live-state subscription (named-pipe → Tauri events)
- [ ] Schema-driven editor pages
- [ ] whkdrc hotkey editor with conflict detection
- [ ] Application rules manager
- [ ] Dashboard with live workspaces and quick toggles
- [ ] First-run wizard, autostart toggle, packaged installer

## License

MIT
