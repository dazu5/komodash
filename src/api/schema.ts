import { invoke } from "@tauri-apps/api/core";

/**
 * The Komorebi static-config JSON Schema, as emitted by
 * `komorebic static-config-schema`. We don't enumerate every shape draft-07
 * supports — only the fragments the `<SchemaEditor>` consults. Anything we
 * don't recognise renders with the schema's `title` / `description` as a
 * generic input (or the catalog overlay if there is one).
 */
export interface JsonSchema {
  $schema?: string;
  title?: string;
  description?: string;
  type?: JsonSchemaType | JsonSchemaType[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema | JsonSchema[];
  enum?: unknown[];
  format?: string;
  default?: unknown;
  /** Komorebi's schema uses `$ref` heavily for shared subschemas. */
  $ref?: string;
  /** And `definitions` to hold the targets of those `$ref`s. */
  definitions?: Record<string, JsonSchema>;
  /** Newer draft uses `$defs` instead of `definitions`. */
  $defs?: Record<string, JsonSchema>;
  /** Composition keywords — we surface anyOf alternatives if present. */
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  /** Carry-through for fields we don't model. The renderer ignores them. */
  [key: string]: unknown;
}

export type JsonSchemaType =
  | "object"
  | "array"
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "null";

/**
 * Fetch the cached Komorebi static-config JSON Schema. Backed by the
 * in-process schema cache (issue #11) — the first call shells out to
 * `komorebic static-config-schema`; subsequent calls during the same
 * session return cached bytes unless the Komorebi version changes.
 *
 * Returns the parsed schema. The Rust side hands us raw JSON text to
 * preserve field order across the bridge — we parse it once on this
 * side and feed the typed value to `<SchemaEditor>`.
 */
export async function getSchema(): Promise<JsonSchema> {
  const raw = await invoke<string>("get_schema");
  return JSON.parse(raw) as JsonSchema;
}
