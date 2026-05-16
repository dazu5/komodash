import { useCallback, useEffect, useState } from "react";
import {
  CircleCheck,
  Cog,
  Download,
  PlayCircle,
  Power,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import {
  detectFirstRunState,
  disableAutostart,
  enableAutostart,
  writeStarterConfig,
} from "@/api/first-run";
import { installKomorebiViaWinget } from "@/api/installer";
import { startKomorebi } from "@/api/komorebi";
import {
  nextState,
  type DetectionResult,
  type WizardState,
} from "@/lib/first-run-fsm";
import { cn } from "@/lib/utils";

/**
 * First-run wizard (issue #23, per ADR-0007 + ADR-0010).
 *
 * Walks the End user through whichever of the four preconditions
 * (Komorebi installed, config created, daemon running, autostart on)
 * don't pass detection. The pure FSM lives at `src/lib/first-run-fsm.ts`;
 * this component is the renderer + the per-step action thunks.
 *
 * On `done`, calls `onComplete()` so the App can swap the wizard out
 * for the normal Dashboard routes.
 *
 * Deferred to a follow-up: "Show me the command instead" escape-hatch
 * modal (issue #23 AC). For v1 the action buttons are the only path.
 */
export function FirstRunWizard({ onComplete }: { onComplete: () => void }) {
  const [state, setState] = useState<WizardState>("detecting");
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<DetectionResult> => {
    const detection = await detectFirstRunState();
    setState((curr) => nextState(curr, detection));
    return detection;
  }, []);

  // Mount-time detection. Runs once.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Auto-exit when the FSM lands on done.
  useEffect(() => {
    if (state === "done") onComplete();
  }, [state, onComplete]);

  const runAction = useCallback(
    async (label: string, action: () => Promise<void>) => {
      setActing(true);
      setError(null);
      try {
        await action();
        toast.success(`${label} — done`);
        // Give the daemon / filesystem a beat to settle, then re-detect.
        await new Promise((r) => setTimeout(r, 800));
        await refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        toast.error(`${label} failed: ${msg}`);
      } finally {
        setActing(false);
      }
    },
    [refresh],
  );

  return (
    <div className="h-full w-full flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-xl space-y-6">
        <Header state={state} />
        {state === "detecting" && <DetectingCard />}
        {state === "install_komorebi" && (
          <InstallCard
            acting={acting}
            onAction={() =>
              runAction("Install Komorebi", async () => {
                const result = await installKomorebiViaWinget();
                if (!result.success) {
                  throw new Error(`winget exited with code ${result.exit_code}`);
                }
              })
            }
          />
        )}
        {state === "create_config" && (
          <CreateConfigCard
            acting={acting}
            onAction={() => runAction("Create starter config", writeStarterConfig)}
          />
        )}
        {state === "start_komorebi" && (
          <StartCard
            acting={acting}
            onAction={() =>
              runAction("Start Komorebi", () =>
                startKomorebi({ withWhkd: true, withBar: true }),
              )
            }
          />
        )}
        {state === "enable_autostart" && (
          <AutostartCard
            acting={acting}
            onEnable={() => runAction("Enable autostart", enableAutostart)}
            onSkip={() =>
              runAction("Skip autostart", async () => {
                await disableAutostart();
              })
            }
          />
        )}
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <div className="font-medium mb-1">Step failed</div>
            <div className="font-mono text-xs whitespace-pre-wrap">{error}</div>
          </div>
        )}
        <RetryRow acting={acting} onRetry={refresh} />
      </div>
    </div>
  );
}

// ---- cards ----------------------------------------------------------------

function Header({ state }: { state: WizardState }) {
  const step = stepNumber(state);
  return (
    <div className="text-center space-y-1">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        Welcome to Komodash
      </div>
      <div className="text-2xl font-semibold">
        Let's get Komorebi set up
      </div>
      {state !== "detecting" && state !== "done" && (
        <div className="text-xs text-muted-foreground">Step {step} of 4</div>
      )}
    </div>
  );
}

