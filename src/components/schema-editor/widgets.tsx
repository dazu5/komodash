import { useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Monitor as MonitorIcon,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  parseAnimationConfig,
  setAnimationField,
  type SimpleAnimationConfig,
} from "@/lib/animation";
import {
  BORDER_COLOUR_STATES,
  parseBorderColours,
  setBorderColour,
  type BorderColourState,
} from "@/lib/border-colours";
import {
  buildThemeValue,
  KNOWN_PALETTES,
  parseTheme,
  type Palette,
} from "@/lib/theme";
import {
  addWorkspace,
  createMonitors,
  parseMonitors,
  parseWorkspaces,
  removeWorkspace,
  updateWorkspaceField,
  type RawMonitor,
} from "@/lib/workspaces";
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

/**
 * Structured editor for `monitors[].workspaces[]` (issue #64). Replaces
 * the raw-JSON fallback so non-technical users can name workspaces and
 * pick layouts without touching JSON — per the [[no-json-as-ux]]
 * principle. Lives in the Static config pipeline so edits Live-apply
 * via [[hybrid-save-model]] (ADR-0006).
 *
 * Tabs map 1:1 to monitors in the array (NOT to live monitors — those
 * just supply friendlier tab labels). When the array is empty / null
 * we render an explanatory empty-state and offer to bootstrap an
 * explicit `monitors` array sized to the live monitor count.
 */
export function WorkspacesWidget({
  value,
  readonly,
  layoutOptions,
  onChange,
}: {
  value: unknown;
  readonly: boolean;
  /** Pulled from the root schema's `$defs.DefaultLayout` by the
   *  SchemaEditor. Passed in so this widget doesn't need to walk the
   *  full schema itself. */
  layoutOptions: string[];
  onChange?: (next: unknown) => void;
}) {
  const snapshot = useLiveState((s) => s.snapshot);
  const liveMonitors = extractMonitorOptions(snapshot);
  const monitors = parseMonitors(value);
  const [activeTab, setActiveTab] = useState(0);

  // Clamp activeTab when the array shrinks (e.g. after a hypothetical
  // future remove-monitor). Cheap; runs every render.
  const safeTab = monitors.length === 0 ? 0 : Math.min(activeTab, monitors.length - 1);

  if (monitors.length === 0) {
    return (
      <EmptyMonitorsState
        readonly={readonly}
        liveMonitorCount={liveMonitors.length}
        onCreate={(count) => onChange?.(createMonitors(count))}
      />
    );
  }

  return (
    <div className="space-y-3">
      <MonitorTabs
        monitors={monitors}
        liveMonitors={liveMonitors}
        active={safeTab}
        onSelect={setActiveTab}
      />
      <MonitorTabPanel
        monitor={monitors[safeTab]!}
        readonly={readonly}
        layoutOptions={layoutOptions}
        onAdd={() => onChange?.(addWorkspace(monitors, safeTab))}
        onRemove={(wi) => onChange?.(removeWorkspace(monitors, safeTab, wi))}
        onPatch={(wi, field, v) =>
          onChange?.(updateWorkspaceField(monitors, safeTab, wi, field, v))
        }
      />
    </div>
  );
}

function EmptyMonitorsState({
  readonly,
  liveMonitorCount,
  onCreate,
}: {
  readonly: boolean;
  liveMonitorCount: number;
  onCreate: (count: number) => void;
}) {
  const count = Math.max(1, liveMonitorCount);
  return (
    <div className="rounded-md border border-dashed border-border bg-secondary/20 p-4 space-y-2">
      <p className="text-sm">
        You're using Komorebi's anonymous default workspaces. To name
        workspaces or pin per-workspace layouts, switch to an explicit
        per-monitor configuration.
      </p>
      <button
        type="button"
        disabled={readonly}
        onClick={() => onCreate(count)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border",
          "bg-secondary hover:bg-secondary/80 px-3 py-1.5 text-xs font-medium",
          "transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        Create explicit monitors config ({count} monitor
        {count === 1 ? "" : "s"})
      </button>
    </div>
  );
}

