import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, Check, Monitor as MonitorIcon, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useLiveState } from "@/stores/live-state";

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

/**
 * Editable JSON textarea fallback for object/array fields whose
 * structure the schema editor doesn't yet decompose into nested
 * sub-widgets (issue #19 stopgap). Live-validates the JSON: on every
 * keystroke we attempt `JSON.parse`. On success we fire `onChange`
 * with the parsed value; on failure we keep the buffer locally and
 * surface an inline error without calling `onChange` (so the parent
 * never sees an invalid intermediate state).
 *
 * The textarea preserves whatever the user typed verbatim — including
 * trailing whitespace and comment-friendly newlines — so the displayed
 * text doesn't snap back to canonical formatting after each keystroke.
 *
 * A follow-up issue will replace this with a recursive `SchemaEditor`
 * for object fields so the user gets typed sub-widgets per property.
 */
export function JsonValueWidget({
  value,
  readonly,
  expectedKind,
  onChange,
}: {
  value: unknown;
  readonly: boolean;
  /** "object" or "array" — used for the live-validation hint
   *  ("expected an object" / "expected a list"). Omit (or "any") for
   *  union/freeform fields (e.g. the bar's `monitor`, which accepts
   *  an integer index OR a MonitorConfig object OR null). */
  expectedKind: "object" | "array" | "any";
  onChange?: (next: unknown) => void;
}) {
  const id = useId();
  // `text` is owned by the textarea so we don't re-stringify on every
  // parent re-render. We sync from the prop only when it changes from
  // *outside* this component (mount-time load, undo). The lastSentRef
  // tracks the parsed value we last passed up, so we can detect
  // genuine external updates vs the echo of our own onChange.
  const lastSentRef = useRef<string | null>(null);
  const [text, setText] = useState(() => stringifyForEdit(value));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const incoming = stringifyForEdit(value);
    if (incoming !== lastSentRef.current) {
      setText(incoming);
      setError(null);
      lastSentRef.current = incoming;
    }
  }, [value]);

  if (readonly) {
    return (
      <ObjectPreview
        value={
          expectedKind === "object" && isPlainObject(value)
            ? value
            : null
        }
      />
    );
  }

  const placeholderFor = (k: "object" | "array" | "any") =>
    k === "object" ? "{\n  \n}" : k === "array" ? "[\n  \n]" : "";

  const onTextChange = (next: string) => {
    setText(next);
    const trimmed = next.trim();
    if (trimmed === "") {
      // Empty means "unset" — fire onChange(undefined) so the parent
      // can prune the key on next write.
      setError(null);
      lastSentRef.current = "";
      onChange?.(undefined);
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      // Only enforce kind when the schema actually pins it. For "any"
      // (union/freeform fields like the bar's `monitor`), accept
      // anything that parses — komorebi-bar itself will validate on
      // Apply and surface a precise rejection if the shape is wrong.
      if (expectedKind === "object" && !isPlainObject(parsed)) {
        setError("Expected an object (curly braces).");
        return;
      }
      if (expectedKind === "array" && !Array.isArray(parsed)) {
        setError("Expected a list (square brackets).");
        return;
      }
      setError(null);
      const canonical = JSON.stringify(parsed, null, 2);
      lastSentRef.current = canonical;
      onChange?.(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-1.5">
      <textarea
        id={id}
        className={cn(
          "w-full min-h-[6rem] rounded-md border bg-secondary/40 px-2 py-1.5",
          "text-xs font-mono whitespace-pre",
          "focus:outline-none focus:ring-2 focus:ring-ring",
          error ? "border-destructive/60" : "border-border",
        )}
        spellCheck={false}
        value={text}
        placeholder={placeholderFor(expectedKind)}
        onChange={(e) => onTextChange(e.target.value)}
      />
      {error ? (
        <p className="inline-flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </p>
      ) : text.trim() === "" ? (
        <p className="text-xs italic text-muted-foreground">
          Leave empty to unset this field.
        </p>
      ) : (
        <p className="inline-flex items-center gap-1.5 text-xs text-emerald-400/80">
          <Check className="h-3 w-3 shrink-0" />
          Valid JSON — will apply on click
        </p>
      )}
    </div>
  );
}

function stringifyForEdit(value: unknown): string {
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Structured widget for the bar's `monitor` field (issue #19 polish
 * per the [[no-json-as-ux]] feedback). The bar accepts either an
 * integer (just the index) OR a `MonitorConfig` object
 * `{ index, work_area_offset? }`.
 *
 * UX: a single dropdown. Komodash auto-fills `work_area_offset` —
 * the user never sees a pixel value. Padding scales with the selected
 * monitor's pixel height so a 4K display gets more breathing room
 * than 1080p:
 *
 *   padding = clamp(round(monitor_height * 0.025), 24, 80)
 *
 *   - 1080p → 27 px  (≈ 2.5% of 1080)
 *   - 1440p → 36 px
 *   - 2160p (4K) → 54 px
 *
 * The same value is used for top *and* bottom so windows tile in a
 * symmetric area (the user's complaint was windows touching the
 * bottom edge with no padding). Left/right stay 0 — the bar spans
 * full width.
 *
 * On mount, if the on-disk offsets don't match Komodash's auto
 * values, the widget emits a corrective value so the next Apply
 * writes the right offsets. Without this, users who arrive with a
 * legacy stale config see "Monitor 1" selected but the saved offsets
 * are still old.
 */
const PADDING_RATIO = 0.025; // 2.5% of monitor height
// Floor must cover the actual rendered bar height. The bar's
// `font_size=12` default produces a ~30 px text strip, but the bar
// also adds internal padding around the text — total rendered
// height lands around 45–50 px. 50 covers that *and* leaves a
// visible gap so windows don't kiss the bar's bottom edge. Verified
// against a 1920×1080 setup where top=32 produced zero visible
// breathing room (the user saw "windows on top of the status bar,
// no padding that separates the 2"). Future polish: detect the
// actual bar window height via Win32 instead of guessing.
const MIN_PADDING_PX = 50;
const MAX_PADDING_PX = 100;
const FALLBACK_MONITOR_HEIGHT_PX = 1080;

export function MonitorPlacementWidget({
  value,
  readonly,
  onChange,
}: {
  value: unknown;
  readonly: boolean;
  onChange?: (next: unknown) => void;
}) {
  const snapshot = useLiveState((s) => s.snapshot);
  const monitors = extractMonitorOptions(snapshot);

  const parsed = parseMonitorValue(value);
  const idx = parsed.index;
  const selected = monitors.find((m) => m.index === idx) ?? monitors[0] ?? null;
  const padding = computePadding(selected?.height ?? null);

  // Build the canonical "what this monitor should look like on disk"
  // value so we can both emit on dropdown change *and* detect drift
  // from the on-disk value on mount.
  const buildCanonicalValue = (
    nextIndex: number,
    monitorHeight: number | null,
  ) => ({
    index: nextIndex,
    work_area_offset: {
      left: 0,
      top: computePadding(monitorHeight),
      right: 0,
      bottom: computePadding(monitorHeight),
    },
  });

  // Mount-time normalization: if the saved value's offsets don't
  // match what Komodash would auto-compute for this monitor, emit a
  // corrective value once. The pending counter ticks up; the user
  // clicks Apply to confirm. Ref-guards re-entry so the effect
  // doesn't loop on the resulting prop change.
  const normalizedRef = useRef(false);
  useEffect(() => {
    if (readonly || normalizedRef.current) return;
    if (selected === null) return; // Wait for the monitor list.
    const canonical = buildCanonicalValue(idx, selected.height);
    if (!offsetsMatch(parsed.offset, canonical.work_area_offset)) {
      onChange?.(canonical);
    }
    normalizedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, readonly]);

  const emitForIndex = (nextIndex: number) => {
    const m = monitors.find((mm) => mm.index === nextIndex) ?? null;
    onChange?.(buildCanonicalValue(nextIndex, m?.height ?? null));
  };

  const paddingHint =
    selected !== null
      ? selected.height !== null
        ? `${padding} px top + ${padding} px bottom (scaled from your ${selected.height} px monitor)`
        : `${padding} px top + ${padding} px bottom (default — live monitor info not available)`
      : null;

  return (
    <div className="space-y-2">
      <select
        className={baseInput}
        disabled={readonly}
        value={idx}
        onChange={(e) => emitForIndex(Number(e.target.value))}
      >
        {monitors.map((m) => (
          <option key={m.index} value={m.index}>
            {monitorLabel(m)}
          </option>
        ))}
      </select>
      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <MonitorIcon className="h-3 w-3 shrink-0" />
        Komodash auto-reserves bar space and a matching bottom gap,
        scaled to this monitor's height.
        {paddingHint && (
          <span className="opacity-75"> — {paddingHint}</span>
        )}
      </p>
    </div>
  );
}

function computePadding(monitorHeight: number | null): number {
  const h = monitorHeight ?? FALLBACK_MONITOR_HEIGHT_PX;
  const raw = Math.round(h * PADDING_RATIO);
  return Math.max(MIN_PADDING_PX, Math.min(MAX_PADDING_PX, raw));
}

function offsetsMatch(a: WorkAreaOffset, b: WorkAreaOffset): boolean {
  return (
    a.top === b.top &&
    a.bottom === b.bottom &&
    a.left === b.left &&
    a.right === b.right
  );
}

interface WorkAreaOffset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface ParsedMonitor {
  index: number;
  offset: WorkAreaOffset;
}

function parseMonitorValue(value: unknown): ParsedMonitor {
  const zero: WorkAreaOffset = { top: 0, bottom: 0, left: 0, right: 0 };
  if (typeof value === "number" && Number.isFinite(value)) {
    return { index: Math.trunc(value), offset: zero };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const index =
      typeof obj.index === "number" ? Math.trunc(obj.index) : 0;
    const offRaw = obj.work_area_offset;
    if (offRaw && typeof offRaw === "object" && !Array.isArray(offRaw)) {
      const o = offRaw as Record<string, unknown>;
      return {
        index,
        offset: {
          top: numberOr(o.top, 0),
          bottom: numberOr(o.bottom, 0),
          left: numberOr(o.left, 0),
          right: numberOr(o.right, 0),
        },
      };
    }
    return { index, offset: zero };
  }
  return { index: 0, offset: zero };
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : fallback;
}

interface MonitorOption {
  index: number;
  name: string | null;
  width: number | null;
  height: number | null;
}

function extractMonitorOptions(snapshot: unknown): MonitorOption[] {
  // Walk the live-state snapshot to pull out monitors. Same shape the
  // Dashboard uses — `state.monitors.elements[]`. If the snapshot is
  // null (Komorebi not running, or page navigated before first event),
  // fall back to a generic 0..3 list so the dropdown is always usable.
  const state = (snapshot as { state?: unknown } | null)?.state;
  const ring = isPlainObject(state)
    ? (state["monitors"] as { elements?: unknown[] } | undefined)
    : undefined;
  const elements = Array.isArray(ring?.elements) ? ring.elements : [];
  if (elements.length === 0) {
    return [0, 1, 2, 3].map((i) => ({
      index: i,
      name: null,
      width: null,
      height: null,
    }));
  }
  return elements.map((m, i) => {
    const obj = isPlainObject(m) ? m : {};
    const size = isPlainObject(obj["size"]) ? obj["size"] : {};
    const right = numberOr(size["right"], 0);
    const left = numberOr(size["left"], 0);
    const bottom = numberOr(size["bottom"], 0);
    const top = numberOr(size["top"], 0);
    return {
      index: i,
      name:
        (typeof obj["name"] === "string" ? (obj["name"] as string) : null) ??
        (typeof obj["device_id"] === "string"
          ? (obj["device_id"] as string)
          : null),
      width: right > left ? right - left : null,
      height: bottom > top ? bottom - top : null,
    };
  });
}

function monitorLabel(m: MonitorOption): string {
  // Deliberately no "(Primary)" tag here — Komorebi's monitor index
  // does NOT correlate with Windows' primary display. We saw a setup
  // where Komorebi index 0 was a 0-width ghost monitor and index 1
  // was the real primary. Show device + size when we have them so the
  // user can pick by what they recognise.
  const parts: string[] = [`Monitor ${m.index}`];
  if (m.width && m.height) parts.push(`${m.width}×${m.height}`);
  if (m.name) parts.push(m.name);
  return parts.join(" — ");
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
