import type { FieldOverlay } from "@/api/field-catalog";
import type { JsonSchema, JsonSchemaType } from "@/api/schema";

/**
 * The widget kinds the `<SchemaEditor>` can render. Free-form string in
 * the overlay JSON; this enum is the closed set the renderer knows how
 * to handle. New overlay strings fall back to `unknown`.
 */
export type WidgetKey =
  | "checkbox"
  | "number"
  | "select"
  | "string"
  | "array"
  | "object"
  | "unknown";

const KNOWN_WIDGETS: ReadonlySet<WidgetKey> = new Set([
  "checkbox",
  "number",
  "select",
  "string",
  "array",
  "object",
  "unknown",
]);

/**
 * Decide which widget to render for one schema field, applying the
 * priority order from ADR-0004:
 *
 * 1. **Overlay** widget hint if the catalog supplies one *and* the value
 *    is a widget the renderer knows.
 * 2. Schema `enum` → `select`; schema `format` we don't yet act on.
 * 3. Schema `type` default.
 *
 * Falls back to `unknown` for shapes we don't model — the unknown widget
 * shows the raw value so the field is still visible.
 */
export function pickWidget(
  schema: JsonSchema,
  overlay: FieldOverlay | null,
): WidgetKey {
  // 1. Overlay-supplied hint — if it's one we know about.
  if (overlay?.widget && KNOWN_WIDGETS.has(overlay.widget as WidgetKey)) {
    return overlay.widget as WidgetKey;
  }

  // 2. Schema-level hints.
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return "select";
  }

  // 3. Schema type default.
  const type = primaryType(schema);
  switch (type) {
    case "boolean":
      return "checkbox";
    case "integer":
    case "number":
      return "number";
    case "string":
      return "string";
    case "array":
      return "array";
    case "object":
      return "object";
    default:
      return "unknown";
  }
}

/**
 * Pick the first concrete `type` if the schema declares a union.
 * Komorebi's schema occasionally uses `["string", "null"]` for optional
 * fields — we treat that as `string` so the field renders with the
 * obvious widget.
 */
function primaryType(schema: JsonSchema): JsonSchemaType | undefined {
  if (!schema.type) return undefined;
  if (!Array.isArray(schema.type)) return schema.type;
  return schema.type.find((t) => t !== "null") ?? schema.type[0];
}
