import { Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KomorebiState } from "@/api/komorebi";

/**
 * The Dashboard status pill — three exclusive visual states sourced from
 * a single {@link KomorebiState}:
 *
 *  - **running** (green)      Komorebi is installed and alive.
 *  - **not-running** (amber)  Komorebi is installed but not currently running.
 *  - **not-detected** (grey)  No working `komorebic.exe` was found.
 *
 * The component is presentational. Polling / refresh lives in the caller.
 */
export function StatusPill({ state }: { state: KomorebiState | null }) {
  if (state === null) {
    return <Pill tone="loading" label="Checking Komorebi…" />;
  }

  if (state.installed === null) {
    return <Pill tone="grey" label="Komorebi not detected" />;
  }

  const versionLabel = state.installed.supported
    ? `Komorebi ${state.installed.version}`
    : `Komorebi ${state.installed.version} — upgrade recommended`;

  if (state.running) {
    return <Pill tone="green" label={`${versionLabel} (running)`} />;
  }
  return <Pill tone="amber" label={`${versionLabel} (not running)`} />;
}

type Tone = "green" | "amber" | "grey" | "loading";

function Pill({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm",
        toneStyles[tone],
      )}
    >
      <Circle
        className={cn("h-2.5 w-2.5", toneDotStyles[tone])}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

/** Background + border + text colour per tone. */
const toneStyles: Record<Tone, string> = {
  green:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  amber:
    "border-amber-500/30 bg-amber-500/10 text-amber-300",
  grey:
    "border-border bg-secondary text-muted-foreground",
  loading:
    "border-border bg-secondary text-muted-foreground animate-pulse",
};

/** Dot colour per tone (filled). */
const toneDotStyles: Record<Tone, string> = {
  green: "fill-emerald-400 text-emerald-400",
  amber: "fill-amber-400 text-amber-400",
  grey: "fill-muted-foreground text-muted-foreground",
  loading: "fill-muted-foreground text-muted-foreground",
};
