//! The **Field catalog** overlay (per [ADR-0004]).
//!
//! [ADR-0004]: ../../../docs/adr/0004-field-catalog-overlay.md
//!
//! Komodash bundles a curated overlay JSON that supplies human labels,
//! descriptions, section assignments, and widget hints for the Komorebi
//! `static-config-schema` fields the **End user** is most likely to
//! touch. The catalog is *additive* — every field outside it still
//! renders, just into an "Other" section using raw schema metadata.
//!
//! This module deserialises the bundled JSON into typed Rust values so
//! the frontend gets a stable shape via Tauri's serde bridge.

use serde::{Deserialize, Serialize};

/// Bundled JSON for the Static-config overlay, compiled into the binary.
const BUNDLED_JSON: &str = include_str!("../../resources/field-catalog.json");

/// Bundled JSON for the Bar-config overlay, compiled into the binary
/// (issue #19). Same shape; different field paths and sections so the
/// Static catalog and the Bar catalog can grow independently.
const BUNDLED_BAR_JSON: &str = include_str!("../../resources/bar-catalog.json");


/// The full Field catalog: the sections list plus per-field overlays.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FieldCatalog {
    pub sections: Vec<SectionSpec>,
    /// Keyed by the schema path: top-level field name (e.g. `border`,
    /// `mouse_follows_focus`). Nested-path support is reserved for future
    /// catalog growth — the renderer only consults this map for top-level
    /// fields in v1.
    pub fields: std::collections::BTreeMap<String, FieldOverlay>,
}

/// A logical group of fields shown together in the editor's left sidebar
/// and inline as a header.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SectionSpec {
    /// Stable id used by [`FieldOverlay::section`] to refer back.
    pub id: String,
    /// Human-readable label shown in the sidebar / header.
    pub label: String,
    /// Sort order — lower numbers float higher.
    pub order: i32,
}

/// Per-field metadata overlay.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FieldOverlay {
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
    /// Id of the [`SectionSpec`] this field belongs to. Fields whose
    /// section is missing from the sections list render under "Other".
    pub section: String,
    /// Renderer hint: which widget to use. Values match `src/components/
    /// schema-editor/widgets.tsx`. Free-form strings rather than a Rust
    /// enum so the catalog can add new widget kinds without a backend
    /// release.
    #[serde(default)]
    pub widget: Option<String>,
    /// When `true`, the SchemaEditor drops this field entirely (issue
    /// #78). Used for upstream-deprecated fields and arrays that have
    /// a dedicated editor elsewhere (App Rules) so hand-editing can't
    /// corrupt parallel surfaces.
    #[serde(default)]
    pub hidden: bool,
}

impl FieldCatalog {
    /// The in-binary bundled catalog for the Static configuration,
    /// parsed once on first call.
    pub fn bundled() -> Self {
        serde_json::from_str::<FieldCatalogFile>(BUNDLED_JSON)
            .expect("bundled field-catalog.json must parse")
            .into_catalog()
    }

    /// The in-binary bundled catalog for the Bar configuration
    /// (issue #19). Different fields and sections from the Static
    /// catalog, same shape so the editor renderer is agnostic.
    pub fn bundled_bar() -> Self {
        serde_json::from_str::<FieldCatalogFile>(BUNDLED_BAR_JSON)
            .expect("bundled bar-catalog.json must parse")
            .into_catalog()
    }
}

/// On-disk shape — has the `$comment` field at the top that we ignore.
/// Kept distinct from [`FieldCatalog`] so the public type is free of
/// JSON-file-only baggage.
#[derive(Deserialize)]
struct FieldCatalogFile {
    #[serde(default, rename = "$comment")]
    _comment: Option<String>,
    sections: Vec<SectionSpec>,
    fields: std::collections::BTreeMap<String, FieldOverlay>,
}

