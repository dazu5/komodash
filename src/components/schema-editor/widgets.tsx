import { Check, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Read-only widget set for the v1 schema-driven editor (#11).
 *
 * Each widget renders a value as it would appear in the eventual
 * interactive editor (#18+) but with the input element disabled. That
 * lets users still see *what's currently configured* without us having
 * to maintain two parallel rendering paths.
 */

const baseInput =
  "w-full rounded-md border border-border bg-secondary/40 px-2 py-1 text-sm " +
  "disabled:cursor-not-allowed disabled:opacity-80";

export function BooleanWidget({
  value,
  readonly,
}: {
  value: boolean;
  readonly: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium",
        value
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : "border-border bg-secondary text-muted-foreground",
        readonly && "opacity-90",
      )}
      aria-disabled={readonly}
    >
      {value ? (
        <>
          <Check className="h-3 w-3" />
          On
        </>
      ) : (
        <>
          <X className="h-3 w-3" />
          Off
        </>
      )}
    </span>
  );
}

export function NumberWidget({
  value,
  readonly,
}: {
  value: number | undefined;
  readonly: boolean;
}) {
  return (
    <input
      type="number"
      className={baseInput}
      value={value ?? ""}
      disabled={readonly}
      readOnly={readonly}
    />
  );
}

export function StringWidget({
  value,
  readonly,
}: {
  value: string;
  readonly: boolean;
}) {
  return (
    <input
      type="text"
      className={baseInput}
      value={value}
      disabled={readonly}
      readOnly={readonly}
    />
  );
}

export function EnumWidget({
  value,
  readonly,
  options,
}: {
  value: unknown;
  readonly: boolean;
  options: string[];
}) {
  // We don't have the enum list plumbed end-to-end in this read-only
  // slice — show the current value verbatim so it's still informative.
  // The editable slice (#18) will resolve the enum from the schema.
  return (
    <select
      className={baseInput}
      disabled={readonly}
      defaultValue={String(value ?? "")}
    >
      <option>{String(value ?? "(unset)")}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

export function ArrayPreview({ value }: { value: unknown[] }) {
  if (value.length === 0) {
    return (
      <span className="text-xs italic text-muted-foreground">(empty list)</span>
    );
  }
  return (
    <ul className="space-y-1 text-xs">
      {value.slice(0, 5).map((v, i) => (
        <li
          key={i}
          className="truncate rounded border border-border bg-secondary/30 px-2 py-1 font-mono"
          title={String(v)}
        >
          {summariseValue(v)}
        </li>
      ))}
      {value.length > 5 && (
        <li className="text-muted-foreground">
          …and {value.length - 5} more
        </li>
      )}
    </ul>
  );
}

export function ObjectPreview({
  value,
}: {
  value: Record<string, unknown> | null;
}) {
  if (!value) {
    return (
      <span className="text-xs italic text-muted-foreground">(not set)</span>
    );
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return (
      <span className="text-xs italic text-muted-foreground">(empty)</span>
    );
  }
  return (
    <pre className="text-xs font-mono whitespace-pre-wrap break-all rounded-md border border-border bg-secondary/30 px-2 py-1.5 max-h-32 overflow-y-auto">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function UnknownWidget({ value }: { value: unknown }) {
  if (value === undefined || value === null) {
    return (
      <span className="text-xs italic text-muted-foreground">(not set)</span>
    );
  }
  return (
    <span className="text-xs font-mono">{summariseValue(value)}</span>
  );
}

function summariseValue(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > 80 ? s.slice(0, 77) + "…" : s;
  } catch {
    return String(v);
  }
}
