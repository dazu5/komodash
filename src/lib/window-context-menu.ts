/**
 * Pure helpers for the Dashboard Window context menu (issue #26).
 *
 * The "Send to workspace ▸" submenu lists every (monitor, workspace)
 * pair across the user's setup. The Live state surfaces this tree;
 * `buildSendToWorkspaceItems` flattens it for the menu.
 */

export interface SendToWorkspaceItem {
  monitor: number;
  workspace: number;
  label: string;
}

interface WorkspaceLike {
  name?: string;
}

interface MonitorLike {
  workspaces?: WorkspaceLike[];
}

/**
 * Flatten the Live state's monitor tree into a single ordered list of
 * (monitor, workspace) submenu entries. Labels follow the pattern
 * `Monitor <m+1> · <workspace.name or index+1>` so the user sees
 * 1-based numbers (which match the Dashboard).
 */
export function buildSendToWorkspaceItems(
  monitors: MonitorLike[],
): SendToWorkspaceItem[] {
  const out: SendToWorkspaceItem[] = [];
  monitors.forEach((monitor, monitorIdx) => {
    const workspaces = monitor.workspaces ?? [];
    workspaces.forEach((ws, wsIdx) => {
      const wsLabel = ws.name && ws.name.length > 0 ? ws.name : String(wsIdx + 1);
      out.push({
        monitor: monitorIdx,
        workspace: wsIdx,
        label: `Monitor ${monitorIdx + 1} · ${wsLabel}`,
      });
    });
  });
  return out;
}
