import { create } from "zustand";

import { writeBarConfigMerged } from "@/api/bar";
import { applyBarConfig } from "@/api/bar";
import {
  writeConfig,
  writeStaticConfigMerged,
} from "@/api/config";
import { applyStaticConfig } from "@/api/apply";
import { applyWhkdrc, writeWhkdrc } from "@/api/hotkeys";
import {
  createUndoController,
  type Change,
} from "@/lib/undo-stack";

/**
 * Global undo stack (issue #21, per ADR-0006).
 *
 * Editors push a `Change` whenever they apply something the user
 * could reasonably want to revert. Ctrl+Z (wired at the App shell
 * level) calls `undo()`, which dispatches the reverse of the top
 * entry through the same Tauri command path the apply used —
 * keeping error surfaces consistent.
 *
 * Production handlers go straight to disk + restart the relevant
 * daemon; the underlying merge / write semantics already exist for
 * each kind (#17 merged static, #56 merged bar, #20 whkdrc parse).
 *
 * The pure controller + coalescing logic lives in
 * `src/lib/undo-stack.ts`; this module is the React-aware shell that
 * Zustand subscribers can react to.
 */
const controller = createUndoController({
  // ---- Static ----
  applyStatic: async (path, value) => {
    await writeStaticConfigMerged({ [path]: value }, [path]);
    try {
      await applyStaticConfig();
    } catch {
      // Live-apply may fail when Komorebi is not running. The disk
      // write succeeded so the change is durable; the editor will
      // surface any per-field error on its next read.
    }
  },
  // ---- Bar ----
  applyBar: async (config) => {
    if (typeof config !== "object" || config === null) return;
    const obj = config as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return;
    // Push the entire snapshot back through the merged-save endpoint
    // (every top-level key is "touched" for an undo restore so the
    // disk reflects the prior state exactly), then restart the bar.
    await writeBarConfigMerged(obj, keys);
    await applyBarConfig();
  },
  // ---- Whkdrc ----
  applyWhkdrc: async (model) => {
    if (typeof model !== "object" || model === null) return;
    await writeWhkdrc(model as Parameters<typeof writeWhkdrc>[0]);
    await applyWhkdrc();
  },
});

interface UndoStackState {
  /** Snapshot of the current undo stack. Re-rendered when entries
   *  push / pop so the menu / toast can show counts. */
  stack: Change[];
  /** Push + apply a Change. Coalesces same-path static changes
   *  within the 500 ms window. */
  apply: (change: Change) => Promise<void>;
  /** Pop + reverse the top Change. No-op when the stack is empty. */
  undo: () => Promise<void>;
}

export const useUndoStack = create<UndoStackState>((set) => ({
  stack: [],
  apply: async (change) => {
    await controller.apply(change);
    set({ stack: controller.peekStack() });
  },
  undo: async () => {
    await controller.undo();
    set({ stack: controller.peekStack() });
  },
}));

// Tree-shake-safe re-export so `import "writeConfig"` doesn't fail
// when this file is included via the App shell tree.
export { writeConfig };
