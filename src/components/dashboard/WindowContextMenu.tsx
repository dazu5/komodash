import * as ContextMenu from "@radix-ui/react-context-menu";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Move, Plus, X, Pin } from "lucide-react";
import { toast } from "sonner";

import {
  closeFocusedWindow,
  moveFocusedWindowToWorkspace,
  toggleFocusedWindowFloat,
} from "@/api/window-actions";
import { useLiveState } from "@/stores/live-state";
import { buildSendToWorkspaceItems } from "@/lib/window-context-menu";
import { cn } from "@/lib/utils";

/**
 * Right-click context menu wrapper for a Dashboard Window row
 * (issue #26). The menu actions all operate on Komorebi's currently-
 * focused window — the user is expected to click the row first to
 * focus it, then right-click for the menu.
 *
 * **Add to App Rules** navigates to `/apps?prefill_exe=…`; the App
 * Rules page reads the query param and opens the modal pre-filled.
 */
export function WindowContextMenu({
  exe,
  children,
}: {
  exe: string;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const { snapshot } = useLiveState();
  const monitors = extractMonitors(snapshot);
  const sendItems = buildSendToWorkspaceItems(monitors);

  const guard = async (label: string, action: () => Promise<void>) => {
    try {
      await action();
    } catch (e) {
      toast.error(
        `${label} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuContentClass}>
          <ContextMenu.Item
            className={menuItemClass}
            onSelect={() => void guard("Toggle float", toggleFocusedWindowFloat)}
          >
            <Pin className="h-3.5 w-3.5" />
            Toggle float
          </ContextMenu.Item>

          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={menuItemClass}>
              <Move className="h-3.5 w-3.5" />
              Send to workspace
              <ChevronRight className="ml-auto h-3.5 w-3.5" />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={menuContentClass}>
                {sendItems.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No workspaces detected
                  </div>
                ) : (
                  sendItems.map((item) => (
                    <ContextMenu.Item
                      key={`${item.monitor}-${item.workspace}`}
                      className={menuItemClass}
                      onSelect={() =>
                        void guard("Move to workspace", () =>
                          moveFocusedWindowToWorkspace(
                            item.monitor,
                            item.workspace,
                          ),
                        )
                      }
                    >
                      {item.label}
                    </ContextMenu.Item>
                  ))
                )}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>

          <ContextMenu.Separator className="h-px bg-border my-1" />

          <ContextMenu.Item
            className={menuItemClass}
            onSelect={() =>
              navigate(`/apps?prefill_exe=${encodeURIComponent(exe)}`)
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Add to App Rules…
          </ContextMenu.Item>

          <ContextMenu.Separator className="h-px bg-border my-1" />

          <ContextMenu.Item
            className={cn(menuItemClass, "text-destructive focus:bg-destructive/20")}
            onSelect={() => void guard("Close window", closeFocusedWindow)}
          >
            <X className="h-3.5 w-3.5" />
            Close
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

const menuContentClass = cn(
  "z-50 min-w-44 rounded-md border border-border bg-card p-1 shadow-lg",
  "text-sm",
);

const menuItemClass = cn(
  "flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs cursor-default",
  "outline-none focus:bg-secondary",
  "data-[disabled]:opacity-50 data-[disabled]:pointer-events-none",
);

function extractMonitors(snapshot: unknown): Array<{ workspaces?: { name?: string }[] }> {
  if (typeof snapshot !== "object" || snapshot === null) return [];
  const monitorsRing = (snapshot as Record<string, unknown>).monitors;
  if (typeof monitorsRing !== "object" || monitorsRing === null) return [];
  const elements = (monitorsRing as Record<string, unknown>).elements;
  if (!Array.isArray(elements)) return [];
  return elements.map((m) => {
    const wsRing =
      typeof m === "object" && m !== null
        ? (m as Record<string, unknown>).workspaces
        : null;
    const wsElements =
      typeof wsRing === "object" && wsRing !== null
        ? (wsRing as Record<string, unknown>).elements
        : null;
    if (!Array.isArray(wsElements)) return { workspaces: [] };
    return {
      workspaces: wsElements.map((w) => ({
        name:
          typeof w === "object" && w !== null
            ? ((w as Record<string, unknown>).name as string | undefined)
            : undefined,
      })),
    };
  });
}