function MonitorTabs({
  monitors,
  liveMonitors,
  active,
  onSelect,
}: {
  monitors: RawMonitor[];
  liveMonitors: MonitorOption[];
  active: number;
  onSelect: (idx: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-border" role="tablist">
      {monitors.map((_, i) => {
        const live = liveMonitors.find((m) => m.index === i);
        const label = live ? monitorLabel(live) : `Monitor ${i}`;
        const isActive = i === active;
        return (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(i)}
            className={cn(
              "rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors -mb-px border-b-2",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function MonitorTabPanel({
  monitor,
  readonly,
  layoutOptions,
  onAdd,
  onRemove,
  onPatch,
}: {
  monitor: RawMonitor;
  readonly: boolean;
  layoutOptions: string[];
  onAdd: () => void;
  onRemove: (workspaceIdx: number) => void;
  onPatch: (workspaceIdx: number, field: string, value: unknown) => void;
}) {
  const workspaces = parseWorkspaces(monitor);
  return (
    <div className="space-y-2">
      {workspaces.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">
          No workspaces yet — add one below.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {workspaces.map((w, i) => (
            <WorkspaceRow
              key={i}
              workspace={w}
              readonly={readonly}
              layoutOptions={layoutOptions}
              onNameChange={(name) => onPatch(i, "name", name)}
              onLayoutChange={(layout) => onPatch(i, "layout", layout)}
              onRemove={() => onRemove(i)}
            />
          ))}
        </ul>
      )}
      <button
        type="button"
        disabled={readonly}
        onClick={onAdd}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border",
          "bg-secondary hover:bg-secondary/80 px-2.5 py-1 text-xs",
          "transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <Plus className="h-3 w-3" />
        Add workspace
      </button>
    </div>
  );
}

function WorkspaceRow({
  workspace,
  readonly,
  layoutOptions,
  onNameChange,
  onLayoutChange,
  onRemove,
}: {
  workspace: Record<string, unknown>;
  readonly: boolean;
  layoutOptions: string[];
  onNameChange: (name: string) => void;
  onLayoutChange: (layout: string) => void;
  onRemove: () => void;
}) {
  const name = typeof workspace.name === "string" ? workspace.name : "";
  const layout =
    typeof workspace.layout === "string" ? workspace.layout : "BSP";
  const choices = layoutOptions.includes(layout)
    ? layoutOptions
    : [layout, ...layoutOptions];
  return (
    <li className="grid grid-cols-[1fr_10rem_auto] gap-2 items-center">
      <input
        type="text"
        className={baseInput}
        value={name}
        placeholder="Workspace name"
        disabled={readonly}
        onChange={(e) => onNameChange(e.target.value)}
      />
      <select
        className={baseInput}
        value={layout}
        disabled={readonly}
        onChange={(e) => onLayoutChange(e.target.value)}
      >
        {choices.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={readonly}
        onClick={onRemove}
        title="Delete this workspace"
        className={cn(
          "inline-flex items-center justify-center rounded-md border border-border",
          "bg-secondary hover:bg-destructive/20 hover:border-destructive/40",
          "hover:text-destructive p-1.5 transition-colors",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

/**
 * Structured editor for `border_colours` (issue #75). Six labeled
 * colour pickers driven by `<input type="color">`, one per
 * `BorderColourState`. Hex swatch + value display next to each. Used
 * to be a JSON textarea — per the [[no-json-as-ux]] principle, the
 * highest-visibility setting on first install should not require
 * editing JSON.
 *
 * Emits the on-disk shape `{state: hex, …}` with only set states
 * present, so an unset state doesn't write `null` into the config
 * (Komorebi tolerates null but the absence is cleaner).
 */
export function BorderColoursWidget({
  value,
  readonly,
  onChange,
}: {
  value: unknown;
  readonly: boolean;
  onChange?: (next: unknown) => void;
}) {
  const colours = parseBorderColours(value);
  const emit = (state: BorderColourState, next: string | null) => {
    const merged = setBorderColour(colours, state, next);
    const stripped: Record<string, string> = {};
    for (const k of BORDER_COLOUR_STATES) {
      const v = merged[k];
      if (typeof v === "string") stripped[k] = v;
    }
    onChange?.(stripped);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {BORDER_COLOUR_STATES.map((state) => (
        <BorderColourRow
          key={state}
          state={state}
          hex={colours[state]}
          readonly={readonly}
          onChange={(next) => emit(state, next)}
        />
      ))}
    </div>
  );
}

function BorderColourRow({
  state,
  hex,
  readonly,
  onChange,
}: {
  state: BorderColourState;
  hex: string | null;
  readonly: boolean;
  onChange: (next: string | null) => void;
}) {
  const id = useId();
  const display = hex ?? "#000000";
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-2 py-1.5">
      <input
        id={id}
        type="color"
        className="h-6 w-8 rounded border border-border bg-transparent cursor-pointer disabled:cursor-not-allowed"
        value={display}
        disabled={readonly}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${BORDER_COLOUR_LABELS[state]} colour picker`}
      />
      <label htmlFor={id} className="text-xs font-medium flex-1">
        {BORDER_COLOUR_LABELS[state]}
      </label>
      <code className="text-xs text-muted-foreground tabular-nums">
        {hex ?? "(unset)"}
      </code>
      {!readonly && hex !== null && (
        <button
          type="button"
          onClick={() => onChange(null)}
          title={`Clear ${BORDER_COLOUR_LABELS[state]}`}
          className="text-muted-foreground hover:text-destructive transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

const BORDER_COLOUR_LABELS: Record<BorderColourState, string> = {
  single: "Single",
  stack: "Stack",
  monocle: "Monocle",
  floating: "Floating",
  unfocused: "Unfocused",
  unfocused_locked: "Unfocused + locked",
};

/**
 * Structured editor for the `animation` field (issue #76). Renders
 * four controls inline: enabled toggle, duration slider (0–1000 ms),
 * style dropdown (sourced from schema enum), fps input.
 *
 * Komorebi's schema allows each field to be either a primitive OR a
 * per-prefix object (`{movement: ..., transparency: ...}`) for fine-
 * grained per-animation control. When the on-disk value uses the
 * per-prefix form, we render a notice and decline to edit so the
 * widget doesn't flatten a power user's overrides.
 */
export function AnimationWidget({
  value,
  readonly,
  animationStyles,
  onChange,
}: {
  value: unknown;
  readonly: boolean;
  /** AnimationStyle enum extracted from the root schema by the
   *  SchemaEditor. Falls back to a built-in list when the schema
   *  doesn't ship it. */
  animationStyles: string[];
  onChange?: (next: unknown) => void;
}) {
  const parsed = parseAnimationConfig(value);

  if (parsed.advanced) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
        Advanced per-animation config detected (one or more fields use
        the <code>{`{movement, transparency}`}</code> form). Komodash's
        simple editor would flatten this — edit komorebi.json directly
        if you need per-animation overrides.
      </div>
    );
  }

  const emit = <K extends keyof SimpleAnimationConfig>(
    key: K,
    next: SimpleAnimationConfig[K],
  ) => onChange?.(setAnimationField(parsed.simple, key, next));

  const styleChoices = animationStyles.includes(parsed.simple.style)
    ? animationStyles
    : [parsed.simple.style, ...animationStyles];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_12rem_6rem] gap-3 items-center">
      <BooleanWidget
        value={parsed.simple.enabled}
        readonly={readonly}
        onChange={(v) => emit("enabled", v)}
      />
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={1000}
          step={10}
          className="flex-1"
          value={parsed.simple.duration}
          disabled={readonly}
          onChange={(e) => emit("duration", Number(e.target.value))}
        />
        <code className="text-xs tabular-nums text-muted-foreground w-14 text-right">
          {parsed.simple.duration} ms
        </code>
      </div>
      <select
        className={baseInput}
        value={parsed.simple.style}
        disabled={readonly}
        onChange={(e) => emit("style", e.target.value)}
      >
        {styleChoices.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <input
        type="number"
        min={1}
        max={240}
        className={baseInput}
        value={parsed.simple.fps}
        disabled={readonly}
        onChange={(e) => emit("fps", Number(e.target.value))}
      />
    </div>
  );
}

/**
 * Theme picker (issue #77). Two-dropdown UX: palette kind, then
 * variant. Variants are sourced from the live schema, so when
 * komorebi adds a new Base16 theme it shows up without a Komodash
 * release. The Custom palette variant isn't editable yet — we render
 * a notice instead so the user's custom palette isn't silently
 * replaced by a Catppuccin selection.
 */
export function ThemeWidget({
  value,
  readonly,
  themeVariants,
  onChange,
}: {
  value: unknown;
  readonly: boolean;
  /** Variant names extracted from `$defs.Catppuccin` / `$defs.Base16`
   *  by the SchemaEditor. Empty arrays disable the variant dropdown. */
  themeVariants: Record<Palette, string[]>;
  onChange?: (next: unknown) => void;
}) {
  const parsed = parseTheme(value);

  const emitPalette = (palette: Palette | null) => {
    if (palette === null) {
      onChange?.(null);
      return;
    }
    // Pick a default variant when switching palettes so the on-disk
    // value is immediately valid (komorebi rejects a palette without
    // its required `name` field for the named variants).
    const fallback = themeVariants[palette]?.[0] ?? null;
    onChange?.(buildThemeValue(palette, fallback));
  };

  const emitName = (name: string) => {
    if (parsed.palette === null) return;
    onChange?.(buildThemeValue(parsed.palette, name));
  };

  const variants = parsed.palette ? themeVariants[parsed.palette] : [];
  const showVariants = parsed.palette !== null && parsed.palette !== "Custom";
  const variantChoices =
    parsed.name && variants && !variants.includes(parsed.name)
      ? [parsed.name, ...variants]
      : variants;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select
          className={baseInput}
          value={parsed.palette ?? ""}
          disabled={readonly}
          onChange={(e) =>
            emitPalette(e.target.value === "" ? null : (e.target.value as Palette))
          }
        >
          <option value="">(no theme)</option>
          {KNOWN_PALETTES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        {showVariants && variantChoices.length > 0 && (
          <select
            className={baseInput}
            value={parsed.name ?? ""}
            disabled={readonly}
            onChange={(e) => emitName(e.target.value)}
          >
            {variantChoices.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        )}
      </div>
      {parsed.isCustom && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          You're using a Custom theme. Komodash's picker doesn't ship a
          custom-palette editor yet — switch to Catppuccin or Base16
          would overwrite your custom palette. Edit komorebi.json
          directly to tune it.
        </div>
      )}
    </div>
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
