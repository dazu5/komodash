import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, PlayCircle, RotateCw } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-shell";
import { QuickToggleRow } from "@/components/quick-toggles";
import { StatusPill } from "@/components/status-pill";
import {
  detectKomorebi,
  focusWorkspace,
  startKomorebi,
  stopKomorebi,
  type KomorebiState,
} from "@/api/komorebi";
import { useLiveState, type LiveStateStatus } from "@/stores/live-state";
import { cn } from "@/lib/utils";

/**
 * The Dashboard page (issues #2 + #6 + #13 + #14 + #15). Shows:
 *
 * - Status pill: detection / running state from periodic `detect_komorebi`
 *   (issue #2; polled per #15 so external state changes are visible).
 * - Quick-toggle row: Pause / Mouse follows focus / Float override pills
 *   + Retile button (issue #14). Disabled when Komorebi isn't running.
 * - Live state tree: Monitor → Workspace → Container → Window, updated
 *   in real time from the named-pipe subscription (issue #6). Click a
 *   Workspace row to focus it via `komorebic focus-workspace` (issue #13).
 * - When Komorebi isn't running, the tree is replaced with a centred
 *   call-to-action: Start (or Restart if Komorebi crashed mid-session,
 *   issue #15).
 *
 * Window context menus (issue #26) land in their own slice.
 */
export default function DashboardPage() {
  const { detection, refresh: refreshDetection } = useKomorebiDetection();
  const { snapshot, status, subscribe } = useLiveState();

  useEffect(() => {
    let cancel: (() => void) | undefined;
    void subscribe().then((c) => (cancel = c));
    return () => cancel?.();
  }, [subscribe]);

  // Track whether we've ever seen Komorebi connected in this session,
  // so that a transition from connected → waiting surfaces as "crashed"
  // rather than "never started".
  const hasEverConnected = useRef(false);
  if (status === "connected") {
    hasEverConnected.current = true;
  }

  const running = detection?.running ?? false;
  const installed = (detection?.installed ?? null) !== null;
  const crashed = hasEverConnected.current && !running;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Live view of monitors, workspaces and managed windows."
      />
      <div className="flex items-center gap-3">
        <StatusPill state={detection} />
        <LiveStatePill status={status} />
      </div>

      <QuickToggleRow snapshot={snapshot} disabled={!running} />

      {running ? (
        <LiveStateTree snapshot={snapshot} status={status} />
      ) : (
        <NotRunningCta
          installed={installed}
          crashed={crashed}
          onAfterStart={refreshDetection}
        />
      )}
    </div>
  );
}

// ---- not-running CTA (#15) ------------------------------------------------

