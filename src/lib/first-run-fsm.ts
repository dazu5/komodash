/**
 * First-run wizard FSM (issue #23, per ADR-0007 + ADR-0010).
 *
 * The wizard is a finite state machine over the four things that must
 * be true before the **End user** can use Komorebi: it has to be
 * installed, configured, running, and (optionally but recommended) set
 * to launch on login. The FSM walks the user through whichever of those
 * conditions don't pass detection, one card at a time.
 *
 * This module is pure logic — no React, no Tauri. Tests cover every
 * transition; the wizard component is a thin renderer that calls
 * `nextState` after each action and re-runs detection.
 */

/** Snapshot of the four detection signals. All four → wizard skips. */
export interface DetectionResult {
  installed: boolean;
  configExists: boolean;
  running: boolean;
  autostartEnabled: boolean;
}

/**
 * Wizard states, in the natural prerequisite order. `detecting` runs
 * detection then transitions to the first failing condition or `done`.
 * `done` lands the user on the Dashboard.
 */
export type WizardState =
  | "detecting"
  | "install_komorebi"
  | "create_config"
  | "start_komorebi"
  | "enable_autostart"
  | "done";

/**
 * Given the current state and the latest detection result, return the
 * next state. Called on wizard mount and after every successful
 * step-action (re-run detection then transition).
 *
 * The ordering of condition checks is the user-facing wizard order:
 * install → config → start → autostart. Any failing condition wins.
 * When everything passes, we return `done`.
 */
export function nextState(
  _current: WizardState,
  detection: DetectionResult,
): WizardState {
  if (!detection.installed) return "install_komorebi";
  if (!detection.configExists) return "create_config";
  if (!detection.running) return "start_komorebi";
  if (!detection.autostartEnabled) return "enable_autostart";
  return "done";
}
