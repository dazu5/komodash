import { useCallback, useEffect, useState } from "react";
import { CircleCheck, Layout, PlayCircle, RotateCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-shell";
import { SchemaEditor } from "@/components/schema-editor";
import { useBufferedConfig } from "@/components/schema-editor/use-buffered-config";
import {
  applyBarConfig,
  getBarFieldCatalog,
  getBarSchema,
  resetMonitorWorkAreaOffset,
} from "@/api/bar";
import type { FieldCatalog } from "@/api/field-catalog";
import { detectKomorebi } from "@/api/komorebi";
import type { JsonSchema } from "@/api/schema";
import { buildPillPreset } from "@/lib/pill-bar-preset";
import { cn } from "@/lib/utils";
import { useLiveState } from "@/stores/live-state";

/**
 * The Status Bar page (issue #19).
 *
 * Schema-driven editor over `komorebi.bar.json` with the Bar Field-
 * catalog overlay. Edits write to disk on a 200 ms debounce but do NOT
 * auto-restart the bar daemon — per ADR-0006, the bar uses **buffered
 * apply** with an explicit button (restarting the bar daemon is
 * visually disruptive, ~1 s flicker).
 *
 * The Apply button restarts `komorebi-bar.exe` via the `apply_bar_config`
 * Tauri command. Disabled when there are no pending changes.
 */
export default function BarConfigPage() {
  const { schema, catalog, error: schemaError } = useBarSchemaSurface();
  const { running } = useKomorebiRunning();
  const {
    value,
    baseline,
    loadError,
    pendingCount,
    applying,
    appliedAt,
    setField,
    apply,
  } = useBufferedConfig({ kind: "bar", applyFn: applyBarConfig });

  const snapshot = useLiveState((s) => s.snapshot);

  const onApplyPill = useCallback(() => {
    const targetIndex = extractMonitorIndex(JSON.stringify(value)) ?? 0;
    const monitor = pickLiveMonitor(snapshot, targetIndex);
    const patch = buildPillPreset({
      monitorIndex: targetIndex,
      monitorWidth: monitor?.width ?? 1920,
      monitorHeight: monitor?.height ?? 1080,
      // Pass the current theme so the preset can preserve the user's
      // palette + name and only override `bar_accent` for a cream chip.
      currentTheme: (value as Record<string, unknown> | null)?.theme,
    });
    for (const [k, v] of Object.entries(patch)) {
      setField(k, v);
    }
    toast.success(
      "Pill style queued — review the preview, then Apply to restart the bar",
    );
  }, [setField, snapshot, value]);

  const onApply = useCallback(async () => {
    try {
      // Detect a monitor switch by comparing baseline (currently-
      // running config) to value (about-to-apply). If the bar is
      // moving to a different monitor, explicitly release the
      // abandoned monitor's work-area offset first — otherwise
      // Komorebi keeps the old reservation and windows on that
      // monitor don't reflow into the freed space. Best-effort:
      // we swallow this call's failure so the bar restart still
      // happens.
      const prevIdx = extractMonitorIndex(baseline);
      const nextIdx = extractMonitorIndex(JSON.stringify(value));
      if (
        prevIdx !== null &&
        nextIdx !== null &&
        prevIdx !== nextIdx
      ) {
        try {
          await resetMonitorWorkAreaOffset(prevIdx);
        } catch {
          // Komorebi might not be running, or the index is stale.
          // The bar restart below is still worth attempting.
        }
      }
      await apply();
      toast.success("Status bar restarted with new configuration");
    } catch (e) {
      toast.error(
        `Couldn't apply bar config: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [apply, baseline, value]);

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Status Bar"
        subtitle="komorebi.bar.json — widgets, layout, multi-monitor placement. Changes apply when you click Apply."
      />

      {!running && <NotRunningBanner />}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onApply}
          disabled={pendingCount === 0 || applying}
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium",
            "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
          title={
            pendingCount === 0
              ? "No pending changes"
              : "Restart the status bar with the saved configuration"
          }
        >
          {applying ? (
            <>
              <RotateCw className="h-4 w-4 animate-spin" />
              Applying…
            </>
          ) : (
            <>
              <Layout className="h-4 w-4" />
              Apply changes to status bar
              {pendingCount > 0 && (
                <span className="rounded-full bg-primary-foreground/20 px-1.5 text-xs">
                  {pendingCount}
                </span>
              )}
            </>
          )}
        </button>
        {appliedAt !== null && !applying && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <CircleCheck className="h-3.5 w-3.5 text-emerald-400" />
            Applied just now
          </span>
        )}
        <button
          type="button"
          onClick={onApplyPill}
          className={cn(
            "ml-auto inline-flex items-center gap-1.5 rounded-md border border-border",
            "bg-secondary hover:bg-secondary/80 px-3 py-1.5 text-sm",
            "transition-colors",
          )}
          title="Patch the bar config with a centered rounded-pill layout. Click Apply to actually restart the bar."
        >
          <Sparkles className="h-4 w-4" />
          Apply pill style
        </button>
      </div>

      <section className="space-y-2">
        {loadError ? (
          <ErrorPanel message={loadError} />
        ) : schemaError ? (
          <ErrorPanel message={schemaError} />
        ) : !schema || !catalog ? (
          <LoadingPanel label="Loading bar schema…" />
        ) : (
          <SchemaEditor
            schema={schema}
            catalog={catalog}
            value={value}
            onFieldChange={setField}
          />
        )}
      </section>
    </div>
  );
}

// ---- "Komorebi not running" banner ----------------------------------------

function NotRunningBanner() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
      <div>
        <span className="font-medium">Komorebi is not running.</span>{" "}
        <span className="opacity-90">
          You can still edit the bar config, but Apply only restarts the
          bar once Komorebi is up.
        </span>
      </div>
      <span
        className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/20 px-3 py-1 text-xs opacity-70"
        title="Use the Start Komorebi button on the Dashboard"
      >
        <PlayCircle className="h-3.5 w-3.5" />
        Start on Dashboard
      </span>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {message}
    </div>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

// ---- hooks ----------------------------------------------------------------

/** Fetch the bar schema + the bundled bar field-catalog once on mount.
 *  Same shape as the Static config's `useSchemaSurface`. */
function useBarSchemaSurface() {
  const [schema, setSchema] = useState<JsonSchema | null>(null);
  const [catalog, setCatalog] = useState<FieldCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getBarSchema(), getBarFieldCatalog()])
      .then(([s, c]) => {
        if (cancelled) return;
        setSchema(s);
        setCatalog(c);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { schema, catalog, error };
}

/**
 * Pull the bar's target monitor index out of a serialised
 * `komorebi.bar.json` string. The `monitor` field is an anyOf union —
 * accepts a bare integer index OR a `{ index, work_area_offset? }`
 * object. Returns null if neither form is present, the JSON is
 * unparseable, or the field is absent.
 *
 * Used by the Apply path to detect a monitor-switch so we can release
 * the abandoned monitor's reserved bar pixels before restarting the
 * bar — without this, Komorebi keeps the previous monitor's
 * work-area offset and windows there don't reflow.
 */
function extractMonitorIndex(serialised: string | null): number | null {
  if (serialised === null) return null;
  try {
    const obj = JSON.parse(serialised);
    if (!obj || typeof obj !== "object") return null;
    const m = (obj as Record<string, unknown>).monitor;
    if (typeof m === "number" && Number.isFinite(m)) {
      return Math.trunc(m);
    }
    if (m && typeof m === "object" && !Array.isArray(m)) {
      const idx = (m as Record<string, unknown>).index;
      if (typeof idx === "number" && Number.isFinite(idx)) {
        return Math.trunc(idx);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Pull the {width, height} of the named monitor from the live-state
 * snapshot. Returns null when the snapshot isn't available yet
 * (Komorebi not running, first event not yet received) — the caller
 * substitutes a sensible default in that case.
 */
function pickLiveMonitor(
  snapshot: unknown,
  index: number,
): { width: number; height: number } | null {
  const state = (snapshot as { state?: unknown } | null)?.state;
  if (!state || typeof state !== "object") return null;
  const ring = (state as Record<string, unknown>).monitors as
    | { elements?: unknown[] }
    | undefined;
  const elements = Array.isArray(ring?.elements) ? ring.elements : [];
  const m = elements[index];
  if (!m || typeof m !== "object") return null;
  const size = (m as Record<string, unknown>).size;
  if (!size || typeof size !== "object") return null;
  const s = size as Record<string, unknown>;
  const left = numberOr(s.left, 0);
  const right = numberOr(s.right, 0);
  const top = numberOr(s.top, 0);
  const bottom = numberOr(s.bottom, 0);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function useKomorebiRunning() {
  const [running, setRunning] = useState(false);
  useEffect(() => {
    let cancelled = false;
    detectKomorebi()
      .then((s) => {
        if (!cancelled) setRunning(s.running);
      })
      .catch(() => {
        if (!cancelled) setRunning(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { running };
}
