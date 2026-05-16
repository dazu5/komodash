/**
 * Pure helpers for the Workspaces editor (issue #64).
 *
 * Komorebi's static config models per-monitor workspace lists as
 * `monitors: MonitorConfig[]`, where each MonitorConfig requires a
 * `workspaces: WorkspaceConfig[]` array. Each WorkspaceConfig has a
 * required `name: string` and an optional `layout` drawn from the
 * `DefaultLayout` enum (BSP, Columns, Rows, etc.).
 *
 * This module manipulates that shape immutably. It treats monitor and
 * workspace entries as opaque records — every untouched field is
 * preserved verbatim — so the editor can never strip fields it
 * doesn't render (per the same principle that drove the bar editor's
 * merged-save fix in #56).
 *
 * Tests import from here directly. No Tauri, no React.
 */

import type { JsonSchema } from "@/api/schema";

export type RawMonitor = Record<string, unknown>;
export type RawWorkspace = Record<string, unknown>;

/**
 * Built-in layout list, used when the live schema doesn't ship a
 * `DefaultLayout` definition (older Komorebi versions, or a stripped
 * cache). Matches the enum Komorebi has shipped since 0.1.x.
 */
const FALLBACK_LAYOUTS = [
  "BSP",
  "Columns",
  "Rows",
  "VerticalStack",
  "HorizontalStack",
  "UltrawideVerticalStack",
  "Grid",
];

/**
 * Read the `DefaultLayout` enum values out of the static-config schema.
 * Komorebi emits this as a `oneOf` of `{type: "string", const: "..."}`
 * entries under `$defs.DefaultLayout`. The dropdown reads from here so
 * it auto-extends when Komorebi adds a new layout, without a Komodash
 * release.
 */
export function extractLayoutOptions(schema: JsonSchema): string[] {
  const def = schema.$defs?.["DefaultLayout"] ?? schema.definitions?.["DefaultLayout"];
  if (!def || !Array.isArray(def.oneOf)) return FALLBACK_LAYOUTS;
  const out: string[] = [];
  for (const entry of def.oneOf) {
    const c = (entry as { const?: unknown }).const;
    if (typeof c === "string") out.push(c);
  }
  return out.length > 0 ? out : FALLBACK_LAYOUTS;
}

/**
 * Normalize the static config's top-level `monitors` value into a
 * well-typed array. Missing / null / wrong-shape inputs collapse to
 * `[]` so the UI can iterate without guards.
 */
export function parseMonitors(value: unknown): RawMonitor[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

/**
 * Pull the workspaces array off a monitor record, normalising
 * non-record entries out. The schema declares `workspaces` as
 * required, but legacy or hand-edited configs may have it missing /
 * wrong-typed — fall back to `[]` so the UI can still render the
 * monitor tab.
 */
export function parseWorkspaces(monitor: RawMonitor): RawWorkspace[] {
  const ws = monitor.workspaces;
  if (!Array.isArray(ws)) return [];
  return ws.filter(isRecord);
}

/**
 * Append a fresh workspace to the named monitor. The new workspace
 * gets a unique default name (`Workspace N`, where N is the next
 * available 1-based index that isn't already used) and the BSP
 * layout. Returns a new array; the input is untouched. Out-of-range
 * monitor indices are a no-op so the caller doesn't need a guard.
 */
export function addWorkspace(
  monitors: RawMonitor[],
  monitorIdx: number,
): RawMonitor[] {
  if (monitorIdx < 0 || monitorIdx >= monitors.length) return monitors;
  return monitors.map((m, i) => {
    if (i !== monitorIdx) return m;
    const workspaces = parseWorkspaces(m);
    return {
      ...m,
      workspaces: [...workspaces, defaultWorkspace(workspaces.length + 1)],
    };
  });
}

/**
 * Remove the workspace at the given coordinate. Out-of-range indices
 * are no-ops. Sibling workspaces and unrelated monitor fields are
 * preserved verbatim.
 */
export function removeWorkspace(
  monitors: RawMonitor[],
  monitorIdx: number,
  workspaceIdx: number,
): RawMonitor[] {
  if (monitorIdx < 0 || monitorIdx >= monitors.length) return monitors;
  return monitors.map((m, i) => {
    if (i !== monitorIdx) return m;
    const workspaces = parseWorkspaces(m);
    if (workspaceIdx < 0 || workspaceIdx >= workspaces.length) return m;
    return {
      ...m,
      workspaces: workspaces.filter((_, j) => j !== workspaceIdx),
    };
  });
}

/**
 * Patch a single field on the workspace at `(monitorIdx, workspaceIdx)`.
 * Out-of-range coordinates are no-ops. Other fields on the workspace
 * record (and on every sibling) are preserved verbatim, so editing
 * "name" can't strip the user's `container_padding` or any other
 * config the widget doesn't render.
 */
export function updateWorkspaceField(
  monitors: RawMonitor[],
  monitorIdx: number,
  workspaceIdx: number,
  field: string,
  value: unknown,
): RawMonitor[] {
  if (monitorIdx < 0 || monitorIdx >= monitors.length) return monitors;
  return monitors.map((m, i) => {
    if (i !== monitorIdx) return m;
    const workspaces = parseWorkspaces(m);
    if (workspaceIdx < 0 || workspaceIdx >= workspaces.length) return m;
    return {
      ...m,
      workspaces: workspaces.map((w, j) =>
        j === workspaceIdx ? { ...w, [field]: value } : w,
      ),
    };
  });
}

/**
 * Bootstrap a fresh `monitors` array — one entry per detected
 * monitor, each with one default workspace. Used by the "Create
 * explicit monitors config" affordance when the user has no
 * `monitors` field at all (Komorebi's anonymous-defaults mode).
 */
export function createMonitors(count: number): RawMonitor[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, () => ({
    workspaces: [defaultWorkspace(1)],
  }));
}

function defaultWorkspace(oneBasedIndex: number): RawWorkspace {
  return { name: `Workspace ${oneBasedIndex}`, layout: "BSP" };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
