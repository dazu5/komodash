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

/// Bundled JSON, compiled into the binary.
const BUNDLED_JSON: &str = include_str!("../../resources/field-catalog.json");

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
}

impl FieldCatalog {
    /// The in-binary bundled catalog, parsed once on first call.
    pub fn bundled() -> Self {
        serde_json::from_str::<FieldCatalogFile>(BUNDLED_JSON)
            .expect("bundled field-catalog.json must parse")
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
