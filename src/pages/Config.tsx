import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleCheck, Code2, FormInput, Info, PlayCircle, RotateCcw } from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-shell";
import { SchemaEditor } from "@/components/schema-editor";
import { useWorkingBuffer } from "@/components/schema-editor/use-working-buffer";
import {
  detectUnknownFields,
  getConfig,
  listBackups,
  restoreBackup,
  type BackupRecord,
} from "@/api/config";
import {
  getFieldCatalog,
  type FieldCatalog,
} from "@/api/field-catalog";
import { detectKomorebi } from "@/api/komorebi";
import { getSchema, type JsonSchema } from "@/api/schema";
import { cn } from "@/lib/utils";

/**
 * The Configuration page (issues #7 + #11 + #17 + #18).
 *
 * The default Form view is the schema-driven editor. With Komorebi
 * running, edits debounce 300 ms and Live-apply per ADR-0006. With
 * Komorebi not running, edits still persist to disk; a banner explains
 * why apply is deferred (Start affordance lives on the Dashboard per
 * #15).
 *
 * The Raw JSON toggle falls back to the CodeMirror read-only view from
 * #7. The backups sidebar stays in either mode. An additional banner
 * from #17 lists root-level fields the current Komorebi schema doesn't
 * know about (typically after a downgrade) — those fields are
 * preserved as-is on save.
 */
