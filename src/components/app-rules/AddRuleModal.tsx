import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { X } from "lucide-react";

import type { AppRule, IdentifierKind, RuleKind } from "@/lib/app-rules";
import { cn } from "@/lib/utils";

const RULE_KINDS: { value: RuleKind; label: string }[] = [
  { value: "ignore", label: "Ignore" },
  { value: "float", label: "Float" },
  { value: "manage", label: "Manage" },
  { value: "workspace", label: "Send to workspace" },
];

const IDENTIFIER_KINDS: IdentifierKind[] = ["Exe", "Class", "Title", "Path"];

/**
 * Manual-entry modal for adding a new App Rule. Future slices (#24,
 * #25) replace this single-form layout with a tabbed dialog (Manual /
 * Community catalog / Visible windows).
 */
export function AddRuleModal({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (rule: AppRule) => void;
}) {
  const [kind, setKind] = useState<RuleKind>("ignore");
  const [identifierKind, setIdentifierKind] = useState<IdentifierKind>("Exe");
  const [id, setId] = useState("");
  const [workspace, setWorkspace] = useState<number>(0);

  const reset = () => {
    setKind("ignore");
    setIdentifierKind("Exe");
    setId("");
    setWorkspace(0);
  };

  const canSave = id.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;
    const rule: AppRule = {
      kind,
      identifierKind,
      id: id.trim(),
      matchingStrategy: "Equals",
      ...(kind === "workspace" ? { workspace } : {}),
    };
    onSave(rule);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50",
            "w-full max-w-md rounded-lg border border-border bg-card p-6",
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
                placeholder={
                  identifierKind === "Exe" ? "e.g. notepad.exe" : ""
                }
                className={inputClass}
                autoFocus
              />
            </Field>
          </div>

          <div className="flex items-center justify-end gap-2 mt-6">
            <Dialog.Close asChild>
              <button
                type="button"
                className={cn(
                  "rounded-md border border-border px-3 py-1.5 text-sm",
                  "bg-secondary hover:bg-secondary/80 transition-colors",
                )}
              >
                Cancel
              </button>
            </Dialog.Close>
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
