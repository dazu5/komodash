import { AlertCircle, AlertTriangle, Trash2 } from "lucide-react";

import type { CommandCatalog } from "@/api/command-catalog";
import type { ValidationIssue } from "@/api/hotkey-validator";
import type { Binding } from "@/api/hotkeys";
import { cn } from "@/lib/utils";

import { ChordCapture } from "./ChordCapture";

/**
 * One row in the Hotkeys editor (issue #20). Chord on the left,
 * command + args on the right, validation badge inline, delete button.
 */
export function BindingRow({
  binding,
  catalog,
  issues,
  onChange,
  onDelete,
}: {
  binding: Binding;
  /** Catalog of known komorebic subcommands. Populates the subcommand
   *  picker for `komorebic`-prefixed bindings. */
  catalog: CommandCatalog | null;
  /** Issues whose `binding_index` matches this row, already filtered. */
  issues: ValidationIssue[];
  onChange: (next: Binding) => void;
  onDelete: () => void;
}) {
  const errorIssues = issues.filter(
    (i) =>
      i.kind === "duplicate-chord" ||
      i.kind === "unknown-command" ||
      i.kind === "invalid-args",
  );
  const warningIssues = issues.filter((i) => i.kind === "windows-reserved");
  const hasError = errorIssues.length > 0;
  const hasWarning = warningIssues.length > 0;

  // `bindings` may target any executable (taskkill, pwsh, …). The
  // common case is `komorebic <sub> <args>`, so when the command is
  // `komorebic` we show a select of subcommands from the catalog and
  // a free-form args field; for anything else we show two plain text
  // inputs.
  const isKomorebic = binding.command === "komorebic";
  const subcommand = isKomorebic ? (binding.args[0] ?? "") : "";
  const restArgs = isKomorebic ? binding.args.slice(1) : binding.args;

  return (
    <li
      className={cn(
        "grid grid-cols-1 md:grid-cols-[14rem_1fr_auto] gap-2 md:gap-3 px-3 py-2",
        hasError && "bg-destructive/5",
        !hasError && hasWarning && "bg-amber-500/5",
      )}
    >
      <ChordCapture
        value={binding.chord}
        onChange={(chord) => onChange({ ...binding, chord })}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="text"
          value={binding.command}
          onChange={(e) => onChange({ ...binding, command: e.target.value })}
          className="rounded-md border border-border bg-secondary/40 px-2 py-1 text-sm font-mono w-32"
          placeholder="command"
        />
        {isKomorebic && catalog && (
          <select
            value={subcommand}
            onChange={(e) => {
              const sub = e.target.value;
              onChange({
                ...binding,
                args: sub ? [sub, ...restArgs] : restArgs,
              });
            }}
            className="rounded-md border border-border bg-secondary/40 px-2 py-1 text-sm font-mono"
          >
            <option value="">(no subcommand)</option>
            {catalog.commands.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <input
          type="text"
          value={restArgs.join(" ")}
          onChange={(e) => {
            const tokens = e.target.value.split(/\s+/).filter(Boolean);
            onChange({
              ...binding,
              args: isKomorebic
                ? subcommand
                  ? [subcommand, ...tokens]
                  : tokens
                : tokens,
            });
          }}
          className="rounded-md border border-border bg-secondary/40 px-2 py-1 text-sm font-mono flex-1 min-w-0"
          placeholder={isKomorebic ? "args (e.g. left)" : "args"}
        />
        {(hasError || hasWarning) && (
          <IssueBadge
            issues={hasError ? errorIssues : warningIssues}
            kind={hasError ? "error" : "warning"}
          />
        )}
      </div>

      <button
        type="button"
        onClick={onDelete}
        className="rounded-md border border-border bg-secondary p-1.5 hover:bg-destructive/20 transition-colors"
        title="Delete this binding"
        aria-label="Delete binding"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function IssueBadge({
  issues,
  kind,
}: {
  issues: ValidationIssue[];
  kind: "error" | "warning";
}) {
  // Hover/title shows the message text per AC. With multiple issues
  // we join them with " · " so the tooltip is still readable.
  const message = issues.map((i) => i.message).join(" · ");
  return (
    <span
      title={message}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        kind === "error"
          ? "border border-destructive/40 bg-destructive/10 text-destructive"
          : "border border-amber-500/40 bg-amber-500/10 text-amber-300",
      )}
    >
      {kind === "error" ? (
        <AlertCircle className="h-3 w-3" />
      ) : (
        <AlertTriangle className="h-3 w-3" />
      )}
      {kind === "error" ? "error" : "warning"}
    </span>
  );
}