export default function ConfigPage() {
  const { content, refresh: refreshContent, error: readError } =
    useStaticConfig();
  const { backups, refresh: refreshBackups } = useBackups();
  const { schema, catalog, error: schemaError } = useSchemaSurface();
  const { running } = useKomorebiRunning();
  const unknownFields = useUnknownFields(content);
  const [view, setView] = useState<"form" | "raw">("form");

  const initial = useParsedConfig(content);
  const { buffer, setField, savedAt, error: applyError, inFlight } =
    useWorkingBuffer({ initial, komorebiRunning: running });

  // After a successful apply, refresh the on-disk content so the
  // "Raw JSON" view stays consistent with reality.
  useEffect(() => {
    if (savedAt !== null) {
      void refreshContent();
      void refreshBackups();
    }
  }, [savedAt, refreshContent, refreshBackups]);

  const onRestore = useCallback(
    async (record: BackupRecord) => {
      try {
        await restoreBackup("static", record.id);
        toast.success(`Restored backup from ${record.created_at}`);
        await refreshContent();
        await refreshBackups();
      } catch (e) {
        toast.error(`Restore failed: ${formatError(e)}`);
      }
    },
    [refreshContent, refreshBackups],
  );

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Configuration"
        subtitle="komorebi.json — edits Live-apply when Komorebi is running."
      />

      {!running && <NotRunningBanner />}
      {unknownFields.length > 0 && (
        <UnknownFieldsBanner fields={unknownFields} />
      )}

      <div className="flex items-center gap-3">
        <ViewToggle view={view} onChange={setView} />
        <SaveIndicator savedAt={savedAt} inFlight={inFlight} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_18rem] gap-6">
        <section className="space-y-2">
          {readError ? (
            <ErrorPanel message={readError} />
          ) : view === "raw" ? (
            <CodeMirror
              value={content ?? ""}
              theme={vscodeDark}
              extensions={[json()]}
              editable={false}
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: false,
              }}
              className="text-sm border border-border rounded-md overflow-hidden"
            />
          ) : schemaError ? (
            <ErrorPanel message={schemaError} />
          ) : !schema || !catalog ? (
            <LoadingPanel label="Loading schema…" />
          ) : (
            <SchemaEditor
              schema={schema}
              catalog={catalog}
              value={buffer}
              onFieldChange={setField}
              error={applyError}
            />
          )}
        </section>

        <aside className="space-y-2">
          <div className="text-xs text-muted-foreground">
            Backups <span className="text-foreground">({backups.length})</span>
          </div>
          {backups.length === 0 ? (
            <div className="text-sm text-muted-foreground border border-dashed border-border rounded-md p-4">
              No backups yet. Komodash will start saving them when you make
              your first edit.
            </div>
          ) : (
            <ul className="space-y-1">
              {backups.map((b) => (
                <BackupRow key={b.id} record={b} onRestore={onRestore} />
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

// ---- "Komorebi not running" banner (#18) ----------------------------------

function NotRunningBanner() {
  // The real Start affordance lives on the Dashboard (#15). This banner
  // explains *why* edits aren't taking effect immediately.
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
      <div>
        <span className="font-medium">Komorebi is not running.</span>{" "}
        <span className="opacity-90">
          Edits are saved to disk and will take effect once Komorebi starts.
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

// ---- "unknown fields" banner (#17) ----------------------------------------

function UnknownFieldsBanner({ fields }: { fields: string[] }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
      <Info className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="space-y-0.5">
        <div className="font-medium">
          This config has fields your current Komorebi version doesn't
          recognise — they will be preserved as-is.
        </div>
        <div className="text-xs opacity-80">
          {fields.map((f, i) => (
            <span key={f}>
              <code className="rounded bg-amber-500/20 px-1.5 py-0.5">{f}</code>
              {i < fields.length - 1 ? ", " : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- "saved" indicator (#18) ----------------------------------------------

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

// ---- toggle ---------------------------------------------------------------

function ViewToggle({
  view,
  onChange,
}: {
  view: "form" | "raw";
  onChange: (v: "form" | "raw") => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
      <ToggleButton
        active={view === "form"}
        onClick={() => onChange("form")}
        icon={<FormInput className="h-3.5 w-3.5" />}
        label="Form"
      />
      <ToggleButton
        active={view === "raw"}
        onClick={() => onChange("raw")}
        icon={<Code2 className="h-3.5 w-3.5" />}
        label="Raw JSON"
      />
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 transition-colors",
        active
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:bg-secondary/50",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function BackupRow({
  record,
  onRestore,
}: {
  record: BackupRecord;
  onRestore: (record: BackupRecord) => void;
}) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
      <div className="flex flex-col">
        <span className="font-mono text-xs">{record.created_at}</span>
        <span className="text-xs text-muted-foreground">
          {formatBytes(record.size_bytes)}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onRestore(record)}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-border",
          "bg-secondary hover:bg-secondary/80 px-2 py-1 text-xs",
          "transition-colors",
        )}
        title="Restore this backup"
      >
        <RotateCcw className="h-3 w-3" />
        Restore
      </button>
    </li>
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

function useStaticConfig() {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const v = await getConfig("static");
      setContent(v);
      setError(null);
    } catch (e) {
      setError(formatError(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { content, refresh, error };
}

function useBackups() {
  const [backups, setBackups] = useState<BackupRecord[]>([]);

  const refresh = useCallback(async () => {
    try {
      const list = await listBackups("static");
      setBackups(list);
    } catch {
      setBackups([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { backups, refresh };
}

/** One-shot detection of Komorebi's running state at mount time. */
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

function useSchemaSurface() {
  const [schema, setSchema] = useState<JsonSchema | null>(null);
  const [catalog, setCatalog] = useState<FieldCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getSchema(), getFieldCatalog()])
      .then(([s, c]) => {
        if (cancelled) return;
        setSchema(s);
        setCatalog(c);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(formatError(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { schema, catalog, error };
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

/**
 * Fetch the list of unknown top-level fields whenever the live config
 * content changes (issue #17). Errors are swallowed silently — the
 * banner is a heads-up, not a hard requirement; we never want to fail
 * the page over its detection.
 */
function useUnknownFields(content: string | null): string[] {
  const [fields, setFields] = useState<string[]>([]);
  useEffect(() => {
    if (!content) {
      setFields([]);
      return;
    }
    let cancelled = false;
    detectUnknownFields()
      .then((list: string[]) => {
        if (!cancelled) setFields(list);
      })
      .catch(() => {
        if (!cancelled) setFields([]);
      });
    return () => {
      cancelled = true;
    };
  }, [content]);
  return fields;
}

// ---- helpers --------------------------------------------------------------

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
