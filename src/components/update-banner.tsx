import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "@/lib/utils";
import { checkKomodashUpdate, type UpdateInfo } from "@/api/updates";

/**
 * Non-blocking banner that announces a pending Komodash update.
 *
 * Per ADR-0011, Komodash v1 ships unsigned via GitHub Releases with an
 * in-app notification (not auto-download). On mount this polls the
 * backend's `check_komodash_update` command (which itself caches the
 * GitHub API response for 24 hours) and renders only when a strictly
 * newer release exists.
 *
 * Dismissal is *per session*: clicking X hides the banner until the next
 * launch. There is no persistent "do not show again" — by design, so the
 * banner re-surfaces if a still-newer release ships.
 *
 * The Download button opens the release page in the user's default
 * browser via `tauri-plugin-opener`; we deliberately don't fetch the
 * installer ourselves (that's v1.x's signed-updater work).
 */
export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    checkKomodashUpdate()
      .then((info) => {
        if (!cancelled) setUpdate(info);
      })
      .catch(() => {
        // Backend already swallows errors into `null`; this catch is
        // defence-in-depth so a bad invoke never throws into React.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (update === null || dismissed) {
    return null;
  }

  const handleDownload = () => {
    void openUrl(update.html_url);
  };

  return (
    <div
      role="status"
      className={cn(
        "flex items-center justify-between gap-4 border-b border-primary/30",
        "bg-primary/10 px-4 py-2 text-sm text-foreground",
      )}
    >
      <span>
        Komodash <strong className="font-semibold">{update.tag_name}</strong> is available.
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleDownload}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border border-primary/40",
            "bg-primary/20 px-3 py-1 text-xs font-medium",
            "hover:bg-primary/30 transition-colors",
          )}
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Download
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss update notification"
          className={cn(
            "inline-flex items-center justify-center rounded-md p-1",
            "text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors",
          )}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
