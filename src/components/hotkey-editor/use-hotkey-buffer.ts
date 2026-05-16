import { useCallback, useEffect, useRef, useState } from "react";

import type { ValidationIssue } from "@/api/hotkey-validator";
import {
  readWhkdrc,
  validateHotkeys,
  writeWhkdrc,
  type Binding,
  type WhkdrcModel,
} from "@/api/hotkeys";
import { useUndoStack } from "@/stores/undo-stack";

/**
 * Working-buffer hook for the Hotkeys editor (issue #20, per ADR-0006
 * buffered-apply semantics).
 *
 * - Loads the parsed whkdrc on mount.
 * - Every edit updates the in-memory buffer immediately.
 * - Writes the buffer to disk on every change (debounced 200 ms) so
 *   the user never loses work if Komodash crashes — but does NOT
 *   restart whkd. The user clicks Apply for that (a separate hook
 *   call: see `useWhkdrcApply` in the page component).
 * - Validation re-runs on every settled change so badges stay accurate.
 *
 * Difference from the Static-config working buffer (#18):
 *   - Static is Live-apply (writes + apply on every settled change).
 *   - whkdrc is buffered-apply (writes on settled change, apply only
 *     on explicit button click). Restarting whkd 30× during a drag is
 *     unacceptable UX per ADR-0006.
 */
export function useHotkeyBuffer() {
  const [model, setModel] = useState<WhkdrcModel | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baselineRef = useRef<string | null>(null);

  // Mount-time load.
  useEffect(() => {
    let cancelled = false;
    readWhkdrc()
      .then((m) => {
        if (cancelled) return;
        setModel(m);
        baselineRef.current = JSON.stringify(m);
        void runValidation(m);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Cleanup any pending write on unmount.
  useEffect(() => {
    return () => {
      if (writeTimer.current !== null) clearTimeout(writeTimer.current);
    };
  }, []);

  const runValidation = useCallback(async (m: WhkdrcModel) => {
    try {
      const v = await validateHotkeys(m);
      setIssues(v);
    } catch {
      setIssues([]);
    }
  }, []);

  /** Replace the model wholesale; schedules debounced write + re-validates. */
  const replace = useCallback(
    (next: WhkdrcModel) => {
      setModel(next);
      // Pending-count = whether buffer differs from baseline since last
      // applied (1 = unapplied changes exist; 0 = synced). We don't
      // track *count of edits* — that'd require a separate counter
      // tied to user actions. The button shows "Apply changes" either
      // way; the count is informational.
      setPendingCount(
        JSON.stringify(next) === baselineRef.current ? 0 : 1,
      );

      if (writeTimer.current !== null) clearTimeout(writeTimer.current);
      writeTimer.current = setTimeout(async () => {
        try {
          await writeWhkdrc(next);
        } catch (e) {
          // Soft-fail: surface via console; the user is still safe in
          // the buffer. The Apply step will re-attempt the write before
          // restarting whkd.
          // eslint-disable-next-line no-console
          console.warn("whkdrc write failed:", e);
        }
      }, 200);

      void runValidation(next);
    },
    [runValidation],
  );

  /** Edit the binding at `index`. */
  const updateBinding = useCallback(
    (index: number, next: Binding) => {
      if (!model) return;
      const bindings = model.bindings.slice();
      bindings[index] = next;
      replace({ ...model, bindings });
    },
    [model, replace],
  );

  /** Append a new empty binding (page-level "Add binding" button). */
  const addBinding = useCallback(() => {
    if (!model) return;
    const empty: Binding = {
      chord: { modifiers: [], key: "" },
      command: "",
      args: [],
    };
    replace({ ...model, bindings: [...model.bindings, empty] });
  }, [model, replace]);

  /** Remove the binding at `index`. */
  const deleteBinding = useCallback(
    (index: number) => {
      if (!model) return;
      const bindings = model.bindings.filter((_, i) => i !== index);
      replace({ ...model, bindings });
    },
    [model, replace],
  );

  const pushUndo = useUndoStack((s) => s.apply);

  /** Mark the buffer as the new baseline (called after a successful Apply).
   *  Also pushes the BEFORE→AFTER pair onto the global undo stack so
   *  Ctrl+Z reverts whkd to the previous applied state (issue #21). */
  const markApplied = useCallback(() => {
    if (!model) return;
    const beforeRaw = baselineRef.current;
    let beforeModel: WhkdrcModel | null = null;
    try {
      beforeModel = beforeRaw ? (JSON.parse(beforeRaw) as WhkdrcModel) : null;
    } catch {
      beforeModel = null;
    }
    baselineRef.current = JSON.stringify(model);
    setPendingCount(0);
    if (beforeModel) {
      void pushUndo({
        kind: "whkdrc-apply",
        before: beforeModel,
        after: model,
      });
    }
  }, [model, pushUndo]);

  // Derived: any error-kind issue → Apply is disabled.
  const hasErrors = issues.some(
    (i) =>
      i.kind === "duplicate-chord" ||
      i.kind === "unknown-command" ||
      i.kind === "invalid-args",
  );

  return {
    model,
    issues,
    loadError,
    pendingCount,
    hasErrors,
    updateBinding,
    addBinding,
    deleteBinding,
    markApplied,
  };
}
