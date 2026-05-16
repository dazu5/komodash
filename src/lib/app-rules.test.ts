import { describe, expect, it } from "vitest";

import {
  flattenRules,
  insertRule,
  removeRule,
  type StaticConfigRulesView,
} from "./app-rules";

describe("flattenRules", () => {
  it("returns an empty array when no rule arrays are present", () => {
    expect(flattenRules({})).toEqual([]);
  });

  it("returns one entry per rule across all five rule arrays", () => {
    const config: StaticConfigRulesView = {
      ignore_rules: [
        { kind: "Exe", id: "ignored.exe", matching_strategy: "Equals" },
      ],
      floating_applications: [
        { kind: "Exe", id: "komodash.exe", matching_strategy: "Equals" },
      ],
      manage_rules: [
        { kind: "Class", id: "ManagedClass", matching_strategy: "Equals" },
      ],
      workspace_rules: [
        {
          kind: "Exe",
          id: "slack.exe",
          matching_strategy: "Equals",
          workspace: 2,
        },
      ],
    };

    const rules = flattenRules(config);

    expect(rules).toHaveLength(4);
    expect(rules).toContainEqual({
      kind: "ignore",
      identifierKind: "Exe",
      id: "ignored.exe",
      matchingStrategy: "Equals",
    });
    expect(rules).toContainEqual({
      kind: "float",
      identifierKind: "Exe",
      id: "komodash.exe",
      matchingStrategy: "Equals",
    });
    expect(rules).toContainEqual({
      kind: "manage",
      identifierKind: "Class",
      id: "ManagedClass",
      matchingStrategy: "Equals",
    });
    expect(rules).toContainEqual({
      kind: "workspace",
      identifierKind: "Exe",
      id: "slack.exe",
      matchingStrategy: "Equals",
      workspace: 2,
    });
  });
});

describe("insertRule", () => {
  it("appends an ignore rule into ignore_rules without mutating input", () => {
    const config = { ignore_rules: [] };
    const updated = insertRule(config, {
      kind: "ignore",
      identifierKind: "Exe",
      id: "notepad.exe",
      matchingStrategy: "Equals",
    });
    expect(updated.ignore_rules).toEqual([
      { kind: "Exe", id: "notepad.exe", matching_strategy: "Equals" },
    ]);
    // Input must not be mutated.
    expect(config.ignore_rules).toEqual([]);
  });

  it("appends a workspace rule with the workspace index into workspace_rules", () => {
    const updated = insertRule(
      {},
      {
        kind: "workspace",
        identifierKind: "Exe",
        id: "slack.exe",
        matchingStrategy: "Equals",
        workspace: 3,
      },
    );
    expect(updated.workspace_rules).toEqual([
      {
        kind: "Exe",
        id: "slack.exe",
        matching_strategy: "Equals",
        workspace: 3,
      },
    ]);
  });

  it("routes float rules to floating_applications and manage rules to manage_rules", () => {
    const withFloat = insertRule(
      {},
      {
        kind: "float",
        identifierKind: "Class",
        id: "Calculator",
        matchingStrategy: "Equals",
      },
    );
    expect(withFloat.floating_applications).toHaveLength(1);

    const withManage = insertRule(
      {},
      {
        kind: "manage",
        identifierKind: "Exe",
        id: "claude.exe",
        matchingStrategy: "Equals",
      },
    );
    expect(withManage.manage_rules).toHaveLength(1);
  });

  it("throws when a workspace rule omits the workspace index", () => {
    expect(() =>
      insertRule(
        {},
        {
          kind: "workspace",
          identifierKind: "Exe",
          id: "slack.exe",
          matchingStrategy: "Equals",
        } as never,
      ),
    ).toThrow(/workspace/);
  });
});

describe("removeRule", () => {
  it("strips a matching ignore rule from ignore_rules", () => {
    const config = {
      ignore_rules: [
        { kind: "Exe" as const, id: "notepad.exe", matching_strategy: "Equals" as const },
        { kind: "Exe" as const, id: "calc.exe", matching_strategy: "Equals" as const },
      ],
    };
    const updated = removeRule(config, {
      kind: "ignore",
      identifierKind: "Exe",
      id: "notepad.exe",
      matchingStrategy: "Equals",
    });
    expect(updated.ignore_rules).toEqual([
      { kind: "Exe", id: "calc.exe", matching_strategy: "Equals" },
    ]);
    // Original input untouched.
    expect(config.ignore_rules).toHaveLength(2);
  });

  it("is a no-op when no entry matches the rule's identity", () => {
    const config = {
      floating_applications: [
        { kind: "Exe" as const, id: "komodash.exe", matching_strategy: "Equals" as const },
      ],
    };
    const updated = removeRule(config, {
      kind: "float",
      identifierKind: "Exe",
      id: "different.exe",
      matchingStrategy: "Equals",
    });
    expect(updated.floating_applications).toEqual(config.floating_applications);
  });

  it("removes a workspace rule by identity (kind + id + identifierKind + workspace)", () => {
    const config = {
      workspace_rules: [
        { kind: "Exe" as const, id: "slack.exe", matching_strategy: "Equals" as const, workspace: 2 },
        { kind: "Exe" as const, id: "slack.exe", matching_strategy: "Equals" as const, workspace: 5 },
      ],
    };
    const updated = removeRule(config, {
      kind: "workspace",
      identifierKind: "Exe",
      id: "slack.exe",
      matchingStrategy: "Equals",
      workspace: 2,
    });
    expect(updated.workspace_rules).toEqual([
      { kind: "Exe", id: "slack.exe", matching_strategy: "Equals", workspace: 5 },
    ]);
  });
});
