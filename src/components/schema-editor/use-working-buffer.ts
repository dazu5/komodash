import { useCallback, useEffect, useRef, useState } from "react";

import { applyStaticConfig, type ApplyError } from "@/api/apply";
import { writeConfig } from "@/api/config";

/**
 * Live-apply orchestrator for the Static configuration (issue #18, per
 * ADR-0006).
 *
 * - Holds the in-memory **Working buffer**: a copy of the parsed config
 *   that field widgets edit directly.
 * - Debounces 300 ms after the last edit, then writes the buffer to
 *   disk and tells Komorebi to reload.
 * - On apply failure, the bad value stays in the buffer; the caller
 *   reads `error` for the offending field and renders an inline red
 *   note. The previous-valid state on disk is preserved by the write
 *   step skipping when validation fails.
 * - `komorebiRunning === false` skips the apply step (silent degrade
 *   per ADR-0006); the write to disk still happens.
 *
 * The hook does NOT do per-field validation — that's handled by
 * Komorebi itself (we shell out, it tells us). We trust the user's
 * edit until Komorebi rejects it.
 */
export function useWorkingBuffer({
  initial,
  komorebiRunning,
}: {
  /** The parsed config as read from disk; null until first fetch. */
  initial: Record<string, unknown> | null;
  /** From `detect_komorebi.running`. Toggles apply-vs-write-only mode. */
  komorebiRunning: boolean;
}) {
  const [buffer, setBuffer] = useState<Record<string, unknown> | null>(initial);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<ApplyError | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-seed when the initial value arrives or refreshes from disk.
  useEffect(() => {
    setBuffer(initial);
  }, [initial]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const flush = useCallback(
    async (next: Record<string, unknown>) => {
      setInFlight(true);
      setError(null);
      try {
        const serialised = JSON.stringify(next, null, 2);
        await writeConfig("static", serialised);
        if (komorebiRunning) {
          await applyStaticConfig();
        }
        setSavedAt(Date.now());
      } catch (e) {
        setError(toApplyError(e));
      } finally {
        setInFlight(false);
      }
    },
    [komorebiRunning],
  );

  /**
   * Update a single top-level field. The widget calls this on every
   * keystroke / toggle; the debounce keeps Komorebi from being reloaded
   * 30× during a drag.
   */
  const setField = useCallback(
    (key: string, value: unknown) => {
      setBuffer((prev) => {
        const next = { ...(prev ?? {}), [key]: value };
        if (debounceRef.current !== null) {
          clearTimeout(debounceRef.current);
        }
        debounceRef.current = setTimeout(() => {
          void flush(next);
        }, 300);
        return next;
      });
    },
    [flush],
  );

  return {
    /** Current buffer; pass to `<SchemaEditor value=... />`. */
    buffer,
    /** Wire to widget `onChange` props. */
    setField,
    /** ms-since-epoch of the most recent successful apply, or null. */
    savedAt,
    /** Most recent apply failure, or null. */
    error,
    /** True between debounce-fire and apply settle. */
    inFlight,
    /** Clear the inline error after the user starts a fresh edit. */
    clearError: () => setError(null),
  };
}

function toApplyError(e: unknown): ApplyError {
  if (
    typeof e === "object" &&
    e !== null &&
    "friendly" in e &&
    "raw" in e &&
    typeof (e as Record<string, unknown>).friendly === "string"
  ) {
    return e as ApplyError;
  }
  const msg = e instanceof Error ? e.message : String(e);
  return { friendly: msg, raw: msg };
}