impl FieldCatalogFile {
    fn into_catalog(self) -> FieldCatalog {
        FieldCatalog {
            sections: self.sections,
            fields: self.fields,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_json_parses() {
        let catalog = FieldCatalog::bundled();
        assert!(
            catalog.sections.len() >= 5,
            "expected at least 5 sections, got {}",
            catalog.sections.len()
        );
        assert!(
            catalog.fields.len() >= 20,
            "issue #11 AC requires ≥20 field overlays; got {}",
            catalog.fields.len()
        );
    }

    #[test]
    fn each_field_references_a_real_section() {
        let catalog = FieldCatalog::bundled();
        let section_ids: std::collections::HashSet<&str> =
            catalog.sections.iter().map(|s| s.id.as_str()).collect();
        for (field_path, overlay) in &catalog.fields {
            assert!(
                section_ids.contains(overlay.section.as_str()),
                "field {field_path:?} references unknown section {:?}",
                overlay.section
            );
        }
    }

    #[test]
    fn sections_are_unique_by_id() {
        let catalog = FieldCatalog::bundled();
        let ids: std::collections::HashSet<&str> =
            catalog.sections.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(
            ids.len(),
            catalog.sections.len(),
            "section ids must be unique"
        );
    }

    #[test]
    fn bundled_bar_json_parses() {
        let catalog = FieldCatalog::bundled_bar();
        assert!(
            catalog.sections.len() >= 3,
            "expected at least 3 bar sections, got {}",
            catalog.sections.len()
        );
        assert!(
            catalog.fields.len() >= 5,
            "expected at least 5 bar field overlays, got {}",
            catalog.fields.len()
        );
        // Spot-check: the multi-monitor placement field must be there —
        // it's the headline reason we built #19.
        assert!(
            catalog.fields.contains_key("monitor"),
            "bar catalog must define 'monitor' (the multi-monitor field)"
        );
    }

    #[test]
    fn bar_catalog_sections_are_internally_consistent() {
        let catalog = FieldCatalog::bundled_bar();
        let section_ids: std::collections::HashSet<&str> =
            catalog.sections.iter().map(|s| s.id.as_str()).collect();
        for (path, overlay) in &catalog.fields {
            assert!(
                section_ids.contains(overlay.section.as_str()),
                "bar field {path:?} references unknown section {:?}",
                overlay.section
            );
        }
    }

    #[test]
    fn deprecated_and_app_rules_fields_are_hidden() {
        // Per #78: fields upstream-deprecated by komorebi, and arrays
        // owned by the App Rules page, must carry `hidden: true` in
        // the catalog. The SchemaEditor refuses to render them so the
        // user can't corrupt parallel editing surfaces or discover
        // dead-end deprecated knobs.
        let catalog = FieldCatalog::bundled();
        let must_be_hidden = [
            // Deprecated upstream
            "border_z_order",
            "focus_follows_mouse",
            "invisible_borders",
            // App Rules-owned
            "ignore_rules",
            "floating_applications",
            "manage_rules",
            "layered_applications",
            "object_name_change_applications",
            "tray_and_multi_window_applications",
            "remove_titlebar_applications",
            "slow_application_identifiers",
            "transparency_ignore_rules",
            "border_overflow_applications",
        ];
        for field in must_be_hidden {
            let overlay = catalog
                .fields
                .get(field)
                .unwrap_or_else(|| panic!("field {field:?} missing from catalog"));
            assert!(
                overlay.hidden,
                "field {field:?} must be hidden — see #78"
            );
        }
    }

    #[test]
    fn no_dead_applications_overlay() {
        // Regression for #79: the catalog used to declare an
        // `applications` overlay, but the Komorebi static-config schema
        // has no top-level field by that name (it's `floating_applications`,
        // `manage_rules`, etc., individually). The orphan entry pointed
        // at a widget key that was never registered, confusing readers.
        let catalog = FieldCatalog::bundled();
        assert!(
            !catalog.fields.contains_key("applications"),
            "field-catalog.json must not declare an 'applications' overlay — \
             the schema has no such field, the entry is dead"
        );
    }

    #[test]
    fn families_required_by_issue_11_are_present() {
        // The issue body explicitly names these as the seed coverage.
        let catalog = FieldCatalog::bundled();
        for required in [
            "border",
            "animation",
            "default_workspace_padding",
            "default_container_padding",
            "default_layout",
            "mouse_follows_focus",
            "cross_monitor_move_behaviour",
            "unmanaged_window_operation_behaviour",
            "window_hiding_behaviour",
            "bar_configurations",
        ] {
            assert!(
                catalog.fields.contains_key(required),
                "field {required:?} is required by issue #11 AC but is missing from the catalog"
            );
        }
    }
}
