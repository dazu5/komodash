import { useEffect, useState } from "react";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-shell";
import { InstallPanel } from "@/components/install-panel";
import { UpgradeKomorebiCard } from "@/components/upgrade-komorebi-card";
import { getDiagnosticInfo } from "@/api/diagnostic";
import {
  getPreferences,
  setCloseToTray,
  type Preferences,
} from "@/api/preferences";
import { cn } from "@/lib/utils";

/**
 * About page. Project copy + the "Copy diagnostic info" affordance from
 * issue #10 (per ADR-0011 — local-only diagnostics, no telemetry) + the
 * debug Install panel from issue #9.
 *
 * Clicking Copy fetches the markdown blob from Rust, writes it to the
 * system clipboard via the standard browser API (works in Tauri's webview
 * because the page is same-origin and our CSP allows it), and shows a
 * Sonner confirmation toast.
 */
export default function AboutPage() {
  return (
    <div className="p-6 space-y-6">
      <PageHeader title="About" subtitle="Komodash v0.1.0" />
      <div className="text-sm text-muted-foreground max-w-prose space-y-3">
        <p>
          Komodash is a Tauri-based dashboard for{" "}
          <a
            href="https://github.com/LGUG2Z/komorebi"
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline underline-offset-4"
          >
            Komorebi
          </a>
          , a tiling window manager for Windows.
        </p>
        <p>
          The editor is driven by the live JSON Schema emitted by{" "}
          <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">
            komorebic static-config-schema
          </code>
          , so it stays in sync with whatever Komorebi version is installed.
        </p>
      </div>

      <UpgradeKomorebiCard />
      <BehaviourCard />
      <DiagnosticInfoCard />
      <InstallPanel />
    </div>
  );
}

/**
 * Behaviour card — currently just the close-to-tray toggle (#72).
 * Lives on About because there's no dedicated Preferences page yet
 * and this is the only app-level setting Komodash exposes.
 */
function BehaviourCard() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPreferences()
      .then((p) => {
        if (!cancelled) setPrefs(p);
      })
      .catch(() => {
        // Best-effort — preferences are non-critical UX state, so
        // failing to load just hides the card rather than nagging
        // the user.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (prefs === null) return null;

  const onToggle = async (next: boolean) => {
    setPrefs({ ...prefs, close_to_tray: next });
    try {
      await setCloseToTray(next);
    } catch (e) {
      setPrefs(prefs);
      toast.error(
        `Failed to save preference: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3 max-w-prose">
      <div>
        <h2 className="text-sm font-medium">Behaviour</h2>
        <p className="text-xs text-muted-foreground mt-1">
          How Komodash behaves outside the main window.
        </p>
      </div>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={prefs.close_to_tray}
          onChange={(e) => void onToggle(e.target.checked)}
        />
        <span className="text-sm flex-1">
          <span className="font-medium">Close to tray</span>
          <span className="block text-xs text-muted-foreground mt-0.5">
            When checked, the X button hides Komodash to the system tray
            instead of exiting. Use the tray icon to bring it back or
            quit fully.
          </span>
        </span>
      </label>
    </section>
  );
}

/**
 * The Copy-diagnostic-info card. Reports any failure inline via a toast
 * rather than crashing the page — clipboard access can be denied by the
 * webview in unusual configurations.
 */
function DiagnosticInfoCard() {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      const blob = await getDiagnosticInfo();
      await navigator.clipboard.writeText(blob);
      setCopied(true);
      toast.success("Diagnostic info copied to clipboard");
      // Reset the icon after a beat so repeat-clicks still feel responsive.
      window.setTimeout(() => setCopied(false), 2_000);
    } catch (e) {
      toast.error(
        `Failed to copy diagnostic info: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3 max-w-prose">
      <div>
        <h2 className="text-sm font-medium">Reporting a bug?</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Copy the diagnostic block below and paste it into your GitHub issue.
          It includes the Komodash and Komorebi versions, your OS version,
          and the last 100 lines of today's log. Nothing is sent anywhere by
          Komodash itself.
        </p>
      </div>
      <button
        type="button"
        onClick={onCopy}
        className={cn(
          "inline-flex items-center gap-2 rounded-md border border-border",
          "bg-secondary hover:bg-secondary/80 px-3 py-1.5 text-sm",
          "transition-colors",
        )}
      >
        {copied ? (
          <>
            <Check className="h-4 w-4" />
            Copied
          </>
        ) : (
          <>
            <Copy className="h-4 w-4" />
            Copy diagnostic info
          </>
        )}
      </button>
    </section>
  );
}
