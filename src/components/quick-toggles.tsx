import { useCallback, useState } from "react";
import { Grid2x2, Pause, Move, MousePointer2 } from "lucide-react";
import { toast } from "sonner";

import {
  retile as retileCmd,
  toggleFloatOverride,
  toggleMouseFollowsFocus,
  togglePause,
} from "@/api/komorebi";
import { cn } from "@/lib/utils";

/**
 * The Dashboard's quick-toggle row (issue #14). Each toggle calls a thin
 * `komorebic toggle-*` Tauri command. Runtime-only — the static config
 * isn't touched. For a persistent default, edit the field on the
 * Configuration page.
 *
 * Optimistic update model: clicking flips the local state immediately
 * for snappy feedback, then the Tauri call fires. On failure the local
 * state reverts and a Sonner toast surfaces the friendly error.
 *
 * Initial state seeds from the Live-state snapshot when possible
 * (`is_paused`, `mouse_follows_focus`, `float_override` are top-level
 * fields on Komorebi's State). Anything we can't read defaults to
 * `false` — the first click corrects it.
 */
export function QuickToggleRow({
  snapshot,
  disabled,
}: {
  /** The latest Komorebi State snapshot, or null when not yet
   *  received. Used to seed initial toggle visuals. */
  snapshot: unknown;
  /** When `true`, all toggles are disabled (Komorebi not running). */
  disabled: boolean;
}) {
  const seed = readToggleSeed(snapshot);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleButton
        label="Pause"
        icon={<Pause className="h-3.5 w-3.5" />}
        initial={seed.isPaused}
        disabled={disabled}
        onToggle={togglePause}
      />
      <ToggleButton
        label="Mouse follows focus"
        icon={<MousePointer2 className="h-3.5 w-3.5" />}
        initial={seed.mouseFollowsFocus}
        disabled={disabled}
        onToggle={toggleMouseFollowsFocus}
      />
      <ToggleButton
        label="Float override"
        icon={<Move className="h-3.5 w-3.5" />}
        initial={seed.floatOverride}
        disabled={disabled}
        onToggle={toggleFloatOverride}
      />
      <RetileButton disabled={disabled} />
    </div>
  );
}

function ToggleButton({
  label,
  icon,
  initial,
  disabled,
  onToggle,
}: {
  label: string;
  icon: React.ReactNode;
  initial: boolean;
  disabled: boolean;
  onToggle: () => Promise<void>;
}) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  const click = useCallback(async () => {
    // Optimistic flip — feedback is instant even if Komorebi is slow.
    const previous = on;
    setOn(!previous);
    setBusy(true);
    try {
      await onToggle();
    } catch (e) {
      setOn(previous);
      toast.error(
        `Couldn't toggle ${label}: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setBusy(false);
    }
  }, [on, onToggle, label]);

  return (
    <button
      type="button"
      onClick={click}
      disabled={disabled || busy}
      aria-pressed={on}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        on
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
          : "border-border bg-secondary text-muted-foreground hover:bg-secondary/80",
        (disabled || busy) && "opacity-60 cursor-not-allowed",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function RetileButton({ disabled }: { disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const click = useCallback(async () => {
    setBusy(true);
    try {
      await retileCmd();
      toast.success("Retiled");
    } catch (e) {
      toast.error(
        `Retile failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <button
      type="button"
      onClick={click}
      disabled={disabled || busy}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1 text-xs",
        "text-foreground hover:bg-secondary/80 transition-colors",
        (disabled || busy) && "opacity-60 cursor-not-allowed",
      )}
    >
      <Grid2x2 className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
      Retile
    </button>
  );
}

/** Best-effort seed of the toggle states from the Komorebi State
 *  snapshot. Reads the top-level `is_paused`, `mouse_follows_focus`,
 *  `float_override` fields if they're booleans; defaults to `false`
 *  otherwise. The first click of any toggle that's mis-seeded will
 *  self-correct visually after the Live-state update. */
function readToggleSeed(snapshot: unknown): {
  isPaused: boolean;
  mouseFollowsFocus: boolean;
  floatOverride: boolean;
} {
  const state = (snapshot as { state?: unknown })?.state;
  return {
    isPaused: pickBoolean(state, "is_paused"),
    mouseFollowsFocus: pickBoolean(state, "mouse_follows_focus"),
    floatOverride: pickBoolean(state, "float_override"),
  };
}

function pickBoolean(obj: unknown, key: string): boolean {
  if (typeof obj !== "object" || obj === null) return false;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "boolean" ? v : false;
}