function DetectingCard() {
  return (
    <Card icon={<RefreshCw className="h-5 w-5 animate-spin" />} title="Checking your setup…">
      <p className="text-sm text-muted-foreground">
        Looking for Komorebi, your config, and autostart.
      </p>
    </Card>
  );
}

function InstallCard({
  acting,
  onAction,
}: {
  acting: boolean;
  onAction: () => void;
}) {
  return (
    <Card icon={<Download className="h-5 w-5 text-blue-400" />} title="Install Komorebi">
      <p className="text-sm text-muted-foreground">
        Komodash will install Komorebi via{" "}
        <span className="text-foreground font-mono">winget</span> — takes about
        30 seconds.
      </p>
      <ActionButton onClick={onAction} disabled={acting}>
        {acting ? "Installing…" : "Install Komorebi"}
      </ActionButton>
    </Card>
  );
}

function CreateConfigCard({
  acting,
  onAction,
}: {
  acting: boolean;
  onAction: () => void;
}) {
  return (
    <Card icon={<Cog className="h-5 w-5 text-emerald-400" />} title="Create your config">
      <p className="text-sm text-muted-foreground">
        Komodash will create a starter <span className="font-mono">komorebi.json</span> tuned
        for new users — animations on, click-to-focus, visible window borders.
      </p>
      <ActionButton onClick={onAction} disabled={acting}>
        {acting ? "Creating…" : "Create config"}
      </ActionButton>
    </Card>
  );
}

function StartCard({
  acting,
  onAction,
}: {
  acting: boolean;
  onAction: () => void;
}) {
  return (
    <Card icon={<PlayCircle className="h-5 w-5 text-emerald-400" />} title="Start Komorebi">
      <p className="text-sm text-muted-foreground">
        Komodash will launch Komorebi with the status bar and hotkeys enabled.
      </p>
      <ActionButton onClick={onAction} disabled={acting}>
        {acting ? "Starting…" : "Start Komorebi"}
      </ActionButton>
    </Card>
  );
}

function AutostartCard({
  acting,
  onEnable,
  onSkip,
}: {
  acting: boolean;
  onEnable: () => void;
  onSkip: () => void;
}) {
  return (
    <Card icon={<Power className="h-5 w-5 text-purple-400" />} title="Launch on login?">
      <p className="text-sm text-muted-foreground">
        Start Komorebi automatically when you log in? Recommended — most users
        forget to launch it manually.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <ActionButton onClick={onEnable} disabled={acting}>
          {acting ? "Working…" : "Yes (recommended)"}
        </ActionButton>
        <button
          type="button"
          onClick={onSkip}
          disabled={acting}
          className={cn(
            "rounded-md border border-border px-3 py-1.5 text-sm",
            "bg-secondary hover:bg-secondary/80 transition-colors",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          No, I'll start it myself
        </button>
      </div>
    </Card>
  );
}

function RetryRow({
  acting,
  onRetry,
}: {
  acting: boolean;
  onRetry: () => Promise<DetectionResult>;
}) {
  return (
    <div className="text-center">
      <button
        type="button"
        onClick={() => void onRetry()}
        disabled={acting}
        className={cn(
          "text-xs text-muted-foreground hover:text-foreground transition-colors",
          "inline-flex items-center gap-1",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <RefreshCw className="h-3 w-3" />
        Re-check
      </button>
    </div>
  );
}

// ---- shared ---------------------------------------------------------------

function Card({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-3">
      <div className="flex items-center gap-3">
        {icon}
        <div className="font-semibold">{title}</div>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function ActionButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-md px-4 py-2 text-sm font-medium transition-colors",
        "inline-flex items-center gap-2",
        disabled
          ? "bg-secondary text-muted-foreground cursor-not-allowed"
          : "bg-primary text-primary-foreground hover:bg-primary/90",
      )}
    >
      {!disabled && <CircleCheck className="h-4 w-4" />}
      {children}
    </button>
  );
}

function stepNumber(state: WizardState): number {
  switch (state) {
    case "install_komorebi":
      return 1;
    case "create_config":
      return 2;
    case "start_komorebi":
      return 3;
    case "enable_autostart":
      return 4;
    default:
      return 0;
  }
}
