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
