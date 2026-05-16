import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleCheck, Plus, PlayCircle } from "lucide-react";

import { PageHeader } from "@/components/page-shell";
import { AddRuleModal } from "@/components/app-rules/AddRuleModal";
import { RuleRow } from "@/components/app-rules/RuleRow";
import { useWorkingBuffer } from "@/components/schema-editor/use-working-buffer";
import { getConfig } from "@/api/config";
import { detectKomorebi } from "@/api/komorebi";
import {
  flattenRules,
  insertRule,
  removeRule,
  type AppRule,
} from "@/lib/app-rules";
import { cn } from "@/lib/utils";

/** Map an `AppRule.kind` to the underlying static-config array key. */
const ARRAY_KEY_FOR_KIND: Record<AppRule["kind"], string> = {
  ignore: "ignore_rules",
  float: "floating_applications",
  manage: "manage_rules",
  workspace: "workspace_rules",
};

/**
 * App Rules page (issue #22, per ADR-0005 + ADR-0006).
 *
 * One flat list of rules across the five Komorebi rule arrays. Add /
 * delete operations live-apply via the Static-config pipeline (300 ms
 * debounced write + apply). When Komorebi isn't running, edits still
 * persist to disk; the apply step is skipped.
 */
export default function AppRulesPage() {
  const { content, error: readError } = useStaticConfig();
  const { running } = useKomorebiRunning();
  const initial = useParsedConfig(content);
  const { buffer, setField, savedAt, error: applyError, inFlight } =
    useWorkingBuffer({ initial, komorebiRunning: running });

  const rules = useMemo(() => (buffer ? flattenRules(buffer) : []), [buffer]);
  const [modalOpen, setModalOpen] = useState(false);

  const onAddRule = useCallback(
    (rule: AppRule) => {
      if (!buffer) return;
      const updated = insertRule(buffer, rule);
      const key = ARRAY_KEY_FOR_KIND[rule.kind];
      setField(key, updated[key as keyof typeof updated]);
    },
    [buffer, setField],
  );

  const onDeleteRule = useCallback(
    (rule: AppRule) => {
      if (!buffer) return;
      const updated = removeRule(buffer, rule);
      const key = ARRAY_KEY_FOR_KIND[rule.kind];
      setField(key, updated[key as keyof typeof updated]);
    },
    [buffer, setField],
  );

  /**
   * Bulk insert from a community-catalog import. Apply all rules to a
   * local copy of the buffer, then push only the changed array keys
   * through `setField` (one debounced flush per key).
   */
  const onImportRules = useCallback(
    (rules: AppRule[]) => {
      if (!buffer || rules.length === 0) return;
      let updated: ReturnType<typeof insertRule> = buffer;
      for (const rule of rules) {
        updated = insertRule(updated, rule);
      }
      const changedKeys = new Set(rules.map((r) => ARRAY_KEY_FOR_KIND[r.kind]));
      for (const key of changedKeys) {
        setField(key, updated[key as keyof typeof updated]);
      }
    },
    [buffer, setField],
  );

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Application Rules"
        subtitle="Tell Komorebi how to handle specific apps — edits Live-apply when Komorebi is running."
      />

      {!running && <NotRunningBanner />}

      <div className="flex items-center justify-between gap-3">
        <SaveIndicator savedAt={savedAt} inFlight={inFlight} />
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          disabled={!buffer}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md text-sm px-3 py-1.5",
            "transition-colors",
            buffer
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-secondary text-muted-foreground cursor-not-allowed",
          )}
        >
          <Plus className="h-4 w-4" />
          Add rule
        </button>
      </div>

      {readError && <ErrorPanel message={readError} />}
      {applyError && <ErrorPanel message={applyError.friendly} />}

      {!readError && !buffer ? (
        <LoadingPanel label="Loading configuration…" />
      ) : rules.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-1.5">
          {rules.map((rule, idx) => (
            <RuleRow
              key={`${rule.kind}-${rule.identifierKind}-${rule.id}-${rule.workspace ?? ""}-${idx}`}
              rule={rule}
              onDelete={onDeleteRule}
            />
          ))}
        </ul>
      )}

      <AddRuleModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onSave={onAddRule}
        onImport={onImportRules}
      />
    </div>
  );
}

// ---- subcomponents --------------------------------------------------------

function NotRunningBanner() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
      <div>
        <span className="font-medium">Komorebi is not running.</span>{" "}
        <span className="opacity-90">
          Rules are saved to disk and will take effect once Komorebi starts.
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

function SaveIndicator({
  savedAt,
  inFlight,
}: {
  savedAt: number | null;
  inFlight: boolean;
}) {
  if (inFlight) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        Saving…
      </span>
    );
  }
  if (savedAt === null) return null;
  const sinceSec = Math.max(0, Math.round((Date.now() - savedAt) / 1000));
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <CircleCheck className="h-3.5 w-3.5 text-emerald-400" />
      Saved {sinceSec === 0 ? "just now" : `${sinceSec}s ago`}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
      <p className="mb-2">No application rules yet.</p>
      <p className="text-xs">
        Click <span className="text-foreground font-medium">Add rule</span> to
        tell Komorebi to ignore, float, or pin a specific app to a workspace.
      </p>
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

// ---- hooks (mirror Config.tsx — extract to a shared module in a future pass) ----

function useStaticConfig() {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const v = await getConfig("static");
      setContent(v);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { content, refresh, error };
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

function useParsedConfig(content: string | null): Record<string, unknown> | null {
  return useMemo(() => {
    if (!content) return null;
    try {
      const parsed = JSON.parse(content);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }, [content]);
}
