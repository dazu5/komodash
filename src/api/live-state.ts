import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * One `live-state-update` payload as relayed verbatim from Komorebi's
 * `Notification` schema. Komodash does not model the structure on the
 * Rust side (everything passes through as `serde_json::Value`), so on
 * the TS side it's `unknown` plus helper navigators below.
 *
 * The full shape lives in `komorebic notification-schema` if you need
 * to reference it — it's roughly:
 *
 * ```ts
 * { event: NotificationEvent; state: State }
 * ```
 *
 * where `State` carries `monitors.elements[].workspaces.elements[].containers.elements[].windows.elements[]`
 * (Komorebi's `Ring<T>` wrapper appears as `{ elements: T[], focused: number }` at every list level).
 */
export type LiveStateSnapshot = unknown;

/**
 * Subscribe to the throttled live-state stream Komodash receives from
 * Komorebi. The handler fires at most once per ~33 ms (≤30 Hz) per the
 * Rust-side throttle. Returns an unsubscribe function — call it to
 * stop receiving updates.
 */
export async function onLiveStateUpdate(
  handler: (snapshot: LiveStateSnapshot) => void,
): Promise<UnlistenFn> {
  return await listen<LiveStateSnapshot>("live-state-update", (e) =>
    handler(e.payload),
  );
}
