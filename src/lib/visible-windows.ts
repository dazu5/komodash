/**
 * Pure helpers for the App Rules "From running apps" tab (issue #25).
 *
 * Komorebi's `komorebic visible-windows` returns a JSON object keyed
 * by monitor identifier:
 *
 * ```json
 * { "MON-A": [{ title, exe, class }, ...], "MON-B": [...] }
 * ```
 *
 * The user doesn't care which monitor a window lives on — they want
 * one flat searchable list. `parseVisibleWindowsResponse` flattens +
 * dedupes; `filterWindows` does the live search filter.
 */

export interface VisibleWindow {
  exe: string;
  class: string;
  title: string;
}

/**
 * Flatten komorebic's monitor-keyed JSON into a single deduped list.
 * Returns `[]` for invalid JSON or non-object top-level shapes.
 *
 * Dedup key: `exe + class + title`. The same window can appear on
 * multiple monitors when it's spanned, but the user is choosing it for
 * a rule, not a workspace assignment, so monitor identity is irrelevant.
 */
export function parseVisibleWindowsResponse(json: string): VisibleWindow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return [];
  }

  const seen = new Set<string>();
  const out: VisibleWindow[] = [];
  for (const value of Object.values(parsed)) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (
        typeof entry !== "object" ||
        entry === null ||
        typeof (entry as Record<string, unknown>).exe !== "string" ||
        typeof (entry as Record<string, unknown>).class !== "string" ||
        typeof (entry as Record<string, unknown>).title !== "string"
      ) {
        continue;
      }
      const w = entry as VisibleWindow;
      const key = `${w.exe}|${w.class}|${w.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ exe: w.exe, class: w.class, title: w.title });
    }
  }
  return out;
}

/**
 * Live-search filter — case-insensitive substring match against any
 * of `exe`, `class`, or `title`. Empty / whitespace-only query passes
 * everything through.
 */
export function filterWindows(
  windows: VisibleWindow[],
  query: string,
): VisibleWindow[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === "") return windows;
  return windows.filter(
    (w) =>
      w.exe.toLowerCase().includes(trimmed) ||
      w.title.toLowerCase().includes(trimmed) ||
      w.class.toLowerCase().includes(trimmed),
  );
}
