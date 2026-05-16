import { create } from "zustand";
import { onLiveStateUpdate, type LiveStateSnapshot } from "@/api/live-state";

/** Whether we've ever received a live-state event (proxy for "Komorebi
 * is alive and has connected to our pipe"). */
export type LiveStateStatus = "waiting" | "connected";

interface LiveStateStore {
  snapshot: LiveStateSnapshot | null;
  status: LiveStateStatus;

  /** Subscribe to the Tauri event stream and pipe events into the store.
   * Returns an unsubscribe function the caller MUST invoke on unmount.
   * Idempotent — calling twice without unsubscribing first is a leak,
   * but not a crash. */
  subscribe: () => Promise<() => void>;
}

export const useLiveState = create<LiveStateStore>((set) => ({
  snapshot: null,
  status: "waiting",
  subscribe: async () => {
    const unlisten = await onLiveStateUpdate((snapshot) => {
      set({ snapshot, status: "connected" });
    });
    return () => {
      unlisten();
      // Don't reset snapshot — the last view is more useful than nothing
      // while the user navigates away and back.
    };
  },
}));
