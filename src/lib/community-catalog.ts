import type { AppRule } from "./app-rules";

/**
 * Community-catalog (`applications.json`) parsing + search + conversion
 * for issue #24.
 *
 * Komorebi maintains a community-contributed `applications.json` whose
 * shape is `{ "<App Name>": { ignore?: [...], float?: [...], ... } }`.
 * The catalog is downloaded by `komorebic fetch-app-specific-configuration`
 * and stored next to the user's home dir (or wherever
 * `app_specific_configuration_path` in the static config points).
 *
 * Per ADR-0005 the catalog is read-only — Komodash's job is to surface
 * entries for one-click import into the user's static-config rule
 * arrays. The conversion is lossy by design (we drop nested-array AND
 * groups for v1; they're rare and re-add later).
 */

/** One catalog entry — an app name + its raw rule arrays. */
export interface CommunityCatalogEntry {
  name: string;
  rules: CommunityRuleArrays;
}

/**
 * Raw rule arrays from the catalog. Each array entry is either a single
 * rule object OR a nested array of rules (AND-grouped). We keep the raw
 * shape here so downstream conversion can decide how to handle the
 * AND-grouped variant.
 */
export interface CommunityRuleArrays {
  ignore?: CatalogRuleNode[];
  float?: CatalogRuleNode[];
  manage?: CatalogRuleNode[];
  workspace?: CatalogRuleNode[];
  tray_and_multi_window?: CatalogRuleNode[];
}

/** One node in a catalog rule array — either a rule or an AND-group. */
export type CatalogRuleNode = CatalogRule | CatalogRule[];

export interface CatalogRule {
  kind: string;
  id: string;
  matching_strategy: string;
  workspace?: number;
}

/**
 * Parse a catalog JSON string. Returns `[]` for invalid JSON or non-object
 * top-level shapes. The conventional `$schema` key is filtered out.
 */
export function parseCatalog(json: string): CommunityCatalogEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return [];
  }
  const out: CommunityCatalogEntry[] = [];
  for (const [name, value] of Object.entries(parsed)) {
    if (name.startsWith("$")) continue;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }
    out.push({ name, rules: value as CommunityRuleArrays });
  }
  return out;
}

/**
 * Filter catalog entries by case-insensitive substring match against
 * the app name. Empty / whitespace-only query returns all entries.
 */
export function searchCatalog(
  entries: CommunityCatalogEntry[],
  query: string,
): CommunityCatalogEntry[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === "") return entries;
  return entries.filter((e) => e.name.toLowerCase().includes(trimmed));
}

/**
 * Convert one catalog entry to a flat list of AppRules ready for
 * insertion via [`insertRule`]. AND-grouped (nested-array) rules are
 * skipped — supporting them needs a richer rule model than v1's flat
 * AppRule shape; tracked as a v2 follow-up.
 *
 * `tray_and_multi_window` collapses to `manage` per ADR-0005's "one
 * flat list" simplification (Komorebi treats both as window-management
 * directives; the user-facing distinction isn't worth a dedicated
 * RuleKind for v1).
 */
export function entryToRules(entry: CommunityCatalogEntry): AppRule[] {
  const out: AppRule[] = [];

  for (const node of entry.rules.ignore ?? []) {
    if (Array.isArray(node)) continue;
    out.push(toAppRule("ignore", node));
  }
  for (const node of entry.rules.float ?? []) {
    if (Array.isArray(node)) continue;
    out.push(toAppRule("float", node));
  }
  for (const node of entry.rules.manage ?? []) {
    if (Array.isArray(node)) continue;
    out.push(toAppRule("manage", node));
  }
  for (const node of entry.rules.workspace ?? []) {
    if (Array.isArray(node)) continue;
    const rule: AppRule = {
      kind: "workspace",
      identifierKind: node.kind as AppRule["identifierKind"],
      id: node.id,
      matchingStrategy: node.matching_strategy as AppRule["matchingStrategy"],
      workspace: node.workspace ?? 0,
    };
    out.push(rule);
  }
  for (const node of entry.rules.tray_and_multi_window ?? []) {
    if (Array.isArray(node)) continue;
    out.push(toAppRule("manage", node));
  }

  return out;
}

function toAppRule(kind: AppRule["kind"], rule: CatalogRule): AppRule {
  return {
    kind,
    identifierKind: rule.kind as AppRule["identifierKind"],
    id: rule.id,
    matchingStrategy: rule.matching_strategy as AppRule["matchingStrategy"],
  };
}
