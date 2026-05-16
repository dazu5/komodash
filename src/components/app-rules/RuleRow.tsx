import { Trash2 } from "lucide-react";

import type { AppRule } from "@/lib/app-rules";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<AppRule["kind"], string> = {
  ignore: "Ignore",
  float: "Float",
  manage: "Manage",
  workspace: "Workspace",
};

const KIND_TINT: Record<AppRule["kind"], string> = {
  ignore: "bg-red-500/15 text-red-300 border-red-500/30",
  float: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  manage: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  workspace: "bg-purple-500/15 text-purple-300 border-purple-500/30",
};

/**
 * One row in the App Rules list. Renders the rule's identifier kind
 * + id, a tinted kind badge, the workspace number when applicable,
 * and a delete affordance.
 */
export function RuleRow({
  rule,
  onDelete,
}: {
  rule: AppRule;
  onDelete: (rule: AppRule) => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-3 min-w-0">
        <span
          className={cn(
            "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
            KIND_TINT[rule.kind],
          )}
          title={`Rule kind: ${KIND_LABEL[rule.kind]}`}
        >
          {KIND_LABEL[rule.kind]}
          {rule.kind === "workspace" && rule.workspace !== undefined && (
            <span className="ml-1 opacity-80">→ {rule.workspace}</span>
          )}
        </span>
        <span className="font-mono text-sm truncate" title={rule.id}>
          {rule.id}
        </span>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          {rule.identifierKind}
          {rule.matchingStrategy !== "Equals" && ` · ${rule.matchingStrategy}`}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onDelete(rule)}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-border",
          "bg-secondary hover:bg-destructive/20 hover:border-destructive/40",
          "px-2 py-1 text-xs transition-colors shrink-0",
        )}
        title="Delete rule"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </li>
  );
}
