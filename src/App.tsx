import { useCallback, useEffect, useState } from "react";
import { Routes, Route, NavLink } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import {
  LayoutDashboard,
  Settings,
  Sliders,
  Keyboard,
  AppWindow,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

import DashboardPage from "@/pages/Dashboard";
import ConfigPage from "@/pages/Config";
import BarConfigPage from "@/pages/BarConfig";
import HotkeysPage from "@/pages/Hotkeys";
import AppRulesPage from "@/pages/AppRules";
import AboutPage from "@/pages/About";
import { FirstRunWizard } from "@/pages/FirstRunWizard";
import { detectFirstRunState } from "@/api/first-run";
import { markCloseToTrayNoticeSeen } from "@/api/preferences";
import { nextState, type WizardState } from "@/lib/first-run-fsm";
import { useUndoStack } from "@/stores/undo-stack";
import { UpdateBanner } from "@/components/update-banner";

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/config", label: "Configuration", icon: Settings },
  { to: "/bar", label: "Status Bar", icon: Sliders },
  { to: "/hotkeys", label: "Hotkeys", icon: Keyboard },
  { to: "/apps", label: "App Rules", icon: AppWindow },
  { to: "/about", label: "About", icon: Info },
];

export default function App() {
  const wizard = useFirstRunGate();
  useGlobalUndoHotkey();
  useCloseToTrayNotice();

  // Wait for the initial detection to land before rendering anything —
  // avoids flashing the main UI then yanking it away when the wizard
  // decides it needs to show.
  if (wizard === "loading") return null;

  if (wizard.show) {
    return (
      <div className="h-screen w-screen flex flex-col bg-background text-foreground">
        <FirstRunWizard onComplete={wizard.onComplete} />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground">
      <UpdateBanner />
      <div className="flex-1 flex overflow-hidden">
        <aside className="w-56 shrink-0 border-r border-border flex flex-col">
          <div className="px-4 py-5 border-b border-border">
            <div className="text-lg font-semibold tracking-tight">Komodash</div>
            <div className="text-xs text-muted-foreground">Komorebi dashboard</div>
          </div>
          <nav className="flex-1 px-2 py-3 space-y-1">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
            v0.1.0
          </div>
        </aside>

        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/config" element={<ConfigPage />} />
            <Route path="/bar" element={<BarConfigPage />} />
            <Route path="/hotkeys" element={<HotkeysPage />} />
            <Route path="/apps" element={<AppRulesPage />} />
            <Route path="/about" element={<AboutPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

/**
 * Detect-and-route shim for issue #23. On mount, runs the four wizard
 * preconditions through the FSM. While detection runs we report
 * `"loading"`. Once it resolves we report either `{show: true,
 * onComplete}` (wizard owns the screen) or `{show: false}` (normal
 * routes render).
 */
function useFirstRunGate():
  | "loading"
  | { show: true; onComplete: () => void }
  | { show: false } {
  const [status, setStatus] = useState<"loading" | "show" | "skip">("loading");

  useEffect(() => {
    let cancelled = false;
    detectFirstRunState()
      .then((detection) => {
        if (cancelled) return;
        const target: WizardState = nextState("detecting", detection);
        setStatus(target === "done" ? "skip" : "show");
      })
      .catch(() => {
        // Detection failed (komorebic missing, RPC error, etc.) — show
        // the wizard so the user can recover.
        if (!cancelled) setStatus("show");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onComplete = useCallback(() => setStatus("skip"), []);

  if (status === "loading") return "loading";
  if (status === "show") return { show: true, onComplete };
  return { show: false };
}

/**
 * Global Ctrl+Z hotkey for the undo stack (issue #21). Bound at the
 * shell level so every editor sees it. Ignored when the user is
 * typing in an input/textarea/contenteditable element so per-field
 * native undo (e.g. text input rollback) still works as expected.
 *
 * Ctrl+Y / Ctrl+Shift+Z (redo) is out of scope for v1 per the issue.
 */
function useGlobalUndoHotkey() {
  const undo = useUndoStack((s) => s.undo);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "z")) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) {
          return;
        }
      }
      e.preventDefault();
      void undo();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo]);
}

/**
 * One-shot toast the first time the window is closed-to-tray (#72).
 * The Rust window-event handler only emits the event if the user
 * hasn't yet acknowledged the behaviour change, so we just listen and
 * mark-seen on first toast. Subsequent closes are silent.
 */
function useCloseToTrayNotice() {
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen("komodash://close-to-tray-notice", () => {
      toast(
        "Komodash is still running in the tray. Right-click the tray icon to quit, or toggle this off on the About page.",
        { duration: 8000 },
      );
      void markCloseToTrayNoticeSeen();
    }).then((f) => {
      unlisten = f;
    });
    return () => {
      unlisten?.();
    };
  }, []);
}
