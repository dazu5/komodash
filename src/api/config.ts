import { invoke } from "@tauri-apps/api/core";

/** Mirrors `managed_config::ConfigKind` in Rust. */
export type ConfigKind = "static" | "bar" | "whkdrc";

/** Mirrors `backup_store::BackupRecord` in Rust. */
export type BackupRecord = {
  id: string;
  created_at: string;
  path: string;
  size_bytes: number;
};

/** Read the live content of a **Managed config**. Empty string when the
 * file does not exist yet. */
export async function getConfig(kind: ConfigKind): Promise<string> {
  return await invoke<string>("get_config", { kind });
}

/** Write a **Managed config**, backing the previous content up first. */
export async function writeConfig(kind: ConfigKind, content: string): Promise<void> {
  await invoke<void>("write_config", { kind, content });
}

/** Backups for `kind`, newest first. */
export async function listBackups(kind: ConfigKind): Promise<BackupRecord[]> {
  return await invoke<BackupRecord[]>("list_backups", { kind });
}

/** Restore a backup into the live config. The pre-restore content is
 * itself backed up first so the user can undo. */
export async function restoreBackup(
  kind: ConfigKind,
  id: string,
): Promise<void> {
  await invoke<void>("restore_backup", { kind, id });
}

/**
 * Return the list of top-level keys in the live Static configuration
 * that the currently-installed Komorebi's schema does NOT declare
 * (issue #17). Backs the Configuration page banner.
 *
 * Empty list when everything is known, when the file is empty, or on
 * any error — the banner is a heads-up, not a hard requirement.
 */
export async function detectUnknownFields(): Promise<string[]> {
  return await invoke<string[]>("detect_unknown_fields");
}

/**
 * Merged save of the Static configuration (issue #17). The frontend
 * passes its current Working buffer (`edits`) plus the set of top-level
 * keys the user actually touched. The backend reads the on-disk file
 * and only mutates the touched keys — every other key (known or
 * unknown to the current Komorebi schema) is preserved verbatim.
 *
 * Use this instead of `writeConfig("static", JSON.stringify(buffer))`
 * for Static once #18 (Live-apply) and beyond are wired to it. The
 * full-string `writeConfig` path stays in place for whkdrc / bar.
 */
export async function writeStaticConfigMerged(
  edits: Record<string, unknown>,
  touchedFields: string[],
): Promise<void> {
  await invoke<void>("write_static_config_merged", {
    edits,
    touchedFields,
  });
}
