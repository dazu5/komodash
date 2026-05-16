import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { useCallback, useEffect, useState } from "react";
import { AppWindow, Download, RefreshCw, Search, X } from "lucide-react";
import { toast } from "sonner";

import type { AppRule, IdentifierKind, RuleKind } from "@/lib/app-rules";
import {
  entryToRules,
  parseCatalog,
  searchCatalog,
  type CommunityCatalogEntry,
} from "@/lib/community-catalog";
import {
  filterWindows,
  type VisibleWindow,
} from "@/lib/visible-windows";
import {
  fetchCommunityCatalog,
  readCommunityCatalog,
} from "@/api/community-catalog";
import { getVisibleWindows } from "@/api/visible-windows";
import { cn } from "@/lib/utils";

const RULE_KINDS: { value: RuleKind; label: string }[] = [
  { value: "ignore", label: "Ignore" },
  { value: "float", label: "Float" },
  { value: "manage", label: "Manage" },
  { value: "workspace", label: "Send to workspace" },
];

const IDENTIFIER_KINDS: IdentifierKind[] = ["Exe", "Class", "Title", "Path"];

/**
 * Add-rule modal — Manual entry tab from #22 + Community catalog tab
 * from #24. Future slice #25 adds a Visible windows tab.
 */
export function AddRuleModal({
  open,
  onOpenChange,
  onSave,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when the Manual tab saves a single rule. */
  onSave: (rule: AppRule) => void;
  /** Called when the Community tab imports a catalog entry as N rules. */
  onImport: (rules: AppRule[]) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50",
            "w-full max-w-2xl rounded-lg border border-border bg-card p-6",
            "shadow-xl",
          )}
        >
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <Dialog.Title className="text-base font-semibold">
                Add application rule
              </Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground mt-1">
                Tell Komorebi how to treat windows from a specific app.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <Tabs.Root defaultValue="manual">
            <Tabs.List className="inline-flex items-center gap-1 rounded-md border border-border p-1 mb-4">
              <TabTrigger value="manual">Manual entry</TabTrigger>
              <TabTrigger value="community">Search community library</TabTrigger>
              <TabTrigger value="visible">From running apps</TabTrigger>
            </Tabs.List>

            <Tabs.Content value="manual" className="focus:outline-none">
              <ManualRuleForm
                onSave={(rule) => {
                  onSave(rule);
                  onOpenChange(false);
                }}
                onCancel={() => onOpenChange(false)}
              />
            </Tabs.Content>

            <Tabs.Content value="community" className="focus:outline-none">
              <CommunityRuleSearch
                onImport={(rules) => {
                  onImport(rules);
                  onOpenChange(false);
                }}
                onCancel={() => onOpenChange(false)}
              />
            </Tabs.Content>

            <Tabs.Content value="visible" className="focus:outline-none">
              <VisibleWindowsPicker
                onSave={(rule) => {
                  onSave(rule);
                  onOpenChange(false);
                }}
                onCancel={() => onOpenChange(false)}
              />
            </Tabs.Content>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---- Manual tab -----------------------------------------------------------

function ManualRuleForm({
  onSave,
  onCancel,
}: {
  onSave: (rule: AppRule) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<RuleKind>("ignore");
  const [identifierKind, setIdentifierKind] = useState<IdentifierKind>("Exe");
  const [id, setId] = useState("");
  const [workspace, setWorkspace] = useState<number>(0);

  const reset = useCallback(() => {
    setKind("ignore");
    setIdentifierKind("Exe");
    setId("");
    setWorkspace(0);
  }, []);

  const canSave = id.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      kind,
      identifierKind,
      id: id.trim(),
      matchingStrategy: "Equals",
      ...(kind === "workspace" ? { workspace } : {}),
    });
    reset();
  };

  return (
    <div>
      <div className="space-y-4">
        <Field label="Rule kind">
          <Select value={kind} onChange={(v) => setKind(v as RuleKind)}>
            {RULE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>

        {kind === "workspace" && (
          <Field label="Workspace index">
            <input
              type="number"
              min={0}
              value={workspace}
              onChange={(e) =>
                setWorkspace(Math.max(0, Number(e.target.value) || 0))
              }
              className={inputClass}
            />
          </Field>
        )}

        <Field label="Identifier kind">
          <Select
            value={identifierKind}
            onChange={(v) => setIdentifierKind(v as IdentifierKind)}
          >
            {IDENTIFIER_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={
            identifierKind === "Exe"
              ? "Executable name"
              : identifierKind === "Class"
                ? "Window class"
                : identifierKind === "Title"
                  ? "Window title"
                  : "Path"
          }
        >
          <input
            type="text"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder={identifierKind === "Exe" ? "e.g. notepad.exe" : ""}
            className={inputClass}
            autoFocus
          />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2 mt-6">
        <button
          type="button"
          onClick={onCancel}
          className={cn(
            "rounded-md border border-border px-3 py-1.5 text-sm",
            "bg-secondary hover:bg-secondary/80 transition-colors",
          )}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm transition-colors",
            canSave
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-secondary text-muted-foreground cursor-not-allowed",
          )}
        >
          Add rule
        </button>
      </div>
    </div>
  );
}

