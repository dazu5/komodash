import { useCallback, useEffect, useState } from "react";
import { ArrowUpCircle, RotateCw } from "lucide-react";
import { toast } from "sonner";

import {
  availablePackageManagers,
  onInstallationOutput,
  upgradeKomorebiViaScoop,
  upgradeKomorebiViaWinget,
  type PackageManager,
} from "@/api/installer";
import { detectKomorebi, type KomorebicInfo } from "@/api/komorebi";
import { cn } from "@/lib/utils";

/**
 * "Check for Komorebi update" affordance on the About page (issue #16,
 * per ADR-0007). Wraps `winget upgrade LGUG2Z.komorebi` (or
 * `scoop update komorebi` as fallback).
 *
 * Flow:
 *   1. Read currently-installed version via `detect_komorebi`.
 *   2. Show button next to the version.
 *   3. Click → confirm dialog spelling out the exact command.
 *   4. Confirm → invoke upgrade Tauri command; stream output via the
 *      same `installation-output` event the install panel uses.
 *   5. On success → re-detect version + display the new one.
 *   6. On failure → Sonner toast with the error; version stays as-is.
 *
 * Per ADR-0007, Komodash never runs an upgrade silently — the user
 * always confirms.
 */
export function UpgradeKomorebiCard() {
  const [info, setInfo] = useState<KomorebicInfo | null>(null);
  const [managers, setManagers] = useState<PackageManager[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  // Initial fetch: installed version + available package managers.
  useEffect(() => {
    let cancelled = false;
    Promise.all([detectKomorebi(), availablePackageManagers()])
      .then(([detection, mgrs]) => {
        if (cancelled) return;
        setInfo(detection.installed);
        setManagers(mgrs);
      })
      .catch(() => {
        // Best-effort: leave info null. The card renders an explanatory
        // empty state below.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const primary = managers[0];

  const onConfirm = useCallback(async () => {
    if (!primary) return;
    setBusy(true);
    setLog([]);
    const unlisten = await onInstallationOutput((line) => {
      setLog((prev) => [...prev, line]);
    });
    try {
      const upgrade =
        primary.kind === "winget"
          ? upgradeKomorebiViaWinget
          : upgradeKomorebiViaScoop;
      const result = await upgrade();
      if (!result.success) {
        toast.error(`Upgrade exited with code ${result.exit_code}.`);
      } else {
        toast.success("Komorebi upgraded.");
        // Re-detect so the displayed version updates.
        const fresh = await detectKomorebi();
        setInfo(fresh.installed);
        setDialogOpen(false);
      }
    } catch (e) {
      toast.error(
        `Upgrade failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      unlisten();
      setBusy(false);
    }
  }, [primary]);

  if (!info) {
    // Either we haven't detected yet, or Komorebi isn't installed.
    return null;
  }

  const commandPreview =
    primary?.kind === "winget"
      ? "winget upgrade LGUG2Z.komorebi"
      : primary?.kind === "scoop"
        ? "scoop update komorebi"
        : null;

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3 max-w-prose">
      <div>
        <h2 className="text-sm font-medium">Komorebi</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Currently installed:{" "}
          <code className="rounded bg-secondary px-1.5 py-0.5">
            {info.version}
          </code>{" "}
          at <code className="text-foreground/80">{info.path}</code>.
        </p>
      </div>
      <button
        type="button"
        disabled={!primary}
        title={
          primary
            ? `Run \`${commandPreview}\``
            : "No package manager (winget or Scoop) is available. Upgrade Komorebi manually."
        }
        onClick={() => setDialogOpen(true)}
        className={cn(
          "inline-flex items-center gap-2 rounded-md border border-border",
          "bg-secondary hover:bg-secondary/80 px-3 py-1.5 text-sm",
          "transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        <ArrowUpCircle className="h-4 w-4" />
        Check for update
      </button>

      {dialogOpen && primary && commandPreview && (
        <ConfirmDialog
          commandPreview={commandPreview}
          busy={busy}
          log={log}
          onCancel={() => {
            if (!busy) setDialogOpen(false);
          }}
          onConfirm={onConfirm}
        />
      )}
    </section>
  );
}

function ConfirmDialog({
  commandPreview,
  busy,
  log,
  onCancel,
  onConfirm,
}: {
  commandPreview: string;
  busy: boolean;
  log: string[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-5 shadow-lg space-y-4">
        <div>
          <h3 className="text-sm font-medium">Upgrade Komorebi?</h3>
          <p className="text-xs text-muted-foreground mt-1">
            This will run{" "}
            <code className="rounded bg-secondary px-1.5 py-0.5 text-foreground">
              {commandPreview}
            </code>
            . The Komorebi service will restart.
          </p>
        </div>

        {log.length > 0 && (
          <pre className="text-[11px] font-mono whitespace-pre-wrap rounded border border-border bg-secondary/30 p-2 max-h-48 overflow-y-auto">
            {log.join("\n")}
          </pre>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className={cn(
              "rounded-md border border-border bg-secondary px-3 py-1.5 text-sm",
              "hover:bg-secondary/80 transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
              "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-70",
            )}
          >
            {busy ? (
              <>
                <RotateCw className="h-4 w-4 animate-spin" />
                Upgrading…
              </>
            ) : (
              "Upgrade"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
