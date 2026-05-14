import { invoke } from "@tauri-apps/api/core";

/**
 * A pending Komodash update (mirrors the Rust `UpdateInfo`).
 *
 * `tag_name` is whatever the maintainer named the release (typically
 * `vX.Y.Z`); `html_url` is the GitHub release page with the changelog
 * and download assets.
 */
export type UpdateInfo = {
  tag_name: string;
  html_url: string;
};

/**
 * Ask the backend whether a newer Komodash release exists.
 *
 * Returns `null` when the bundled version is up to date *or* the check
 * couldn't run (no cache dir, network down, malformed response) — the
 * backend swallows errors so the banner either appears or it doesn't.
 */
export async function checkKomodashUpdate(): Promise<UpdateInfo | null> {
  return await invoke<UpdateInfo | null>("check_komodash_update");
}