// ---- Community tab --------------------------------------------------------

function CommunityRuleSearch({
  onImport,
  onCancel,
}: {
  onImport: (rules: AppRule[]) => void;
  onCancel: () => void;
}) {
  const [entries, setEntries] = useState<CommunityCatalogEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const json = await readCommunityCatalog();
      setEntries(json === "" ? [] : parseCatalog(json));
    } catch (e) {
      setEntries([]);
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await fetchCommunityCatalog();
      toast.success("Community library downloaded");
      await load();
    } catch (e) {
      toast.error(
        `Download failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setDownloading(false);
    }
  };

  if (entries === null) {
    return <LoadingPanel label="Loading community library…" />;
  }

  if (entries.length === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {loadError ? (
            <p className="text-destructive">{loadError}</p>
          ) : (
            <>
              <p className="mb-1">The community library isn't downloaded yet.</p>
              <p className="text-xs">
                Hundreds of rules curated by Komorebi users — one click away.
              </p>
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className={cn(
              "rounded-md border border-border px-3 py-1.5 text-sm",
              "bg-secondary hover:bg-secondary/80 transition-colors",
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
              "transition-colors",
              downloading
                ? "bg-secondary text-muted-foreground cursor-not-allowed"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            <Download className="h-4 w-4" />
            {downloading ? "Downloading…" : "Download library"}
          </button>
        </div>
      </div>
    );
  }

  const filtered = searchCatalog(entries, query);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${entries.length} apps…`}
          className={cn(inputClass, "pl-9")}
          autoFocus
        />
      </div>

      <div className="text-xs text-muted-foreground">
        {filtered.length} of {entries.length} apps
      </div>

      <ul className="max-h-80 overflow-y-auto space-y-1 border border-border rounded-md p-1">
        {filtered.length === 0 ? (
          <li className="p-4 text-center text-sm text-muted-foreground">
            No apps match "{query}".
          </li>
        ) : (
          filtered.slice(0, 200).map((entry) => (
            <CommunityResultRow
              key={entry.name}
              entry={entry}
              onImport={onImport}
            />
          ))
        )}
      </ul>

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className={cn(
            "rounded-md border border-border px-3 py-1.5 text-sm",
            "bg-secondary hover:bg-secondary/80 transition-colors",
          )}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function CommunityResultRow({
  entry,
  onImport,
}: {
  entry: CommunityCatalogEntry;
  onImport: (rules: AppRule[]) => void;
}) {
  const rules = entryToRules(entry);
  const summary = summarize(rules);

  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2 rounded-md hover:bg-secondary/50">
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{entry.name}</div>
        <div className="text-xs text-muted-foreground truncate" title={summary}>
          {rules.length === 0 ? "no importable rules" : summary}
        </div>
      </div>
      <button
        type="button"
        disabled={rules.length === 0}
        onClick={() => {
          onImport(rules);
          toast.success(`Imported ${rules.length} rule(s) for ${entry.name}`);
        }}
        className={cn(
          "rounded-md px-3 py-1 text-xs transition-colors shrink-0",
          rules.length === 0
            ? "bg-secondary text-muted-foreground cursor-not-allowed"
            : "bg-primary text-primary-foreground hover:bg-primary/90",
        )}
        title={
          rules.length === 0
            ? "This entry only has nested AND-grouped rules — not supported in v1"
            : `Add ${rules.length} rule(s) to your config`
        }
      >
        Import
      </button>
    </li>
  );
}

