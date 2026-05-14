import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Mirrors `installer::PackageManagerKind` in Rust. */
export type PackageManagerKind = "winget" | "scoop";

/** Mirrors `installer::PackageManager`. */
export type PackageManager = {
  kind: PackageManagerKind;
  path: string;
};

/** Mirrors `installer::InstallResult`. */
export type InstallResult = {
  success: boolean;
  exit_code: number;
};

/** Detected host package managers, in preference order. */
export async function availablePackageManagers(): Promise<PackageManager[]> {
  return await invoke<PackageManager[]>("available_package_managers");
}

/** Kick off `winget install LGUG2Z.komorebi`. Subscribe to streaming
 * output via {@link onInstallationOutput} before calling. */
export async function installKomorebiViaWinget(): Promise<InstallResult> {
  return await invoke<InstallResult>("install_komorebi_via_winget");
}

/** Kick off `scoop install extras/komorebi`. Same streaming semantics. */
export async function installKomorebiViaScoop(): Promise<InstallResult> {
  return await invoke<InstallResult>("install_komorebi_via_scoop");
}

/** Subscribe to streamed install output. The handler is called once
 * per line of combined stdout/stderr from the install subprocess.
 * Returns an `UnlistenFn` — call it to stop receiving updates. */
export async function onInstallationOutput(
  handler: (line: string) => void,
): Promise<UnlistenFn> {
  return await listen<string>("installation-output", (e) => handler(e.payload));
}