function NotRunningCta({
  installed,
  crashed,
  onAfterStart,
}: {
  installed: boolean;
  crashed: boolean;
  onAfterStart: () => Promise<void>;
}) {
  // ⚠️ Rules of Hooks: every hook MUST run unconditionally on every
  // render. The early `!installed` return goes *after* every hook
  // call — if it ran above, React would see a different hook count
  // when `installed` flipped and crash with "Rendered more hooks
  // than during the previous render."
  const [busy, setBusy] = useState(false);

  const onStart = useCallback(async () => {
    setBusy(true);
    try {
      if (crashed) {
        // Idempotent stop first so a half-dead process doesn't fight us.
        await stopKomorebi();
      }
      await startKomorebi({ withWhkd: true, withBar: true });
      toast.success("Starting Komorebi…");
      // Give Komorebi ~2s to come up before re-detecting. The Live state
      // subscription reconnects on its own via the existing backoff.
      window.setTimeout(() => {
        void onAfterStart();
      }, 2_000);
    } catch (e) {
      toast.error(
        `Couldn't start Komorebi: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      // Hold the busy state for the 2s settle so the user sees the spinner.
      window.setTimeout(() => setBusy(false), 2_000);
    }
  }, [crashed, onAfterStart]);

  // Komorebi not installed at all — direct the user toward the install
  // path. The first-run wizard (#23) will eventually consume this; for
  // now the About-page install panel from #9 is the workaround.
  if (!installed) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center space-y-3">
        <h3 className="text-sm font-medium">Komorebi isn't installed</h3>
        <p className="text-xs text-muted-foreground max-w-md mx-auto">
          Komodash couldn't find <code>komorebic.exe</code> on this machine.
          Head to the About page and use the install panel — it'll install
          Komorebi via winget or Scoop.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center space-y-4">
      <h3 className="text-sm font-medium">
        {crashed ? "Komorebi crashed" : "Komorebi is not running"}
      </h3>
      <p className="text-xs text-muted-foreground max-w-md mx-auto">
        {crashed
          ? "The Komorebi daemon disconnected unexpectedly. Restart it to get tiling back."
          : "Start Komorebi to begin tiling. Komodash will launch it with the status bar and hotkey daemon enabled."}
      </p>
      <button
        type="button"
        onClick={onStart}
        disabled={busy}
        className={cn(
          "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium",
          "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors",
          "disabled:cursor-not-allowed disabled:opacity-70",
        )}
      >
        {busy ? (
          <>
            <RotateCw className="h-4 w-4 animate-spin" />
            {crashed ? "Restarting…" : "Starting…"}
          </>
        ) : crashed ? (
          <>
            <RotateCw className="h-4 w-4" />
            Restart Komorebi
          </>
        ) : (
          <>
            <PlayCircle className="h-4 w-4" />
            Start Komorebi
          </>
        )}
      </button>
    </div>
  );
}

// ---- presentational --------------------------------------------------------

function LiveStatePill({ status }: { status: LiveStateStatus }) {
  if (status === "waiting") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 text-xs text-muted-foreground">
        Waiting for Komorebi…
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
      Live
    </span>
  );
}

function LiveStateTree({
  snapshot,
  status,
}: {
  snapshot: unknown;
  status: LiveStateStatus;
}) {
  if (status === "waiting" || snapshot === null) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Waiting for the first state update from Komorebi.
      </div>
    );
  }

  const monitors = getMonitors(snapshot);
  if (monitors.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        No monitors reported by Komorebi.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {monitors.map((m, i) => (
        <MonitorRow key={getMonitorKey(m, i)} monitor={m} index={i} />
      ))}
    </div>
  );
}

function MonitorRow({ monitor, index }: { monitor: unknown; index: number }) {
  const name = getString(monitor, "name") ?? `Monitor ${index + 1}`;
  const workspaces = getWorkspaces(monitor);
  const focusedWs = getRingFocused(monitor, "workspaces");
  return (
    <section className="rounded-lg border border-border bg-card overflow-hidden">
      <header className="flex items-center justify-between bg-secondary/50 px-3 py-1.5 text-xs">
        <span className="font-medium">{name}</span>
        <span className="text-muted-foreground">
          {workspaces.length} workspace{workspaces.length === 1 ? "" : "s"}
        </span>
      </header>
      <ul className="divide-y divide-border">
        {workspaces.map((w, j) => (
          <WorkspaceRow
            key={getString(w, "name") ?? `ws-${j}`}
            workspace={w}
            monitorIndex={index}
            workspaceIndex={j}
            focused={focusedWs === j}
          />
        ))}
      </ul>
    </section>
  );
}

function WorkspaceRow({
  workspace,
  monitorIndex,
  workspaceIndex,
  focused,
}: {
  workspace: unknown;
  monitorIndex: number;
  workspaceIndex: number;
  focused: boolean;
}) {
  // Focused workspaces start expanded — the user just navigated there,
  // they probably want to see what's inside.
  const [open, setOpen] = useState(focused);
  const name = getString(workspace, "name") ?? `Workspace ${workspaceIndex + 1}`;
  const containers = getContainers(workspace);
  const windowCount = containers
    .map((c) => getWindows(c).length)
    .reduce((a, b) => a + b, 0);

  const onFocus = async () => {
    if (focused) {
      // Already focused — just toggle the expand state. Saves a round-trip.
      setOpen((v) => !v);
      return;
    }
    try {
      await focusWorkspace(monitorIndex, workspaceIndex);
      // Optimistic open: the Live state update will arrive within ~100ms
      // and re-render the focused styling; the open state is local.
      setOpen(true);
    } catch (e) {
      toast.error(
        `Couldn't focus workspace: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  return (
    <li>
      <div
        className={cn(
          "flex items-center gap-1 text-sm",
          "hover:bg-secondary/40 transition-colors",
          focused && "bg-secondary/30",
        )}
      >
        <button
          type="button"
          onClick={(e) => {
            // Stop the click from bubbling to the focus button.
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          aria-label={open ? "Collapse workspace" : "Expand workspace"}
          className="px-2 py-2 hover:bg-secondary/40 transition-colors"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
        <button
          type="button"
          onClick={onFocus}
          aria-pressed={focused}
          title={focused ? "Already focused" : `Focus ${name}`}
          className="flex-1 flex items-center gap-2 py-2 pr-3 text-left"
        >
          <span className={cn("font-medium", focused && "text-foreground")}>
            {name}
          </span>
          {focused && (
            <span className="text-[10px] uppercase tracking-wide text-emerald-400/80">
              focused
            </span>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {windowCount} window{windowCount === 1 ? "" : "s"}
          </span>
        </button>
      </div>
      {open && (
        <ul className="pb-2 pl-9 pr-3 space-y-1">
          {containers.length === 0 ? (
            <li className="text-xs text-muted-foreground py-1">
              No managed containers.
            </li>
          ) : (
            containers.flatMap((c, k) =>
              getWindows(c).map((w) => (
                <WindowRow key={getWindowKey(w, c, k)} window={w} />
              )),
            )
          )}
        </ul>
      )}
    </li>
  );
}

function WindowRow({ window: w }: { window: unknown }) {
  const title = getString(w, "title") ?? "(untitled)";
  const exe = getString(w, "exe") ?? "(unknown)";
  return (
    <li className="flex items-center gap-2 text-xs">
      <span className="truncate text-foreground/90" title={title}>
        {title}
      </span>
      <span className="ml-auto text-muted-foreground shrink-0">{exe}</span>
    </li>
  );
}

// ---- detection hook (from #2, polled for #15) ------------------------------

/**
 * Periodically polls `detect_komorebi`. Mount-time poll plus a 5-second
 * interval so the Dashboard reflects external state changes (user
 * killing Komorebi via Task Manager, etc.) without needing a manual
 * refresh. The interval is cheap — detection is a one-shot syscall.
 */
function useKomorebiDetection(): {
  detection: KomorebiState | null;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<KomorebiState | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await detectKomorebi();
      setState(s);
    } catch {
      setState({ installed: null, running: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, 5_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return { detection: state, refresh };
}

// ---- snapshot navigators ---------------------------------------------------

function getMonitors(snapshot: unknown): unknown[] {
  const state = (snapshot as { state?: unknown })?.state;
  return getRingElements(state, "monitors");
}

function getWorkspaces(monitor: unknown): unknown[] {
  return getRingElements(monitor, "workspaces");
}

function getContainers(workspace: unknown): unknown[] {
  return getRingElements(workspace, "containers");
}

function getWindows(container: unknown): unknown[] {
  return getRingElements(container, "windows");
}

function getRingElements(obj: unknown, key: string): unknown[] {
  if (!isObject(obj)) return [];
  const ring = obj[key];
  if (!isObject(ring)) return [];
  const elements = ring.elements;
  return Array.isArray(elements) ? elements : [];
}

function getRingFocused(obj: unknown, key: string): number | null {
  if (!isObject(obj)) return null;
  const ring = obj[key];
  if (!isObject(ring)) return null;
  return typeof ring.focused === "number" ? ring.focused : null;
}

function getString(obj: unknown, key: string): string | null {
  if (!isObject(obj)) return null;
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function getMonitorKey(monitor: unknown, fallback: number): string {
  return (
    getString(monitor, "device_id") ??
    getString(monitor, "name") ??
    `m-${fallback}`
  );
}

function getWindowKey(
  window: unknown,
  container: unknown,
  containerIndex: number,
): string {
  const hwnd = isObject(window) && typeof window.hwnd === "number"
    ? window.hwnd
    : null;
  if (hwnd !== null) return String(hwnd);
  const cId = getString(container, "id") ?? `c-${containerIndex}`;
  const exe = getString(window, "exe") ?? "?";
  const title = getString(window, "title") ?? "?";
  return `${cId}::${exe}::${title}`;
}
