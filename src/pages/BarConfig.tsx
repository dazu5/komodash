import { useCallback, useEffect, useState } from "react";
import { CircleCheck, Layout, PlayCircle, RotateCw } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-shell";
import { SchemaEditor } from "@/components/schema-editor";
import { useBufferedConfig } from "@/components/schema-editor/use-buffered-config";
import {
  applyBarConfig,
  getBarFieldCatalog,
  getBarSchema,
} from "@/api/bar";
import type { FieldCatalog } from "@/api/field-catalog";
import { detectKomorebi } from "@/api/komorebi";
import type { JsonSchema } from "@/api/schema";
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
    loadError,
    pendingCount,
    applying,
    appliedAt,
    setField,
    apply,
  } = useBufferedConfig({ kind: "bar", applyFn: applyBarConfig });

  const onApply = useCallback(async () => {
    try {
      await apply();
      toast.success("Status bar restarted with new configuration");
    } catch (e) {
      toast.error(
        `Couldn't apply bar config: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [apply]);

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
