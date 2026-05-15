import { useCallback, useEffect, useState } from "react";
import { Code2, FormInput, RotateCcw } from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-shell";
import { SchemaEditor } from "@/components/schema-editor";
import {
  getConfig,
  listBackups,
  restoreBackup,
  type BackupRecord,
} from "@/api/config";
import {
  getFieldCatalog,
  type FieldCatalog,
} from "@/api/field-catalog";
import { getSchema, type JsonSchema } from "@/api/schema";
import { cn } from "@/lib/utils";

/**
 * The Configuration page (issues #7 + #11).
 *
 * Default view is the **schema-driven editor** in read-only mode, using
 * the Field-catalog overlay for friendly labels. A "Raw JSON" toggle
 * falls back to the CodeMirror view from #7 for users who want to see
 * the literal file. The backups sidebar stays in either mode.
 *
 * Live-apply editing arrives in #18; the editor renders disabled inputs
 * here.
 */
export default function ConfigPage() {
  const { content, refresh: refreshContent, error } = useStaticConfig();
  const { backups, refresh: refreshBackups } = useBackups();
  const { schema, catalog, error: schemaError } = useSchemaSurface();
  const [view, setView] = useState<"form" | "raw">("form");

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

  const parsedValue = useParsedConfig(content);

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Configuration"
        subtitle="komorebi.json — read-only for now; live editing lands in a later slice."
      />

      <div className="flex items-center gap-2">
        <ViewToggle view={view} onChange={setView} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_18rem] gap-6">
        <section className="space-y-2">
          {error ? (
            <ErrorPanel message={error} />
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
              value={parsedValue}
              readonly
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

// ---- hooks -----------------------------------------------------------------

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

/** Fetch the schema and the bundled field catalog once on mount. */
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

/** Parse the live JSON file content into a plain object for the editor. */
function useParsedConfig(content: string | null): Record<string, unknown> | null {
  if (!content) return null;
  try {
    const parsed = JSON.parse(content);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// ---- helpers ---------------------------------------------------------------

function formatError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
