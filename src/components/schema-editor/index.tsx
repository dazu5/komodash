import { useMemo } from "react";

import type { ApplyError } from "@/api/apply";
import type { FieldCatalog, SectionSpec } from "@/api/field-catalog";
import type { JsonSchema } from "@/api/schema";
import { cn } from "@/lib/utils";
import { extractAnimationStyles } from "@/lib/animation";
import { extractPaletteNames, type Palette } from "@/lib/theme";
import { extractLayoutOptions } from "@/lib/workspaces";

import {
  groupFieldsBySection,
  type GroupedField,
} from "./group-fields";
import { pickWidget, type WidgetKey } from "./widget-picker";
import {
  AnimationWidget,
  ArrayPreview,
  BooleanWidget,
  BorderColoursWidget,
  EnumWidget,
  JsonValueWidget,
  MonitorPlacementWidget,
  NumberWidget,
  ObjectPreview,
  StringWidget,
  ThemeWidget,
  UnknownWidget,
  WorkspacesWidget,
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
  const layoutOptions = useMemo(() => extractLayoutOptions(schema), [schema]);
  const animationStyles = useMemo(
    () => extractAnimationStyles(schema),
    [schema],
  );
  const themeVariants = useMemo<Record<Palette, string[]>>(
    () => ({
      Catppuccin: extractPaletteNames(schema, "Catppuccin"),
      Base16: extractPaletteNames(schema, "Base16"),
      Custom: [],
    }),
    [schema],
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
          layoutOptions={layoutOptions}
          animationStyles={animationStyles}
          themeVariants={themeVariants}
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
  layoutOptions,
  animationStyles,
  themeVariants,
  onFieldChange,
}: {
  section: SectionSpec;
  fields: GroupedField[];
  value: Record<string, unknown> | null;
  readonly: boolean;
  layoutOptions: string[];
  animationStyles: string[];
  themeVariants: Record<Palette, string[]>;
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
            layoutOptions={layoutOptions}
            animationStyles={animationStyles}
            themeVariants={themeVariants}
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
  layoutOptions,
  animationStyles,
  themeVariants,
  onChange,
}: {
  field: GroupedField;
  value: unknown;
  readonly: boolean;
  layoutOptions: string[];
  animationStyles: string[];
  themeVariants: Record<Palette, string[]>;
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
          layoutOptions={layoutOptions}
          animationStyles={animationStyles}
          themeVariants={themeVariants}
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
  layoutOptions,
  animationStyles,
  themeVariants,
}: {
  widget: WidgetKey;
  value: unknown;
  readonly: boolean;
  onChange?: (next: unknown) => void;
  enumValues: string[];
  layoutOptions: string[];
  animationStyles: string[];
  themeVariants: Record<Palette, string[]>;
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
      // Read-only: keep the compact preview from #11. Editable: fall
      // through to the JSON textarea fallback (#19 stopgap) until we
      // ship a typed nested editor.
      if (readonly) {
        return <ArrayPreview value={Array.isArray(value) ? value : []} />;
      }
      return (
        <JsonValueWidget
          value={value}
          readonly={false}
          expectedKind="array"
          onChange={onChange}
        />
      );
    case "object":
      if (readonly) {
        return <ObjectPreview value={isObject(value) ? value : null} />;
      }
      return (
        <JsonValueWidget
          value={value}
          readonly={false}
          expectedKind="object"
          onChange={onChange}
        />
      );
    case "monitor-placement":
      // Structured editor for the bar's `monitor` field (#19 polish).
      // Read-only just shows the JSON shape since this is rarely
      // shown read-only (it's a bar-only widget today).
      if (readonly) {
        return isObject(value) ? (
          <ObjectPreview value={value} />
        ) : (
          <UnknownWidget value={value} />
        );
      }
      return (
        <MonitorPlacementWidget
          value={value}
          readonly={false}
          onChange={onChange}
        />
      );
    case "animation":
      // Structured editor for the `animation` field (#76).
      return (
        <AnimationWidget
          value={value}
          readonly={readonly}
          animationStyles={animationStyles}
          onChange={onChange}
        />
      );
    case "theme":
      // Palette + variant picker (#77).
      return (
        <ThemeWidget
          value={value}
          readonly={readonly}
          themeVariants={themeVariants}
          onChange={onChange}
        />
      );
    case "border-colours":
      // 6 colour pickers, one per BorderColourState (#75).
      return (
        <BorderColoursWidget
          value={value}
          readonly={readonly}
          onChange={onChange}
        />
      );
    case "workspaces":
      // Structured editor for monitors[].workspaces[] (#64). Even
      // in read-only mode, render the structured view — but the
      // widget itself disables the inputs.
      return (
        <WorkspacesWidget
          value={value}
          readonly={readonly}
          layoutOptions={layoutOptions}
          onChange={onChange}
        />
      );
    case "json":
      // Freeform JSON — for anyOf unions where the top-level kind
      // varies (integer | object | null etc.). No kind check.
      if (readonly) {
        return isObject(value) ? (
          <ObjectPreview value={value} />
        ) : (
          <UnknownWidget value={value} />
        );
      }
      return (
        <JsonValueWidget
          value={value}
          readonly={false}
          expectedKind="any"
          onChange={onChange}
        />
      );
    case "unknown":
    default:
      return <UnknownWidget value={value} />;
  }
}

// ---- grouping --------------------------------------------------------------
// `groupFieldsBySection` lives in [./group-fields.ts] (pure module,
// testable without DOM/React per #78).

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
