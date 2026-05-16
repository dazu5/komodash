import { invoke } from "@tauri-apps/api/core";

/** A discovered `komorebic.exe` install (mirrors the Rust `KomorebicInfo`). */
export type KomorebicInfo = {
  path: string;
  version: string;
  /**
   * Whether `version >= MIN_SUPPORTED_VERSION` declared in the Rust side
   * (currently `0.1.41`, per ADR-0007).
   */
  supported: boolean;
};

/** The shape `detect_komorebi` returns (mirrors the Rust `KomorebiState`). */
export type KomorebiState = {
  /** `null` when no working `komorebic.exe` was found. */
  installed: KomorebicInfo | null;
  /** `true` iff `komorebi.exe` is currently a running process. */
  running: boolean;
};

/** Snapshot whether Komorebi is installed and currently running. */
export async function detectKomorebi(): Promise<KomorebiState> {
  return await invoke<KomorebiState>("detect_komorebi");
}

// ---- Quick toggles (issue #14) --------------------------------------------
//
// These call `komorebic toggle-*` directly. They flip Komorebi's *runtime*
// state — the static config file is unchanged. To change the persistent
// default, edit the field on the Configuration page.

/** Toggle Komorebi's global pause state. */
export async function togglePause(): Promise<void> {
  await invoke<void>("toggle_pause");
}

/** Toggle the runtime "mouse follows focus" behaviour. */
export async function toggleMouseFollowsFocus(): Promise<void> {
  await invoke<void>("toggle_mouse_follows_focus");
}

/** Toggle "float override" — new windows float rather than tile. */
export async function toggleFloatOverride(): Promise<void> {
  await invoke<void>("toggle_float_override");
}

/** Re-tile every managed window on every workspace. */
export async function retile(): Promise<void> {
  await invoke<void>("retile");
}

/**
 * Focus a workspace on a monitor (issue #13). Indices are zero-based
 * and must match the order Komorebi reports in the Live state snapshot —
 * the Dashboard tree passes them straight through.
 *
 * The Live state subscription delivers the resulting state update
 * within ~100 ms; the caller does not need to re-fetch state manually.
 */
export async function focusWorkspace(
  monitorIndex: number,
  workspaceIndex: number,
): Promise<void> {
  await invoke<void>("focus_workspace", { monitorIndex, workspaceIndex });
}

/**
 * Launch the Komorebi daemon (issue #15). Defaults to `--whkd --bar`
 * per the issue body so the user's hotkeys and status bar come up
 * alongside Komorebi.
 *
 * Returns once `komorebic start` exits — Komorebi is still warming up.
 * Callers should rely on the Live state subscription (it reconnects
 * within ~2 s) to know when the daemon is actually serving.
 */
export async function startKomorebi(
  opts: { withWhkd?: boolean; withBar?: boolean } = {},
): Promise<void> {
  await invoke<void>("start_komorebi", {
    withWhkd: opts.withWhkd ?? true,
    withBar: opts.withBar ?? true,
  });
}

/**
 * Stop the Komorebi daemon (issue #15). Idempotent at the Rust layer —
 * calling this when Komorebi is not running succeeds quietly. Used by
 * Restart (after a crash) and as a standalone affordance.
 */
export async function stopKomorebi(): Promise<void> {
  await invoke<void>("stop_komorebi");
}
