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

- **Default branch:** `main`. Direct pushes to `main` are blocked — open a PR from a feature branch.
- **Branch naming:** `<issue-number>-<short-slug>` (e.g. `7-named-pipe-subscription`), or `scaffold` / `repo-bones` for foundational work without an issue.
- **Commits:** end every commit message with the project's `Co-Authored-By` line for the model.
- **CONTEXT.md is a glossary only.** No specs, no scratch notes, no implementation details.
- **ADRs gate on three criteria:** hard to reverse, surprising without context, genuine trade-off. If a decision is none of those, it doesn't need an ADR.

## Run locally

```powershell
pnpm install
pnpm tauri dev    # first build of Tauri takes 5–10 minutes
```

## Build a release

```powershell
pnpm tauri build  # outputs .msi and .exe under src-tauri/target/release/bundle/
```
