import { useMemo } from "react";

import type { FieldCatalog, FieldOverlay, SectionSpec } from "@/api/field-catalog";
import type { JsonSchema } from "@/api/schema";
import { cn } from "@/lib/utils";

import { pickWidget, type WidgetKey } from "./widget-picker";
import {
  ArrayPreview,
  BooleanWidget,
  EnumWidget,
  NumberWidget,
  ObjectPreview,
  StringWidget,
  UnknownWidget,
} from "./widgets";

/**
 * The schema-driven configuration editor (issue #11, per ADR-0002 + ADR-0004).
 *
 * Walks the top-level fields of a JSON Schema, applies the Field-catalog
 * overlay where present (label, description, section, widget hint), and
 * groups the result into sections defined by the overlay. Fields whose
 * top-level schema entry has no overlay fall through to an "Other"
 * section at the bottom with the raw schema title/description.
 *
 * Widget selection priority (per ADR-0004):
 *   1. `overlay.widget` if the catalog supplies one
 *   2. schema `format` / `enum` hints
 *   3. schema `type` default
 *
 * Read-only mode (`readonly={true}`) renders the same controls but
 * disabled — editing arrives with #18 (Live-apply Static configuration).
 */
export function SchemaEditor({
  schema,
  catalog,
  value,
  readonly,
}: {
  schema: JsonSchema;
  catalog: FieldCatalog;
  value: Record<string, unknown> | null;
  readonly?: boolean;
}) {
  const grouped = useMemo(
    () => groupFieldsBySection(schema, catalog),
    [schema, catalog],
  );

  if (grouped.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Schema has no top-level fields to render.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {grouped.map((g) => (
        <SectionBlock
          key={g.section.id}
          section={g.section}
          fields={g.fields}
          value={value}
          readonly={readonly ?? false}
        />
      ))}
    </div>
  );
}

// ---- section block ---------------------------------------------------------

function SectionBlock({
  section,
  fields,
  value,
  readonly,
}: {
  section: SectionSpec;
  fields: GroupedField[];
  value: Record<string, unknown> | null;
  readonly: boolean;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="border-b border-border bg-secondary/40 px-4 py-2">
        <h2 className="text-sm font-medium">{section.label}</h2>
      </header>
      <ul className="divide-y divide-border">
        {fields.map((f) => (
          <FieldRow
            key={f.name}
            field={f}
            value={value?.[f.name]}
            readonly={readonly}
          />
        ))}
      </ul>
    </section>
  );
}

// ---- one field -------------------------------------------------------------

function FieldRow({
  field,
  value,
  readonly,
}: {
  field: GroupedField;
  value: unknown;
  readonly: boolean;
}) {
  const widget = pickWidget(field.schema, field.overlay);
  const label =
    field.overlay?.label ?? field.schema.title ?? humanise(field.name);
  const description =
    field.overlay?.description ?? field.schema.description ?? null;

  return (
    <li className="grid grid-cols-1 md:grid-cols-[12rem_1fr] gap-2 md:gap-6 px-4 py-3">
      <div className="space-y-0.5">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground font-mono">
          {field.name}
        </div>
      </div>
      <div className="space-y-1.5">
        <FieldWidget widget={widget} value={value} readonly={readonly} />
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </li>
  );
}

function FieldWidget({
  widget,
  value,
  readonly,
}: {
  widget: WidgetKey;
  value: unknown;
  readonly: boolean;
}) {
  switch (widget) {
    case "checkbox":
      return (
        <BooleanWidget
          value={typeof value === "boolean" ? value : false}
          readonly={readonly}
        />
      );
    case "number":
      return (
        <NumberWidget
          value={typeof value === "number" ? value : undefined}
          readonly={readonly}
        />
      );
    case "select":
      return (
        <EnumWidget value={value} readonly={readonly} options={[]} />
      );
    case "string":
      return (
        <StringWidget
          value={typeof value === "string" ? value : ""}
          readonly={readonly}
        />
      );
    case "array":
      return <ArrayPreview value={Array.isArray(value) ? value : []} />;
    case "object":
      return <ObjectPreview value={isObject(value) ? value : null} />;
    case "unknown":
    default:
      return <UnknownWidget value={value} />;
  }
}

// ---- grouping --------------------------------------------------------------

interface GroupedField {
  name: string;
  schema: JsonSchema;
  overlay: FieldOverlay | null;
}

interface GroupedSection {
  section: SectionSpec;
  fields: GroupedField[];
}

/**
 * Place every top-level schema field into either an overlay-defined
 * section or the synthesised "Other" section. Sections render in
 * `order` ascending; "Other" always last.
 */
function groupFieldsBySection(
  schema: JsonSchema,
  catalog: FieldCatalog,
): GroupedSection[] {
  const props = schema.properties ?? {};
  const sectionById = new Map(catalog.sections.map((s) => [s.id, s]));
  const buckets = new Map<string, GroupedField[]>();
  const OTHER_ID = "__other__";

  for (const [name, fieldSchema] of Object.entries(props)) {
    const overlay = catalog.fields[name] ?? null;
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

// ---- helpers ---------------------------------------------------------------

function humanise(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Re-export for convenience.
export { cn };
