# Komodash installs Komorebi via winget (Scoop fallback), does not bundle

If Komorebi is not detected on first run, Komodash installs it by shelling out to **winget** (`winget install LGUG2Z.komorebi`). If winget is not available, Komodash falls back to **Scoop** (`scoop install extras/komorebi`). If neither package manager is present, Komodash shows a friendly page linking to Komorebi's install docs and exits to the dashboard in a Komorebi-not-installed state. Komodash does **not** bundle Komorebi binaries.

## Considered options

- *Config-editor only, refuse to help install* — would force the **End user** to know what a package manager is, contradicting [ADR-0003](./0003-sole-writer-non-technical-audience.md). Rejected.
- *Bundle Komorebi binaries inside Komodash* — gives zero-touch first-run but adds ~60 MB to the installer, makes Komodash responsible for mirroring every Komorebi release, and creates two upgrade paths for the same binary (Komodash bundle vs winget). Rejected for ongoing maintenance cost.

## Consequences

- Komodash stays small (~10 MB MSI) and ships independently of Komorebi.
- Komorebi upgrades are a `winget upgrade` away; Komodash exposes a one-click "Check for Komorebi update" button that wraps this.
- Komodash declares a **minimum-supported Komorebi version** in its manifest (currently `0.1.41`). Older installs trigger an in-app prompt to upgrade. Newer installs proceed normally — the schema-driven editor with the [Field catalog overlay](./0004-field-catalog-overlay.md) handles forward compatibility.
- If `komorebic` is detected on PATH but `komorebic --version` fails (broken install), Komodash treats the state as "not installed" and surfaces the actual error.
- A Komorebi *downgrade* scenario — config contains fields the running `komorebic` doesn't know — is handled by preserving unknown fields on save and surfacing a one-line "this config has fields the current Komorebi version doesn't recognise" notice. We do not strip them.
- Scoop is detected but never installed by Komodash. Its install path (a PowerShell one-liner) is something the user has already chosen to do or hasn't.
