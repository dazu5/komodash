import type { FieldCatalog, FieldOverlay, SectionSpec } from "@/api/field-catalog";
import type { JsonSchema } from "@/api/schema";

/**
 * One field that survived overlay filtering, paired with its schema
 * entry and (optional) catalog overlay. Consumed by the SchemaEditor
 * to render a row.
 */
export interface GroupedField {
  name: string;
  schema: JsonSchema;
  overlay: FieldOverlay | null;
}

export interface GroupedSection {
  section: SectionSpec;
  fields: GroupedField[];
}

const OTHER_ID = "__other__";

/**
 * Group a schema's top-level fields by their catalog section.
 *
 * - Fields whose overlay has `hidden: true` are dropped entirely
 *   (issue #78). This is how App Rules-owned arrays and upstream
 *   deprecated fields stay out of the Configuration form view —
 *   they exist in the schema but Komodash refuses to render them so
 *   the user can't corrupt parallel editing surfaces.
 * - Fields without an overlay, or whose overlay points at an unknown
 *   section, fall into the "Other" bucket so they remain visible
 *   even without curation.
 * - Sections are emitted in catalog order; "Other" always lands last.
 */
export function groupFieldsBySection(
  schema: JsonSchema,
  catalog: FieldCatalog,
): GroupedSection[] {
  const props = schema.properties ?? {};
  const sectionById = new Map(catalog.sections.map((s) => [s.id, s]));
  const buckets = new Map<string, GroupedField[]>();

  for (const [name, fieldSchema] of Object.entries(props)) {
    const overlay = catalog.fields[name] ?? null;
    if (overlay?.hidden === true) continue;
    const sectionId =
      overlay && sectionById.has(overlay.section) ? overlay.section : OTHER_ID;
    const bucket = buckets.get(sectionId) ?? [];
    bucket.push({ name, schema: fieldSchema, overlay });
    buckets.set(sectionId, bucket);
  }

  const out: GroupedSection[] = [];
  const orderedSections = [...catalog.sections].sort(
    (a, b) => a.order - b.order,
  );
  for (const section of orderedSections) {
    const fields = buckets.get(section.id);
    if (fields && fields.length > 0) {
      out.push({ section, fields: sortFields(fields) });
    }
  }
  const others = buckets.get(OTHER_ID);
  if (others && others.length > 0) {
    out.push({
      section: { id: OTHER_ID, label: "Other", order: Number.MAX_SAFE_INTEGER },
      fields: sortFields(others),
    });
  }
  return out;
}

function sortFields(fields: GroupedField[]): GroupedField[] {
  return [...fields].sort((a, b) => a.name.localeCompare(b.name));
}
