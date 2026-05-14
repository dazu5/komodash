# Komodash is a single-instance app, enforced via a Windows mutex

Launching Komodash a second time focuses the existing window and exits. A named mutex acquired at startup arbitrates which process is "the" Komodash. The mutex is held for the lifetime of the process.

## Considered options

- *Allow multi-instance* — power users could open two Komodash windows to compare different parts of the config side-by-side. Rejected: for the **End user** audience (per [ADR-0003](./0003-sole-writer-non-technical-audience.md)), two windows showing the same **Live state** is "which one is the real one?" confusion, and two instances racing writes on the same **Managed config** under [ADR-0003](./0003-sole-writer-non-technical-audience.md)'s sole-writer model is a class of bug we should not design around.

## Consequences

- Each Komodash launch attempts to acquire `Local\komodash-singleton`. Failure means another instance is live; we send it a focus-window message via the Tauri single-instance plugin and exit.
- The **Named pipe** used to subscribe to **Live state** is still UUID-suffixed (`komodash-{uuid}`) so a previous crash that left a stale subscription doesn't block the new instance. Singleton is the upstream guarantee; UUID-suffixed pipes are belt-and-braces against crashes that didn't release cleanly.
- The trade-off is a real one for **Power users**: side-by-side Komodash windows are not available. Documented; not a v1 issue.
