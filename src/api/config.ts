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
