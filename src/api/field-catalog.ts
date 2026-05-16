import { invoke } from "@tauri-apps/api/core";

/** A logical group of fields in the schema editor (per ADR-0004). */
export interface SectionSpec {
  id: string;
  label: string;
  order: number;
}

/** Per-field overlay metadata. */
export interface FieldOverlay {
  label: string;
  description?: string | null;
  /** ID of the matching `SectionSpec`. Fields whose section is absent
   *  from the sections list fall through to the "Other" group. */
  section: string;
  /** Renderer hint — see widget keys in `components/schema-editor`. */
  widget?: string | null;
  /** When `true`, the SchemaEditor drops this field entirely (issue
   *  #78). Used for upstream-deprecated fields and arrays that have
   *  a dedicated editor elsewhere (e.g. App Rules) so the user can't
   *  corrupt parallel surfaces by hand-editing the JSON. */
  hidden?: boolean;
}

/** The bundled Field catalog overlay. */
export interface FieldCatalog {
  sections: SectionSpec[];
  /** Keyed by top-level schema field name. */
  fields: Record<string, FieldOverlay>;
}

/**
 * Fetch the bundled Field-catalog overlay (issue #11, per ADR-0004).
 * The Rust side ships this in the binary, so the call is effectively
 * free — no I/O, no version dependency.
 */
export async function getFieldCatalog(): Promise<FieldCatalog> {
  return invoke<FieldCatalog>("get_field_catalog");
}