function summarize(rules: AppRule[]): string {
  if (rules.length === 0) return "";
  const counts = rules.reduce<Record<string, number>>((acc, r) => {
    acc[r.kind] = (acc[r.kind] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([k, n]) => `${n} ${k}`)
    .join(", ");
}

// ---- Visible-windows tab --------------------------------------------------

const VISIBLE_KIND_BUTTONS: { kind: RuleKind; label: string; tint: string }[] = [
  { kind: "ignore", label: "Ignore", tint: "bg-red-500/15 border-red-500/30 hover:bg-red-500/30" },
  { kind: "float", label: "Float", tint: "bg-blue-500/15 border-blue-500/30 hover:bg-blue-500/30" },
  { kind: "manage", label: "Manage", tint: "bg-emerald-500/15 border-emerald-500/30 hover:bg-emerald-500/30" },
];

function VisibleWindowsPicker({
  onSave,
  onCancel,
}: {
  onSave: (rule: AppRule) => void;
  onCancel: () => void;
}) {
  const [windows, setWindows] = useState<VisibleWindow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setRefreshing(true);
    setLoadError(null);
    try {
      const list = await getVisibleWindows();
      setWindows(list);
    } catch (e) {
      setWindows([]);
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (windows === null) {
    return <LoadingPanel label="Listing running windows…" />;
  }

  const filtered = filterWindows(windows, query);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${windows.length} windows…`}
          className={cn(inputClass, "pl-9")}
          autoFocus
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {filtered.length} of {windows.length} windows
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={refreshing}
          className={cn(
            "inline-flex items-center gap-1 text-xs text-muted-foreground",
            "hover:text-foreground transition-colors",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <RefreshCw
            className={cn("h-3 w-3", refreshing && "animate-spin")}
          />
          Refresh
        </button>
      </div>

      {loadError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {loadError}
        </div>
      )}

      <ul className="max-h-80 overflow-y-auto space-y-1 border border-border rounded-md p-1">
        {filtered.length === 0 ? (
          <li className="p-4 text-center text-sm text-muted-foreground">
            {windows.length === 0
              ? "No visible windows. Is Komorebi running?"
              : `No windows match "${query}".`}
          </li>
        ) : (
          filtered.slice(0, 100).map((w) => (
            <VisibleWindowRow
              key={`${w.exe}|${w.class}|${w.title}`}
              window={w}
              onPick={(kind) => {
                onSave({
                  kind,
                  identifierKind: "Exe",
                  id: w.exe,
                  matchingStrategy: "Equals",
                });
                toast.success(`Added ${kind} rule for ${w.exe}`);
              }}
            />
          ))
        )}
      </ul>

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className={cn(
            "rounded-md border border-border px-3 py-1.5 text-sm",
            "bg-secondary hover:bg-secondary/80 transition-colors",
          )}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function VisibleWindowRow({
  window,
  onPick,
}: {
  window: VisibleWindow;
  onPick: (kind: RuleKind) => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2 rounded-md hover:bg-secondary/50">
      <div className="flex items-center gap-2 min-w-0">
        <AppWindow className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <div className="text-sm truncate" title={window.title}>
            {window.title || "(no title)"}
          </div>
          <div className="text-xs text-muted-foreground truncate" title={window.exe}>
            {window.exe}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {VISIBLE_KIND_BUTTONS.map(({ kind, label, tint }) => (
          <button
            key={kind}
            type="button"
            onClick={() => onPick(kind)}
            className={cn(
              "rounded-md border px-2 py-1 text-xs transition-colors",
              tint,
            )}
            title={`Add ${label} rule for ${window.exe}`}
          >
            {label}
          </button>
        ))}
      </div>
    </li>
  );
}

// ---- shared bits ----------------------------------------------------------

function TabTrigger({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  return (
    <Tabs.Trigger
      value={value}
      className={cn(
        "rounded-md px-3 py-1 text-xs transition-colors",
        "data-[state=active]:bg-secondary data-[state=active]:text-foreground",
        "data-[state=inactive]:text-muted-foreground",
        "hover:text-foreground",
      )}
    >
      {children}
    </Tabs.Trigger>
  );
}

const inputClass = cn(
  "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm",
  "focus:outline-none focus:ring-2 focus:ring-ring",
);

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputClass}
    >
      {children}
    </select>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}
