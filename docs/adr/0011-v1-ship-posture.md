# v1 ships unsigned via GitHub Releases with local-only logging

For its v1 release, Komodash takes the **smallest credible shipping posture**: GitHub Releases as the canonical distribution channel, an in-app notification (not auto-download) for new versions, no code signing, and local-only diagnostic logs with no telemetry. Each of these has a fuller answer planned for v1.x, but v1 is built to ship without that infrastructure in place.

## The four decisions in one breath

- **Distribution.** GitHub Releases at https://github.com/dazu5/komodash/releases. Winget publish (`dazu5.komodash`) is a fast-follow once v1 is out. Tauri's signed updater pipeline is v1.x.
- **Update mechanism.** On launch, poll `api.github.com/repos/dazu5/komodash/releases/latest` (24-hour cache). If newer than the bundled version, show a non-blocking top banner with a "Download" button that opens the release page in the browser. No silent download, no restart-to-update modal.
- **Code signing.** Unsigned binaries. First-install SmartScreen warning is documented in the README with a screenshot and the "More info → Run anyway" walkthrough. We pay the reputation-warmup cost for the first hundred installs; we add a CA-issued or sigstore-based signing pipeline in v1.x.
- **Error reporting.** All Rust `tracing` output goes to `%LOCALAPPDATA%\komodash\logs\komodash-{date}.log`, daily rotation, last 7 retained. The About page has a "Copy diagnostic info" button that bundles the latest log, Komodash version, and Komorebi version into a paste-ready text block for GitHub Issues. No telemetry, no remote crash reporting, no opt-in tracking of any kind in v1.

## Considered options

- *Tauri auto-updater from day one* — best UX, but requires a signing certificate (cost), a hosted updater manifest endpoint, and CI integration. Each is a workable problem; together they delay v1 by weeks. Rejected for v1, planned for v1.x.
- *Sentry-style crash reporting from day one* — a real privacy and consent doc is required before remote reporting can ship. v1.x.
- *Skip GitHub Releases entirely, ship via winget only* — winget adoption is fast but not universal; users without it have no path. Hybrid (GitHub Releases now, winget as fast-follow) covers both audiences.

## Consequences

- The CI pipeline that builds Komodash needs only `tauri build` plus a GitHub Releases publish step. No signing secrets, no updater endpoint, no telemetry SDK.
- The README must explain the SmartScreen warning so first-time installers don't bail.
- A user reporting a bug pastes their diagnostic block; we don't have to ask twenty questions about their environment.
- When v1.x adds a signing pipeline, the in-app version-check stays exactly as is — the UX doesn't regress.
- When v1.x adds the Tauri updater, the banner becomes a one-click "Install now" instead of a "Download" → browser flow. Stepping-stone, not throwaway.
