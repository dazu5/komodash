# ADR-0002: Drive the configuration editor from `komorebic static-config-schema`

- **Status:** Accepted
- **Date:** 2026-05-14
- **Deciders:** dazu5

## Context

`komorebi.json` is large (~4 400 lines of generated JSON Schema in v0.1.41) and Komorebi adds, renames, and reshapes fields with most releases. A hand-rolled editor would be perpetually out of date the moment Komorebi shipped a new version, and would silently drop unknown fields on save.

Komorebi already publishes its full **static config schema** as a JSON Schema document via `komorebic static-config-schema`. That schema is the source of truth for what a valid `komorebi.json` looks like.

## Decision

Komodash treats the schema from `komorebic static-config-schema` as the **source of truth for the editor's form structure**. The editor is generated from it. Hand-written code in the editor is limited to **custom widgets for specific Komorebi-shaped types** (e.g. border colours, layout pickers, monitor → workspace nesting) — never the field list itself.

The schema is fetched once at app start, cached in the Tauri backend, and refreshed when the user updates Komorebi.

## Consequences

**Positive**

- Komorebi version bumps require **zero changes** to Komodash to surface new fields: they appear automatically because the schema has them.
- Unknown fields in the user's existing config round-trip cleanly. We never silently drop a field we don't recognise.
- The editor stays honest — anything that isn't in the schema can't be edited, anything in the schema gets a sensible default control.

**Negative**

- The default control for any given field is generic (string → input, enum → select). To make it nice, we need custom widgets for the fields users actually care about (colours, layouts, padding, monitor nesting). Without those, the editor is functional but utilitarian.
- A breaking schema change in Komorebi (e.g. a renamed top-level field) shows up in the editor immediately. We surface it; users see what changed.
- The Komodash version baseline is "the schema features present in Komorebi X.Y.Z" — older Komorebi installs may render extra fields the running daemon doesn't understand. We mitigate this by always invoking the locally installed `komorebic` to fetch the schema, not a bundled copy.

**Alternatives rejected**

- *Hand-rolled forms* — full control over UX, but the entire editor would need an audit on every Komorebi release. Rejected for maintenance cost.
- *Bundled fixed-version schema* — would let us guarantee the UI matches one specific Komorebi version, but breaks the moment the user upgrades. Rejected because Komorebi releases more often than we will.
