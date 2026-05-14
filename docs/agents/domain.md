# Domain docs layout

Komodash is a **single-context** project. All domain language lives in one place:

- `CONTEXT.md` at the repo root — the canonical glossary

There is no `CONTEXT-MAP.md` and no per-subdomain CONTEXT files. If the project grows to the point where a single glossary feels strained, that is the trigger to split — until then, one file.

Architectural decisions live in `docs/adr/NNNN-slug.md`, one decision per file, numbered sequentially. ADRs are written **only** when a decision meets all three of:

1. Hard to reverse
2. Surprising without context
3. The result of a genuine trade-off
