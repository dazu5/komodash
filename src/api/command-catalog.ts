import { invoke } from "@tauri-apps/api/core";

/**
 * Mirrors Rust `command_catalog::CommandCatalog`. The Hotkeys editor
 * uses this to populate the subcommand picker for `komorebic`-prefixed
 * bindings (issue #20).
 */
export interface CommandCatalog {
  komorebic_version: string;
  commands: CommandSpec[];
}

export interface CommandSpec {
  name: string;
  summary: string;
  args: ArgSpec[];
}

export interface ArgSpec {
  name: string;
  required: boolean;
  possible_values: string[] | null;
}

/**
 * Fetch the cached Command catalog (issue #8). Cached at
 * `%LOCALAPPDATA%\komodash\command-catalog.json` and re-parsed when
 * Komorebi's version changes. Errors stringified by Rust.
 */
export async function getCommandCatalog(): Promise<CommandCatalog> {
  return invoke<CommandCatalog>("get_command_catalog");
}
