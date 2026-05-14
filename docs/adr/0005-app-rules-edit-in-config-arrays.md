# The "App Rules" page edits the user's in-config rule arrays, not applications.json

Komorebi stores **Application rules** in two places: per-user rule arrays inside `komorebi.json` (the **Static configuration**), and a community-maintained `applications.json` file that ships rules for common Windows applications. Komodash's "App Rules" page **only edits the in-config rule arrays**. The community `applications.json` is treated as a read-only library that the **End user** can search and import individual rules from — but Komodash never writes to it.

## Considered options

- *Expose both files as separate editors* — accurate to the data model but exposes the distinction to the **End user**, who has no reason to know that "App Rules" is two files.
- *Edit `applications.json` directly* — simpler from Komodash's side, but the file is a community-maintained artefact that the user may sync via dotfiles or share between machines. Writing to it as if Komodash owned it would conflict with [ADR-0003](./0003-sole-writer-non-technical-audience.md): we are sole writer of what we manage, and `applications.json` is not ours to manage in that sense.

## Consequences

- The "App Rules" UI is one flat list, regardless of which underlying array (`ignore_rules`, `floating_applications`, `manage_rules`, `workspace_rules`, etc.) backs each entry.
- "Import from community" inserts the imported rule into the appropriate in-config rule array — never into `applications.json`.
- If the user has hand-edited `applications.json`, that file is preserved; Komodash ignores it for write purposes (but reads it for the search affordance).
- `applications.json` is classified as a **Community catalog** in [the CONTEXT glossary](../../CONTEXT.md), not a **Managed config**. Komodash reads it for the search affordance and may invoke `komorebic fetch-app-specific-configuration` to refresh it, but never authors content into it.
