import { describe, expect, it } from "vitest";

import { entryToRules, parseCatalog, searchCatalog } from "./community-catalog";

describe("parseCatalog", () => {
  it("returns an empty array for invalid JSON or non-object top-level shapes", () => {
    expect(parseCatalog("not json")).toEqual([]);
    expect(parseCatalog("[]")).toEqual([]);
    expect(parseCatalog("null")).toEqual([]);
    expect(parseCatalog('"a string"')).toEqual([]);
  });

  it("returns one entry per top-level app key, skipping the $schema marker", () => {
    const json = JSON.stringify({
      $schema: "https://example.com/schema.json",
      "1Password": {
        ignore: [
          { kind: "Exe", id: "1Password.exe", matching_strategy: "Equals" },
        ],
      },
      Discord: {
        float: [
          { kind: "Exe", id: "Discord.exe", matching_strategy: "Equals" },
        ],
      },
    });

    const entries = parseCatalog(json);

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.name).sort()).toEqual(["1Password", "Discord"]);
  });
});

describe("searchCatalog", () => {
  it("filters entries by case-insensitive substring of the app name", () => {
    const entries = [
      { name: "Discord", rules: {} },
      { name: "Slack", rules: {} },
      { name: "Adobe Photoshop", rules: {} },
      { name: "Adobe Premiere Pro", rules: {} },
    ];

    expect(searchCatalog(entries, "disc").map((e) => e.name)).toEqual([
      "Discord",
    ]);
    expect(
      searchCatalog(entries, "ADOBE")
        .map((e) => e.name)
        .sort(),
    ).toEqual(["Adobe Photoshop", "Adobe Premiere Pro"]);
  });

  it("returns all entries when the query is empty or whitespace", () => {
    const entries = [
      { name: "Discord", rules: {} },
      { name: "Slack", rules: {} },
    ];
    expect(searchCatalog(entries, "")).toEqual(entries);
    expect(searchCatalog(entries, "   ")).toEqual(entries);
  });
});

describe("entryToRules", () => {
  it("converts an `ignore` array to one ignore AppRule per entry", () => {
    const rules = entryToRules({
      name: "1Password",
      rules: {
        ignore: [
          { kind: "Exe", id: "1Password.exe", matching_strategy: "Equals" },
        ],
      },
    });
    expect(rules).toEqual([
      {
        kind: "ignore",
        identifierKind: "Exe",
        id: "1Password.exe",
        matchingStrategy: "Equals",
      },
    ]);
  });

  it("handles all five catalog rule arrays (ignore, float, manage, workspace, tray_and_multi_window)", () => {
    const rules = entryToRules({
      name: "Mixed",
      rules: {
        ignore: [
          { kind: "Exe", id: "ig.exe", matching_strategy: "Equals" },
        ],
        float: [
          { kind: "Exe", id: "fl.exe", matching_strategy: "Equals" },
        ],
        manage: [
          { kind: "Class", id: "MgClass", matching_strategy: "Equals" },
        ],
        workspace: [
          { kind: "Exe", id: "ws.exe", matching_strategy: "Equals", workspace: 2 },
        ],
        tray_and_multi_window: [
          { kind: "Class", id: "TrayClass", matching_strategy: "Equals" },
        ],
      },
    });

    // tray_and_multi_window maps to the closest existing AppRule kind:
    // we treat it as `manage` per ADR-0005's "one flat list" simplification.
    expect(rules.map((r) => r.kind).sort()).toEqual(
      ["float", "ignore", "manage", "manage", "workspace"].sort(),
    );
    expect(rules.find((r) => r.id === "ws.exe")).toMatchObject({
      kind: "workspace",
      workspace: 2,
    });
  });

  it("skips nested-array AND-grouped rules (deferred to v2)", () => {
    const rules = entryToRules({
      name: "Ableton Live",
      rules: {
        ignore: [
          { kind: "Class", id: "AbletonVstPlugClass", matching_strategy: "Legacy" },
          [
            { kind: "Class", id: "Ableton Live Window Class", matching_strategy: "Equals" },
            { kind: "Title", id: "Ableton", matching_strategy: "DoesNotContain" },
          ],
        ],
      },
    });
    // Only the standalone rule survives; the AND group is dropped.
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe("AbletonVstPlugClass");
  });
});
