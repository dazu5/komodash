import { useId } from "react";
import { Check, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Widget set used by the schema-driven editor (#11 read-only / #18 editable).
 *
 * Each widget accepts a `readonly` flag — when `true` the input is
 * disabled, when `false` it's a real interactive control. `onChange` is
 * required for editable mode; the read-only path passes a no-op.
 */

const baseInput =
  "w-full rounded-md border border-border bg-secondary/40 px-2 py-1 text-sm " +
  "disabled:cursor-not-allowed disabled:opacity-80 " +
  "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0";

export function BooleanWidget({
  value,
  readonly,
  onChange,
}: {
  value: boolean;
  readonly: boolean;
  onChange?: (next: boolean) => void;
}) {
  if (readonly) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium",
          value
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
            : "border-border bg-secondary text-muted-foreground",
        )}
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
  return (
    <button
      type="button"
      onClick={() => onChange?.(!value)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
        value
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
          : "border-border bg-secondary text-muted-foreground hover:bg-secondary/80",
      )}
      aria-pressed={value}
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
    </button>
  );
}

export function NumberWidget({
  value,
  readonly,
  onChange,
}: {
  value: number | undefined;
  readonly: boolean;
  onChange?: (next: number | undefined) => void;
}) {
  const id = useId();
  return (
    <input
      id={id}
      type="number"
      className={baseInput}
      value={value ?? ""}
      disabled={readonly}
      readOnly={readonly}
      onChange={
        readonly
          ? undefined
          : (e) => {
              const raw = e.target.value;
              if (raw === "") {
                onChange?.(undefined);
              } else {
                const n = Number(raw);
                if (Number.isFinite(n)) onChange?.(n);
              }
            }
      }
    />
  );
}

export function StringWidget({
  value,
  readonly,
  onChange,
}: {
  value: string;
  readonly: boolean;
  onChange?: (next: string) => void;
}) {
  const id = useId();
  return (
    <input
      id={id}
      type="text"
      className={baseInput}
      value={value}
      disabled={readonly}
      readOnly={readonly}
      onChange={readonly ? undefined : (e) => onChange?.(e.target.value)}
    />
  );
}

export function EnumWidget({
  value,
  readonly,
  options,
  onChange,
}: {
  value: unknown;
  readonly: boolean;
  options: string[];
  onChange?: (next: string) => void;
}) {
  const current = String(value ?? "");
  const choices = options.length > 0 ? options : [current];
  return (
    <select
      className={baseInput}
      disabled={readonly}
      value={current}
      onChange={readonly ? undefined : (e) => onChange?.(e.target.value)}
    >
      {!choices.includes(current) && current !== "" && (
        <option value={current}>{current}</option>
      )}
      {choices.map((o) => (
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
