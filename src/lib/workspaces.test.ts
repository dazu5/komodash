import { describe, expect, it } from "vitest";

import type { JsonSchema } from "@/api/schema";

import {
  addWorkspace,
  createMonitors,
  extractLayoutOptions,
  parseMonitors,
  parseWorkspaces,
  removeWorkspace,
  updateWorkspaceField,
  type RawWorkspace,
} from "./workspaces";

describe("parseMonitors", () => {
  it("returns an empty array when the value is undefined", () => {
    expect(parseMonitors(undefined)).toEqual([]);
  });

  it("keeps record-shaped entries and drops anything that isn't an object", () => {
    const value = [
      { workspaces: [{ name: "Web" }] },
      null,
      42,
      "garbage",
      [1, 2, 3],
      { workspaces: [] },
    ];
    expect(parseMonitors(value)).toEqual([
      { workspaces: [{ name: "Web" }] },
      { workspaces: [] },
    ]);
  });
});

describe("parseWorkspaces", () => {
  it("returns the workspaces array from a monitor record", () => {
    const monitor = {
      workspaces: [
        { name: "Web", layout: "BSP" },
        { name: "Chat" },
      ],
    };
    expect(parseWorkspaces(monitor)).toEqual([
      { name: "Web", layout: "BSP" },
      { name: "Chat" },
    ]);
  });

  it("returns an empty array when workspaces is missing or malformed", () => {
    expect(parseWorkspaces({})).toEqual([]);
    expect(parseWorkspaces({ workspaces: "nope" })).toEqual([]);
    expect(parseWorkspaces({ workspaces: [null, { name: "OK" }, 7] })).toEqual([
      { name: "OK" },
    ]);
  });
});

describe("extractLayoutOptions", () => {
  it("returns the DefaultLayout enum values from $defs.oneOf consts", () => {
    const schema: JsonSchema = {
      $defs: {
        DefaultLayout: {
          oneOf: [
            { type: "string", const: "BSP" },
            { type: "string", const: "Columns" },
            { type: "string", const: "Rows" },
            { type: "string", const: "VerticalStack" },
            { type: "string", const: "HorizontalStack" },
            { type: "string", const: "UltrawideVerticalStack" },
            { type: "string", const: "Grid" },
          ],
        },
      },
    };
    expect(extractLayoutOptions(schema)).toEqual([
      "BSP",
      "Columns",
      "Rows",
      "VerticalStack",
      "HorizontalStack",
      "UltrawideVerticalStack",
      "Grid",
    ]);
  });

  it("falls back to a built-in list when the schema doesn't define DefaultLayout", () => {
    expect(extractLayoutOptions({})).toContain("BSP");
    expect(extractLayoutOptions({}).length).toBeGreaterThan(0);
  });
});

describe("addWorkspace", () => {
  it("appends a fresh workspace to the named monitor and preserves unrelated fields", () => {
    const monitors = [
      {
        workspaces: [{ name: "Web", layout: "BSP" }],
        wallpaper: { kind: "Solid", color: "#000" },
      },
      { workspaces: [] },
    ];
    const next = addWorkspace(monitors, 0);
    expect(next).not.toBe(monitors);
    expect(next[0]).not.toBe(monitors[0]);
    expect(next[0].workspaces).toHaveLength(2);
    expect((next[0].workspaces as unknown[])[0]).toEqual({
      name: "Web",
      layout: "BSP",
    });
    expect((next[0].workspaces as unknown[])[1]).toEqual({
      name: "Workspace 2",
      layout: "BSP",
    });
    expect(next[0].wallpaper).toEqual({ kind: "Solid", color: "#000" });
    expect(next[1]).toEqual({ workspaces: [] });
  });

  it("returns the same shape when the monitorIdx is out of range", () => {
    const monitors = [{ workspaces: [] }];
    expect(addWorkspace(monitors, 5)).toEqual(monitors);
  });
});

describe("removeWorkspace", () => {
  it("removes the workspace at (monitorIdx, workspaceIdx) and preserves siblings", () => {
    const monitors = [
      {
        workspaces: [
          { name: "Web" },
          { name: "Chat" },
          { name: "Mail" },
        ],
        wallpaper: { kind: "Solid" },
      },
    ];
    const next = removeWorkspace(monitors, 0, 1);
    expect(next[0].workspaces).toEqual([{ name: "Web" }, { name: "Mail" }]);
    expect(next[0].wallpaper).toEqual({ kind: "Solid" });
  });

  it("is a no-op when either index is out of range", () => {
    const monitors = [{ workspaces: [{ name: "Web" }] }];
    expect(removeWorkspace(monitors, 0, 5)).toEqual(monitors);
    expect(removeWorkspace(monitors, 9, 0)).toEqual(monitors);
  });
});

describe("updateWorkspaceField", () => {
  it("patches the named field on the targeted workspace and preserves other keys", () => {
    const monitors = [
      {
        workspaces: [
          { name: "Web", layout: "BSP", container_padding: 4 },
          { name: "Chat", layout: "Columns" },
        ],
      },
    ];
    const next = updateWorkspaceField(monitors, 0, 0, "name", "Browser");
    expect((next[0].workspaces as RawWorkspace[])[0]).toEqual({
      name: "Browser",
      layout: "BSP",
      container_padding: 4,
    });
    expect((next[0].workspaces as RawWorkspace[])[1]).toEqual({
      name: "Chat",
      layout: "Columns",
    });
  });

  it("is a no-op when the target doesn't exist", () => {
    const monitors = [{ workspaces: [{ name: "Web" }] }];
    expect(updateWorkspaceField(monitors, 0, 9, "name", "X")).toEqual(monitors);
    expect(updateWorkspaceField(monitors, 9, 0, "name", "X")).toEqual(monitors);
  });
});

describe("createMonitors", () => {
  it("seeds N monitors each with one default workspace", () => {
    const monitors = createMonitors(2);
    expect(monitors).toHaveLength(2);
    expect(monitors[0].workspaces).toEqual([
      { name: "Workspace 1", layout: "BSP" },
    ]);
    expect(monitors[1].workspaces).toEqual([
      { name: "Workspace 1", layout: "BSP" },
    ]);
  });

  it("returns an empty array for zero or negative counts", () => {
    expect(createMonitors(0)).toEqual([]);
    expect(createMonitors(-3)).toEqual([]);
  });
});
