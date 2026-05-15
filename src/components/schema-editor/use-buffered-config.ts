import { useCallback, useEffect, useRef, useState } from "react";

import {
  getConfig,
  writeConfig,
  type ConfigKind,
} from "@/api/config";

/**
 * Buffered editor state for a Managed config that does NOT live-apply
 * (issue #19 — Bar config — per ADR-0006).
 *
 * Mirrors [`useWorkingBuffer`](./use-working-buffer.ts) but with two
 * key differences:
 *
 * 1. **No 300 ms debounce + automatic apply.** Edits update the
 *    in-memory buffer and (optionally) write to disk on a short
 *    debounce — but they DO NOT restart the underlying daemon. That
 *    happens only when the caller invokes the supplied Apply function.
 * 2. **Tracks the `pendingCount`** of edits-since-last-apply, so the
 *    Apply button can show a counter ("Apply changes (N)").
 *
 * Used by both the Bar editor (#19) and (planned) any future buffered
 * editor. The `kind` parameter routes the read/write through the
 * existing `managed_config` Tauri commands.
 *
 * `applyFn` is the caller-provided "restart the daemon" thunk. We
 * don't import it here so the hook stays decoupled from any specific
 * daemon's restart command.
 */
export function useBufferedConfig({
  kind,
  applyFn,
}: {
  /** Which managed config to read/write (currently only "bar" uses
   *  this hook; "whkdrc" has its own structured-model hook in #20). */
  kind: ConfigKind;
  /** Caller's restart-daemon thunk. Returns void; throws on failure
   *  so the caller can surface a Sonner toast. */
  applyFn: () => Promise<void>;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [value, setValue] = useState<Record<string, unknown> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [applying, setApplying] = useState(false);
  const [appliedAt, setAppliedAt] = useState<number | null>(null);
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baselineRef = useRef<string | null>(null);

  // Mount-time load.
  useEffect(() => {
    let cancelled = false;
    getConfig(kind)
      .then((raw) => {
        if (cancelled) return;
        setContent(raw);
        baselineRef.current = raw;
        try {
          const parsed = JSON.parse(raw || "{}");
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            setValue(parsed as Record<string, unknown>);
          }
        } catch (e) {
          setLoadError(
            `Couldn't parse ${kind} config: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  // Cleanup pending writes on unmount.
  useEffect(() => {
    return () => {
      if (writeTimer.current !== null) clearTimeout(writeTimer.current);
    };
  }, []);

  /** Update a top-level field. Writes to disk debounced 200 ms; does
   *  NOT call applyFn (Apply is the user's explicit button click). */
  const setField = useCallback(
    (key: string, next: unknown) => {
      setValue((prev) => {
        const merged = { ...(prev ?? {}), [key]: next };
        const serialised = JSON.stringify(merged, null, 2);
        setPendingCount(serialised === baselineRef.current ? 0 : 1);

        if (writeTimer.current !== null) clearTimeout(writeTimer.current);
        writeTimer.current = setTimeout(async () => {
          try {
            await writeConfig(kind, serialised);
            setContent(serialised);
          } catch {
            // Soft-fail; the buffer is still in memory. The next
            // setField or the Apply step will re-attempt.
          }
        }, 200);

        return merged;
      });
    },
    [kind],
  );

  /** Caller-driven apply: flush any pending write, then call the
   *  daemon-restart thunk. Updates baseline on success so the pending
   *  counter resets. */
  const apply = useCallback(async () => {
    // Flush any pending debounced write first.
    if (writeTimer.current !== null) {
      clearTimeout(writeTimer.current);
      writeTimer.current = null;
      if (value !== null) {
        try {
          await writeConfig(kind, JSON.stringify(value, null, 2));
        } catch {
          // best-effort
        }
      }
    }
    setApplying(true);
    try {
      await applyFn();
      baselineRef.current = JSON.stringify(value, null, 2);
      setPendingCount(0);
      setAppliedAt(Date.now());
    } finally {
      setApplying(false);
    }
  }, [applyFn, kind, value]);

  return {
    /** Raw content from disk (kept in sync after each settled write). */
    content,
    /** Parsed JSON object the editor renders. */
    value,
    /** Mount-time load error (typically only if the file is malformed). */
    loadError,
    /** Edits-since-last-apply count. */
    pendingCount,
    /** True between apply call start and resolution. */
    applying,
    /** ms-since-epoch of the most recent successful apply, or null. */
    appliedAt,
    /** Pass to `<SchemaEditor onFieldChange=… />`. */
    setField,
    /** Caller-driven Apply (restart daemon). */
    apply,
  };
}
