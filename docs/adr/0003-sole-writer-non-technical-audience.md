# Komodash is the sole writer of Komorebi's config files

Komodash targets the **End user** — someone who does not want to edit JSON. To make that audience tractable, Komodash treats `komorebi.json`, `komorebi.bar.json`, and `whkdrc` as **managed configs** that it owns: it writes them in its own canonical format and may overwrite any hand-edit on the next save. The fourth Komorebi file — `applications.json` — is treated as a read-only **Community catalog** (see [ADR-0005](./0005-app-rules-edit-in-config-arrays.md)); Komodash never authors content into it. **Power users** who also edit the managed files directly are supported only insofar as Komodash will read whatever it finds — but their edits are not preserved through Komodash's save cycle.

## Considered options

- *Coexist with hand-edits* — watch the files, detect external changes, surface a conflict UI offering reload-vs-overwrite-vs-diff, and round-trip JSON5 comments so notes survive. Rejected: it pushes the entire editor design toward "fancy text editor with a form veneer," which is the wrong tool for someone who didn't want to see JSON in the first place. The conflict UI itself is JSON-shaped.
- *Refuse to start if a pre-existing config is detected* — clean ownership story, but a hostile first-run experience for the same people Komodash is for. Rejected.

## Consequences

- **No file-watcher conflict UI needed.** Komodash can warn ("file changed externally — reload?") for cosmetic reasons but the resolution is always "Komodash's buffer wins on save."
- **JSON formatting is Komodash's choice.** We normalise to plain JSON (or JSONC if we choose later) with our own key order and indentation. We do not round-trip comments.
- **First-run must adopt cleanly.** If an existing `komorebi.json` is found, Komodash reads it, surfaces a one-time notice that it now owns the file, and from that point on writes the canonical form.
- **Schema field names need humanisation.** A non-technical user shouldn't be reading `cross_monitor_move_behaviour` in a label. Field labels, descriptions, and validation messages all need a human pass — they can't be the raw JSON Schema strings.
- **No "raw JSON" view by default.** The presence of a raw editor would invite the **End user** to break their config in ways the form would have prevented. It can exist as an opt-in debugging surface but is not part of the primary UX.
