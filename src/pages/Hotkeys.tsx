import { useCallback, useEffect, useState } from "react";
import { CircleCheck, KeyRound, PlayCircle, Plus, RotateCw } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-shell";
import { BindingRow } from "@/components/hotkey-editor/BindingRow";
import { useHotkeyBuffer } from "@/components/hotkey-editor/use-hotkey-buffer";
import {
  getCommandCatalog,
  type CommandCatalog,
} from "@/api/command-catalog";
import { applyWhkdrc } from "@/api/hotkeys";
import { detectKomorebi } from "@/api/komorebi";
import { cn } from "@/lib/utils";

/**
 * The Hotkeys page (issue #20). Renders one row per binding from the
 * parsed `WhkdrcModel`; each row gets a chord-capture input, a
 * command + args picker, an inline validation badge, and a delete
 * button. An "Add binding" button at the bottom appends a row. The
 * "Apply changes to hotkeys" button at the top restarts whkd so the
 * on-disk whkdrc changes take effect (buffered-apply per ADR-0006).
 *
 * Apply is disabled while any *error*-kind validation issue exists
 * (duplicate-chord, unknown-command, invalid-args); warnings (Windows-
 * reserved chords) don't block.
 *
 * When Komorebi is not running, the same "not running" banner pattern
 * as Configuration appears at the top.
 */
export default function HotkeysPage() {
  const {
    model,
    issues,
    loadError,
    pendingCount,
    hasErrors,
    updateBinding,
    addBinding,
    deleteBinding,
    markApplied,
  } = useHotkeyBuffer();
  const { running } = useKomorebiRunning();
  const catalog = useCommandCatalog();
  const [applying, setApplying] = useState(false);
  const [appliedAt, setAppliedAt] = useState<number | null>(null);

  const onApply = useCallback(async () => {
    if (hasErrors) return;
    setApplying(true);
    try {
      await applyWhkdrc();
      markApplied();
      setAppliedAt(Date.now());
      toast.success("Hotkeys applied — whkd restarted");
    } catch (e) {
      toast.error(
        `Couldn't apply hotkeys: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setApplying(false);
    }
  }, [hasErrors, markApplied]);

  if (loadError) {
    return (
      <div className="p-6 space-y-6">
        <PageHeader
          title="Hotkeys"
          subtitle="whkdrc — keyboard shortcuts for Komorebi commands."
        />
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Couldn't load whkdrc: {loadError}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Hotkeys"
        subtitle="whkdrc — keyboard shortcuts for Komorebi commands."
      />

      {!running && <NotRunningBanner />}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onApply}
          disabled={hasErrors || applying || pendingCount === 0}
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium",
            "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
          title={
            hasErrors
              ? "Fix the error rows before applying"
              : pendingCount === 0
                ? "No pending changes"
                : "Restart whkd with the new bindings"
          }
        >
          {applying ? (
            <>
              <RotateCw className="h-4 w-4 animate-spin" />
              Applying…
            </>
          ) : (
            <>
              <KeyRound className="h-4 w-4" />
              Apply changes to hotkeys
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

      {model && (
        <section className="rounded-lg border border-border bg-card">
          {model.bindings.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No bindings yet. Click "Add binding" to start.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {model.bindings.map((b, i) => (
                <BindingRow
                  key={i}
                  binding={b}
                  catalog={catalog}
                  issues={issues.filter((iss) => iss.binding_index === i)}
                  onChange={(next) => updateBinding(i, next)}
                  onDelete={() => deleteBinding(i)}
                />
              ))}
            </ul>
          )}
          <footer className="border-t border-border p-2">
            <button
              type="button"
              onClick={addBinding}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1 text-xs hover:bg-secondary/80 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add binding
            </button>
          </footer>
        </section>
      )}
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
          You can still edit hotkeys, but Apply only restarts whkd once
          Komorebi starts.
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

// ---- hooks ----------------------------------------------------------------

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

function useCommandCatalog(): CommandCatalog | null {
  const [catalog, setCatalog] = useState<CommandCatalog | null>(null);
  useEffect(() => {
    let cancelled = false;
    getCommandCatalog()
      .then((c) => {
        if (!cancelled) setCatalog(c);
      })
      .catch(() => {
        if (!cancelled) setCatalog(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return catalog;
}
