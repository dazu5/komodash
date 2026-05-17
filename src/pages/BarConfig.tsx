import { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, Info, Layout, PlayCircle, RotateCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-shell";
import { SchemaEditor } from "@/components/schema-editor";
import { useBufferedConfig } from "@/components/schema-editor/use-buffered-config";
import {
  applyBarConfig,
  getBarFieldCatalog,
  getBarSchema,
  getMonitorGeometry,
  resetMonitorWorkAreaOffset,
} from "@/api/bar";
import { getConfig } from "@/api/config";
import type { FieldCatalog } from "@/api/field-catalog";
import { detectKomorebi } from "@/api/komorebi";
import type { JsonSchema } from "@/api/schema";
import { buildPillPreset, computePillMonitorGeometry } from "@/lib/pill-bar-preset";
import { cn } from "@/lib/utils";

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

  // Note: monitor info is now fetched via Win32 (getMonitorGeometry),
  // not from useLiveState's snapshot. Snapshot is unreliable during
  // bar restarts which is exactly when we need it.

  const onApplyPill = useCallback(async () => {
    const targetIndex = extractMonitorIndex(JSON.stringify(value)) ?? 0;

    // Win32-direct lookup for monitor width + DPI scale. Bypasses
    // Komorebi's snapshot which goes stale during bar restarts.
    const geom = await getMonitorGeometry(targetIndex).catch(() => null);

    // Read the komorebi.json workspace inset so the preset can bump
    // margin.top — see CONTEXT.md → Bar geometry. Field names ARE
    // `default_workspace_padding` / `default_container_padding`
    // (bare names return 0).
    let containerPadding = 0;
    try {
      const raw = await getConfig("static");
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") {
        const wp =
          typeof obj.default_workspace_padding === "number" &&
          Number.isFinite(obj.default_workspace_padding)
            ? Math.max(0, Math.trunc(obj.default_workspace_padding))
            : 0;
        const cp =
          typeof obj.default_container_padding === "number" &&
          Number.isFinite(obj.default_container_padding)
            ? Math.max(0, Math.trunc(obj.default_container_padding))
            : 0;
        containerPadding = wp + cp;
      }
    } catch {
      // Komorebi may not be running, config may not exist, or it may
      // be malformed. Falls back to 0.
    }

    const patch = buildPillPreset({
      monitorIndex: targetIndex,
      monitorWidth: geom?.width ?? 1920,
      monitorHeight: geom?.height ?? 1080,
      monitorScale: geom?.scale ?? 1,
      containerPadding,
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
  }, [setField, value]);

  // Auto-refit: when the user picks a different monitor in the
  // placement dropdown, `position.end.x` and `margin.left/right`
  // need to be recomputed for the new monitor's actual width —
  // otherwise the bar sits cramped + off-center. Effect runs
  // whenever `value` changes; the ref guard limits actual refit
  // work to the cases where the monitor index just transitioned.
  //
  // NOTE: this fires on EVERY monitor switch regardless of whether
  // the user is using the pill preset. If you have a hand-crafted
  // `position` / `margin` you want to preserve across monitor
  // switches, ignore the dropdown and edit `monitor.index` in the
  // raw JSON editor instead.
  const lastMonitorRef = useRef<number | null>(null);
  useEffect(() => {
    if (value === null) return;
    const idx = extractMonitorIndex(JSON.stringify(value));
    if (idx === null) return;

    // First sighting — record but don't recompute.
    if (lastMonitorRef.current === null) {
      lastMonitorRef.current = idx;
      return;
    }
    if (idx === lastMonitorRef.current) return;

    lastMonitorRef.current = idx;

    const v = value as Record<string, unknown> | null;
    const margin = (v?.margin as Record<string, unknown> | undefined) ?? {};
    const currentTopMargin =
      typeof margin.top === "number" && Number.isFinite(margin.top)
        ? Math.trunc(margin.top)
        : 0;

    // Fetch monitor info from Win32 directly — bypasses the snapshot
    // entirely. Komorebi's snapshot drops monitor info while komorebi
    // -bar restarts to move the bar (which is the trigger for THIS
    // effect), so any snapshot-derived lookup is racing the restart.
    // Win32 is always available and reports physical dimensions.
    void (async () => {
      const geom_in = await getMonitorGeometry(idx).catch(() => null);
      if (!geom_in || geom_in.width <= 0) {
        // Win32 doesn't know about this monitor index — unusual
        // layout where EnumDisplayMonitors order doesn't match
        // Komorebi's index. Roll back the ref so a retry can happen
        // if the situation changes.
        lastMonitorRef.current = null;
        return;
      }
      const geom = computePillMonitorGeometry(
        geom_in.width,
        currentTopMargin,
        geom_in.scale,
      );
      setField("position", geom.position);
      setField("margin", geom.margin);
      setField("height", geom.height);
    })();
  }, [value, setField]);

  const onApply = useCallback(async () => {
    try {
      // Detect a monitor switch by comparing baseline (currently-
      // running config) to value (about-to-apply). Release the
      // abandoned monitor's reservation so its windows reflow.
      const prevIdx = extractMonitorIndex(baseline);
      const nextIdx = extractMonitorIndex(JSON.stringify(value));
      if (prevIdx !== null && nextIdx !== null && prevIdx !== nextIdx) {
        try {
          await resetMonitorWorkAreaOffset(prevIdx);
        } catch {
          // Komorebi might not be running, or the index is stale.
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

      <ContainerPaddingHint />

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

// ---- container_padding hint -----------------------------------------------

/**
 * Read-only hint surfacing the `container_padding` value from
 * `komorebi.json`. Container padding (a **Komorebi** concept, not a
 * **Bar configuration** one — see CONTEXT.md → Bar geometry) is what
 * produces the visible gap between tiled windows and the workspace
 * edges. The bar's `work_area_offset` only reserves space at monitor
 * edges; the *visible breathing room* on all four sides comes from
 * container_padding.
 *
 * Users were confused that "the side gap" and "the bottom gap" looked
 * like one knob but lived in two different files. This hint connects
 * them: shows the current value and explains where it comes from.
 */
function ContainerPaddingHint() {
  const [padding, setPadding] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getConfig("static")
      .then((raw) => {
        if (cancelled) return;
        try {
          const obj = JSON.parse(raw);
          // Read both `default_workspace_padding` and
          // `default_container_padding` and sum them — together they
          // make up the visible inset between workspace edge and
          // first window edge. (Bare `container_padding` / `workspace
          // _padding` ARE NOT real top-level fields in komorebi.json
          // even though the docs sometimes refer to them that way.)
          const wp =
            obj && typeof obj.default_workspace_padding === "number" &&
            Number.isFinite(obj.default_workspace_padding)
              ? Math.max(0, Math.trunc(obj.default_workspace_padding))
              : 0;
          const cp =
            obj && typeof obj.default_container_padding === "number" &&
            Number.isFinite(obj.default_container_padding)
              ? Math.max(0, Math.trunc(obj.default_container_padding))
              : 0;
          const total = wp + cp;
          setPadding(total > 0 ? total : null);
        } catch {
          setPadding(null);
        }
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) return null;

  const message =
    padding !== null && padding > 0
      ? `Your workspaces have ${padding} px of breathing room between tiled windows and the workspace edges — that's the gap you see on the sides and bottom of every window. Set in komorebi.json → container_padding.`
      : `No container_padding set in komorebi.json. Tiled windows currently sit flush to the workspace edges (no visible side or bottom gap). Add a value to komorebi.json → container_padding to introduce that breathing room.`;

  return (
    <div className="flex items-start gap-2.5 rounded-md border border-border/60 bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" />
      <span>{message}</span>
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
 * @deprecated Replaced by [[getMonitorGeometry]] which queries Win32
 * directly. Komorebi's snapshot drops monitor info during bar
 * restarts, making it unreliable for the use cases (auto-refit,
 * onApplyPill) that previously called this. Kept around in case any
 * future code wants snapshot-derived monitor info for non-critical
 * display, but should not be used in the bar's apply path.
 */
function pickLiveMonitor(
  snapshot: unknown,
  index: number,
): { width: number; height: number; left: number; top: number } | null {
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
  return { width, height, left, top };
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
