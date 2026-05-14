import { useEffect, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { UnlistenFn } from "@tauri-apps/api/event";

import {
  availablePackageManagers,
  installKomorebiViaScoop,
  installKomorebiViaWinget,
  onInstallationOutput,
  type PackageManager,
  type PackageManagerKind,
} from "@/api/installer";
import { cn } from "@/lib/utils";

/**
 * Debug-only install panel (issue #9). Surfaces detected package
 * managers and lets the developer fire a Komorebi install with a
 * streaming log. The polished first-run flow lands in #21.
 */
export function InstallPanel() {
  const [managers, setManagers] = useState<PackageManager[]>([]);
  const [installing, setInstalling] = useState<PackageManagerKind | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void availablePackageManagers().then(setManagers);
    return () => {
      unlistenRef.current?.();
    };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log]);

  async function startInstall(kind: PackageManagerKind) {
    if (installing) return;
    setLog([]);
    setInstalling(kind);
    try {
      // Subscribe BEFORE invoking the install so we don't miss the first
      // few lines. unlisten on completion (success or failure).
      unlistenRef.current = await onInstallationOutput((line) =>
        setLog((prev) => [...prev, line]),
      );
      const result =
        kind === "winget"
          ? await installKomorebiViaWinget()
          : await installKomorebiViaScoop();
      if (result.success) {
        toast.success(`Komorebi installed via ${kind} (exit ${result.exit_code})`);
      } else {
        toast.error(`${kind} install failed (exit ${result.exit_code})`);
      }
    } catch (e) {
      toast.error(
        `Install error: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      unlistenRef.current?.();
      unlistenRef.current = null;
      setInstalling(null);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3 max-w-prose">
      <div>
        <h2 className="text-sm font-medium">Install Komorebi (debug)</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Direct invocation of the install flow. The polished first-run
          wizard arrives in a later slice.
        </p>
      </div>

      {managers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No package manager detected. Install winget (built in to Windows
          10/11) or{" "}
          <a
            href="https://scoop.sh"
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline underline-offset-4"
          >
            Scoop
          </a>{" "}
          first.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {managers.map((m) => (
            <InstallButton
              key={m.kind}
              manager={m}
              busy={installing === m.kind}
              disabled={installing !== null && installing !== m.kind}
              onClick={() => void startInstall(m.kind)}
            />
          ))}
        </div>
      )}

      {log.length > 0 && (
        <pre
          className={cn(
            "max-h-48 overflow-auto rounded-md bg-secondary px-3 py-2",
            "text-[11px] font-mono leading-relaxed whitespace-pre-wrap",
          )}
        >
          {log.join("\n")}
          <div ref={logEndRef} />
        </pre>
      )}
    </section>
  );
}

function InstallButton({
  manager,
  busy,
  disabled,
  onClick,
}: {
  manager: PackageManager;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={cn(
        "inline-flex items-center gap-2 rounded-md border border-border",
        "bg-secondary hover:bg-secondary/80 px-3 py-1.5 text-sm",
        "transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
      )}
      title={manager.path}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Download className="h-4 w-4" />
      )}
      {busy ? `Installing via ${manager.kind}…` : `Install via ${manager.kind}`}
    </button>
  );
}
