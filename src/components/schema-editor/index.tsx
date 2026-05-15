import { useMemo } from "react";

import type { ApplyError } from "@/api/apply";
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
 * The schema-driven configuration editor (issues #11 + #18).
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
 * In editable mode (`readonly={false}`), supply `onFieldChange` — it
 * fires per change and the parent's working-buffer hook does the
 * debounce + apply. `error` surfaces the last apply failure inline.
 */
export function SchemaEditor({
  schema,
  catalog,
  value,
  readonly,
  onFieldChange,
  error,
}: {
  schema: JsonSchema;
  catalog: FieldCatalog;
  value: Record<string, unknown> | null;
  readonly?: boolean;
  /** Required when `readonly !== true`. Called per top-level field
   *  change with the next value for that field. */
  onFieldChange?: (key: string, next: unknown) => void;
  /** If set, surfaces an inline red note at the top of the editor.
   *  Komorebi's error doesn't carry a JSON Pointer to the offending
   *  field, so #18 shows it at the top of the page rather than under
   *  a specific row. */
  error?: ApplyError | null;
}) {
  const grouped = useMemo(
    () => groupFieldsBySection(schema, catalog),
    [schema, catalog],
  );
  const ro = readonly ?? false;

  if (grouped.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Schema has no top-level fields to render.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && <ErrorBanner error={error} />}
      {grouped.map((g) => (
        <SectionBlock
          key={g.section.id}
          section={g.section}
          fields={g.fields}
          value={value}
          readonly={ro}
          onFieldChange={onFieldChange}
        />
      ))}
    </div>
  );
}

// ---- error banner ----------------------------------------------------------

function ErrorBanner({ error }: { error: ApplyError }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <div className="font-medium">Komorebi rejected the last change</div>
      <div className="mt-0.5 text-xs">{error.friendly}</div>
    </div>
  );
}

// ---- section block ---------------------------------------------------------

function SectionBlock({
  section,
  fields,
  value,
  readonly,
  onFieldChange,
}: {
  section: SectionSpec;
  fields: GroupedField[];
  value: Record<string, unknown> | null;
  readonly: boolean;
  onFieldChange?: (key: string, next: unknown) => void;
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
            onChange={
              onFieldChange ? (next) => onFieldChange(f.name, next) : undefined
            }
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
  onChange,
}: {
  field: GroupedField;
  value: unknown;
  readonly: boolean;
  onChange?: (next: unknown) => void;
}) {
  const widget = pickWidget(field.schema, field.overlay);
  const label =
    field.overlay?.label ?? field.schema.title ?? humanise(field.name);
  const description =
    field.overlay?.description ?? field.schema.description ?? null;
  const enumValues = pickEnumValues(field.schema);

  return (
    <li className="grid grid-cols-1 md:grid-cols-[12rem_1fr] gap-2 md:gap-6 px-4 py-3">
      <div className="space-y-0.5">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground font-mono">
          {field.name}
        </div>
      </div>
      <div className="space-y-1.5">
        <FieldWidget
          widget={widget}
          value={value}
          readonly={readonly}
          onChange={onChange}
          enumValues={enumValues}
        />
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
  onChange,
  enumValues,
}: {
  widget: WidgetKey;
  value: unknown;
  readonly: boolean;
  onChange?: (next: unknown) => void;
  enumValues: string[];
}) {
  switch (widget) {
    case "checkbox":
      return (
        <BooleanWidget
          value={typeof value === "boolean" ? value : false}
          readonly={readonly}
          onChange={onChange}
        />
      );
    case "number":
      return (
        <NumberWidget
          value={typeof value === "number" ? value : undefined}
          readonly={readonly}
          onChange={onChange}
        />
      );
    case "select":
      return (
        <EnumWidget
          value={value}
          readonly={readonly}
          options={enumValues}
          onChange={onChange}
        />
      );
    case "string":
      return (
        <StringWidget
          value={typeof value === "string" ? value : ""}
          readonly={readonly}
          onChange={onChange}
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

function pickEnumValues(schema: JsonSchema): string[] {
  if (!Array.isArray(schema.enum)) return [];
  return schema.enum.filter((v): v is string => typeof v === "string");
}

// ---- helpers ---------------------------------------------------------------

function humanise(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export { cn };
