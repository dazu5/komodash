import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-shell";
import { StatusPill } from "@/components/status-pill";
import { detectKomorebi, type KomorebiState } from "@/api/komorebi";

/**
 * The Dashboard page (issue #2). For v1 of this slice, the page is just
 * the status pill — Live state tree, quick toggles, and window menus all
 * arrive in downstream issues (#6, #14, #26 respectively).
 */
export default function DashboardPage() {
  const state = useKomorebiDetection();

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Live view of monitors, workspaces and managed windows."
      />
      <div className="flex items-center gap-3">
        <StatusPill state={state} />
      </div>
    </div>
  );
}

/**
 * Polls `detect_komorebi` once on mount. Downstream issues will swap this
 * for the Live state subscription (#6) which pushes updates rather than
 * polling — for now, a single snapshot is enough to drive the pill.
 */
function useKomorebiDetection(): KomorebiState | null {
  const [state, setState] = useState<KomorebiState | null>(null);
  useEffect(() => {
    let cancelled = false;
    detectKomorebi()
      .then((s) => {
        if (!cancelled) setState(s);
      })
      .catch(() => {
        // Detection failed entirely — surface as "not detected" rather
        // than leaving the pill in its loading state forever.
        if (!cancelled)
          setState({ installed: null, running: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
