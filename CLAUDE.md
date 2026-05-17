# CLAUDE.md

Project-specific instructions for Claude Code working on Komodash.

## Quick orient

- **What this is:** A Tauri 2 desktop dashboard for the [Komorebi](https://github.com/LGUG2Z/komorebi) tiling window manager (Windows-only).
- **Stack:** Rust (Tauri 2 backend) + React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui.
- **Read first:** [`CONTEXT.md`](./CONTEXT.md) for the domain glossary, [`docs/adr/`](./docs/adr/) for past architectural decisions.

## Workflow

Komodash follows [Matt Pocock's skills workflow](https://github.com/mattpocock/skills). The order for any non-trivial change is:

1. `/grill-with-docs` — align on what's being built, update `CONTEXT.md` and ADRs as decisions crystallise
2. `/to-prd` — formalise the conversation as a PRD GitHub issue
3. `/to-issues` — slice the PRD into vertical-slice issues
4. `/tdd` — implement each slice red → green → refactor
5. `/improve-codebase-architecture` — periodic refactor passes

Do **not** start writing implementation code until a PRD issue exists. Scaffold-only changes (tooling, dependencies, CI) are exempt.

## Agent config

- **Issue tracker:** see [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md)
- **Triage labels:** see [`docs/agents/triage-labels.md`](./docs/agents/triage-labels.md)
- **Domain layout:** see [`docs/agents/domain.md`](./docs/agents/domain.md)

## Repo conventions

- **Default branch:** `main`. Feature work (every commit made in service of a sliced issue, from issue #2 onwards) must land via a pull request from a feature branch. **Foundational pre-PRD commits** — the initial project scaffold and the repo-bones / grill-output that produced [issue #1](https://github.com/dazu5/komodash/issues/1) — were made before the issue tracker had a baseline to PR against and may push directly. From this PR convention onwards, no further direct pushes.
- **Branch naming:** `<issue-number>-<short-slug>` (e.g. `7-named-pipe-subscription`), or `scaffold` / `repo-bones` for foundational work without an issue.
- **Commits:** end every commit message with the project's `Co-Authored-By` line for the model.
- **CONTEXT.md is a glossary only.** No specs, no scratch notes, no implementation details.
- **ADRs gate on three criteria:** hard to reverse, surprising without context, genuine trade-off. If a decision is none of those, it doesn't need an ADR.

## Run locally

```powershell
pnpm install
pnpm tauri dev    # first build of Tauri takes 5–10 minutes
```

### Hot-reload caveat

- **Frontend (TS / React)** hot-reloads via Vite — instant.
- **Backend (`src-tauri/`)** does NOT hot-reload. Any change in Rust requires `Ctrl+C` + `pnpm tauri dev` again, otherwise the running app is using the previously-built binary and your change has no effect. This has cost us multiple debugging rounds where a backend fix appeared to "not work" — it was just stale.

### Runtime diagnostics

Set `KOMODASH_TRACE=1` before `pnpm tauri dev` to surface dev-only `eprintln!` output (currently: the bar's `apply_bar_config` pipeline). First step of any "X isn't working" investigation for cross-layer flows.

```powershell
$env:KOMODASH_TRACE = "1"; pnpm tauri dev
```

For structured/file logging there's the separate `KOMODASH_LOG` env var (standard `tracing_subscriber::EnvFilter` syntax — e.g. `komodash=debug`); see `src-tauri/src/diag_log/`.

## Build a release

```powershell
pnpm tauri build  # outputs .msi and .exe under src-tauri/target/release/bundle/
```
