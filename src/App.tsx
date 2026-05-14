import { Routes, Route, NavLink } from "react-router-dom";
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
