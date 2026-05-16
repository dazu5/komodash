import { describe, expect, it } from "vitest";

import { buildSendToWorkspaceItems } from "./window-context-menu";

describe("buildSendToWorkspaceItems", () => {
  it("flattens (monitor, workspace) pairs into a single submenu list", () => {
    const monitors = [
      {
        workspaces: [
          { name: "I" },
          { name: "II" },
          { name: "III" },
        ],
      },
      {
        workspaces: [
          { name: "I" },
          { name: "II" },
        ],
      },
    ];
    const items = buildSendToWorkspaceItems(monitors);
    expect(items).toHaveLength(5);
    expect(items[0]).toMatchObject({ monitor: 0, workspace: 0, label: "Monitor 1 · I" });
    expect(items[1]).toMatchObject({ monitor: 0, workspace: 1, label: "Monitor 1 · II" });
    expect(items[3]).toMatchObject({ monitor: 1, workspace: 0, label: "Monitor 2 · I" });
  });

  it("uses the workspace index as the label when name is missing", () => {
    const monitors = [{ workspaces: [{}, {}] }];
    const items = buildSendToWorkspaceItems(monitors as never);
    expect(items[0].label).toBe("Monitor 1 · 1");
    expect(items[1].label).toBe("Monitor 1 · 2");
  });

  it("returns an empty list when there are no monitors or no workspaces", () => {
    expect(buildSendToWorkspaceItems([])).toEqual([]);
    expect(buildSendToWorkspaceItems([{ workspaces: [] }])).toEqual([]);
  });
});
