import { useCallback, useEffect, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-shell";
import {
  getConfig,
  listBackups,
  restoreBackup,
  type BackupRecord,
} from "@/api/config";
import { cn } from "@/lib/utils";

/**
 * The Configuration page in its read-only first iteration (issue #7).
 *
 * Displays the raw `komorebi.json` content via CodeMirror and a sidebar
 * listing recent backups with one-click Restore. The schema-driven editing
 * surface (with **Field catalog** overlay + Live-apply) arrives in #11+#18.
 */
export default function ConfigPage() {
  const { content, refresh: refreshContent, error } = useStaticConfig();
  const { backups, refresh: refreshBackups } = useBackups();

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
        subtitle="komorebi.json — read-only for now; live editing lands in a later slice."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_18rem] gap-6">
        <section className="space-y-2">
          <div className="text-xs text-muted-foreground">
            Live <code className="text-foreground">komorebi.json</code>
          </div>
          {error ? (
            <ErrorPanel message={error} />
          ) : (
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
      // Soft-fail: empty list is the right UI for "we couldn't read backups".
      setBackups([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { backups, refresh };
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
