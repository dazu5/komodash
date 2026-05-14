# Field-catalog overlay on a schema-driven editor

Komodash renders the **Static configuration** editor from the JSON Schema (per [ADR-0002](./0002-schema-driven-editor.md)) but overlays a Komodash-bundled **Field catalog** that supplies human labels, descriptions, groupings, and widget hints for the fields the **End user** is most likely to touch. Fields not in the catalog still render — they fall into an "Other" group with raw schema metadata, so a new Komorebi field appears in the editor on the next launch even before Komodash ships a catalog update for it.

## Considered options

- *Show every field with raw schema labels* — purest auto-keepup but unusable for a non-technical audience; field names like `cross_monitor_move_behaviour` are not for **End users**.
- *Curate a hand-picked subset and hide the rest* — clean UX but loses ADR-0002's auto-keepup benefit: every new Komorebi field needs a Komodash release before it is reachable at all.
- *Two parallel editors ("Essentials" + "All settings")* — gets both benefits but roughly doubles the editor surface area for marginal gain over the overlay approach.

## Consequences

- The catalog is the **only place** where "make this field nice" work happens. The renderer stays generic.
- A new Komorebi version is never *blocked* on Komodash; it is just *less polished* until the catalog catches up.
- The catalog is small and grows over time. It ships in-binary so the editor is self-contained and works offline.
- Sub-decision (independent but consistent with the overlay model):
  - The **whkdrc** editor is hand-curated from the ground up — whkd has no schema, so there is nothing to overlay on. The catalog model does not apply.
  - The "App Rules" page is captured in its own ADR ([0005](./0005-app-rules-edit-in-config-arrays.md)).
