/**
 * Pure rule-array helpers for the App Rules editor (issue #22).
 *
 * Komorebi's static config stores app-targeting rules across five top-
 * level arrays (`ignore_rules`, `floating_applications`, `manage_rules`,
 * `workspace_rules`, plus future additions). The App Rules page presents
 * one flat list per ADR-0005, so we need to translate between the
 * on-disk shape and a single `AppRule[]`.
 *
 * Design: pure, immutable, JSON-shaped. Tests import from here directly
 * — no Tauri, no React. Future React work is a thin presentation layer
 * over this module.
 */

export type RuleKind = "ignore" | "float" | "manage" | "workspace";

export type IdentifierKind = "Exe" | "Class" | "Title" | "Path";

export type MatchingStrategy =
  | "Equals"
  | "StartsWith"
  | "EndsWith"
  | "Contains"
  | "Regex";

export interface AppRule {
  kind: RuleKind;
  identifierKind: IdentifierKind;
  id: string;
  matchingStrategy: MatchingStrategy;
  /** Required only when `kind === "workspace"`. */
  workspace?: number;
}

/** Komorebi static config — partial shape covering only the rule arrays. */
export interface StaticConfigRulesView {
  ignore_rules?: KomorebiRuleEntry[];
  floating_applications?: KomorebiRuleEntry[];
  manage_rules?: KomorebiRuleEntry[];
  workspace_rules?: KomorebiWorkspaceRuleEntry[];
}

interface KomorebiRuleEntry {
  kind: IdentifierKind;
  id: string;
  matching_strategy: MatchingStrategy;
}

interface KomorebiWorkspaceRuleEntry extends KomorebiRuleEntry {
  workspace: number;
}

/**
 * Flatten Komorebi's five rule arrays into a single `AppRule[]`. Order
 * is stable and matches the ADR-0005 display order: ignore → float →
 * manage → workspace.
 */
export function flattenRules(config: StaticConfigRulesView): AppRule[] {
  const out: AppRule[] = [];
  for (const entry of config.ignore_rules ?? []) {
    out.push({
      kind: "ignore",
      identifierKind: entry.kind,
      id: entry.id,
      matchingStrategy: entry.matching_strategy,
    });
  }
  for (const entry of config.floating_applications ?? []) {
    out.push({
      kind: "float",
      identifierKind: entry.kind,
      id: entry.id,
      matchingStrategy: entry.matching_strategy,
    });
  }
  for (const entry of config.manage_rules ?? []) {
    out.push({
      kind: "manage",
      identifierKind: entry.kind,
      id: entry.id,
      matchingStrategy: entry.matching_strategy,
    });
  }
  for (const entry of config.workspace_rules ?? []) {
    out.push({
      kind: "workspace",
      identifierKind: entry.kind,
      id: entry.id,
      matchingStrategy: entry.matching_strategy,
      workspace: entry.workspace,
    });
  }
  return out;
}

/**
 * Append a new rule into the appropriate underlying array. Returns a
 * new config object — input is never mutated. Workspace rules require
 * a `workspace` index; throws if absent.
 */
export function insertRule(
  config: StaticConfigRulesView,
  rule: AppRule,
): StaticConfigRulesView {
  const entry: KomorebiRuleEntry = {
    kind: rule.identifierKind,
    id: rule.id,
    matching_strategy: rule.matchingStrategy,
  };
  switch (rule.kind) {
    case "ignore":
      return {
        ...config,
        ignore_rules: [...(config.ignore_rules ?? []), entry],
      };
    case "float":
      return {
        ...config,
        floating_applications: [
          ...(config.floating_applications ?? []),
          entry,
        ],
      };
    case "manage":
      return {
        ...config,
        manage_rules: [...(config.manage_rules ?? []), entry],
      };
    case "workspace": {
      if (typeof rule.workspace !== "number") {
        throw new Error(
          "workspace rules require a `workspace` index — got undefined",
        );
      }
      const workspaceEntry: KomorebiWorkspaceRuleEntry = {
        ...entry,
        workspace: rule.workspace,
      };
      return {
        ...config,
        workspace_rules: [...(config.workspace_rules ?? []), workspaceEntry],
      };
    }
  }
}

/**
 * Strip the matching rule from its underlying array. Identity match
 * uses `identifierKind`, `id`, `matchingStrategy`, and (for workspace
 * rules) `workspace`. Returns a new config; if no entry matches, the
 * relevant array is returned unchanged.
 */
export function removeRule(
  config: StaticConfigRulesView,
  rule: AppRule,
): StaticConfigRulesView {
  const matchesPlain = (entry: KomorebiRuleEntry) =>
    entry.kind === rule.identifierKind &&
    entry.id === rule.id &&
    entry.matching_strategy === rule.matchingStrategy;

  switch (rule.kind) {
    case "ignore":
      return {
        ...config,
        ignore_rules: (config.ignore_rules ?? []).filter(
          (e) => !matchesPlain(e),
        ),
      };
    case "float":
      return {
        ...config,
        floating_applications: (config.floating_applications ?? []).filter(
          (e) => !matchesPlain(e),
        ),
      };
    case "manage":
      return {
        ...config,
        manage_rules: (config.manage_rules ?? []).filter(
          (e) => !matchesPlain(e),
        ),
      };
    case "workspace":
      return {
        ...config,
        workspace_rules: (config.workspace_rules ?? []).filter(
          (e) => !(matchesPlain(e) && e.workspace === rule.workspace),
        ),
      };
  }
}
