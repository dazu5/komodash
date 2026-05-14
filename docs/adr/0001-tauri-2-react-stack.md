# ADR-0001: Build Komodash as a Tauri 2 desktop app with React + TypeScript + Tailwind + shadcn/ui

- **Status:** Accepted
- **Date:** 2026-05-14
- **Deciders:** dazu5

## Context

Komodash needs to edit configuration files on disk, shell out to `komorebic.exe`, and read from a Windows named pipe for live state. It is Windows-only. Distribution should be a single installable artefact, not a "start a server then open a browser" experience.

Four shells were considered: Tauri 2, Electron, a local web app (Node/Python backend + browser frontend), and a pure-static HTML+JS page editing a JSON copy.

## Decision

Komodash is a **Tauri 2** desktop app with a **React 19 + TypeScript + Vite** frontend, styled with **Tailwind v4** and **shadcn/ui** components.

## Consequences

**Positive**

- Tiny distributable (~10 MB MSI/NSIS) compared with ~100 MB for Electron.
- The Rust backend is a natural fit for the things Komodash needs to do: spawn `komorebic.exe`, read/write JSON with serde, and connect to a Windows named pipe via `tokio` + `windows-sys`. All of those have first-party Rust crates and no JS equivalent of similar quality.
- The frontend stack (React/TS/Tailwind/shadcn) is the most widely-known UI stack today; new contributors will not need to learn anything bespoke.

**Negative**

- Contributors must install Rust and the Tauri prerequisites to do desktop dev. Anyone who only wants to touch the UI can still run `pnpm dev` against a browser but loses access to backend commands.
- First `pnpm tauri dev` build compiles Tauri from source — roughly 5–10 minutes. Subsequent builds are fast.
- We are locked to Windows for v1. macOS / Linux ports would require gating Windows-only code (named pipes, registry, autostart) behind `cfg` attributes — but Komorebi itself is Windows-only, so this is a non-issue in practice.

**Alternatives rejected**

- *Electron* — same UI capability, ~10× the binary size, no compelling reason given the Rust backend gives us better access to the Windows APIs we actually need.
- *Local web app* — would have meant shipping a separate Node/Python runtime, plus the awkward "run this command, then open localhost" UX. Loses the single-installer story.
- *Pure static HTML+JS* — cannot read files, cannot shell out, cannot subscribe to the pipe. Reduces Komodash to a JSON validator with copy-paste.
