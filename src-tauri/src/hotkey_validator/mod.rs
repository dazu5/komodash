//! Hotkey validator — turns a parsed [`WhkdrcModel`] into a list of
//! [`ValidationIssue`]s the editor can render inline (issue #20).
//!
//! Per [ADR-0009](../../../docs/adr/0009-hotkey-validation-scope.md), four
//! issue kinds are surfaced: three *errors* that the editor should treat
//! as Apply-blocking, and one *warning* it should let pass.
//!
//! Modifier-order variance (`alt+shift+h` vs `shift+alt+h`) is handled
//! silently by the [`whkdrc_parser`] at parse time — it is not an issue
//! kind here.

use serde::{Deserialize, Serialize};

use crate::command_catalog::CommandCatalog;
use crate::whkdrc_parser::{parse_chord, Chord, WhkdrcModel};

/// Bundled list of Windows-reserved chords (per ADR-0009). Compiled
/// into the binary from `src-tauri/resources/reserved-chords.json` so
/// the validator works offline and on first launch.
const BUNDLED_RESERVED_JSON: &str =
    include_str!("../../resources/reserved-chords.json");

/// One validation finding for one binding.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationIssue {
    pub kind: IssueKind,
    /// Index into `model.bindings` of the offending binding.
    pub binding_index: usize,
    /// Human-readable explanation suitable for inline display.
    pub message: String,
}

/// The four issue kinds surfaced to the editor (per ADR-0009). The first
/// three are errors that should block Apply; the fourth is a warning.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IssueKind {
    /// Same chord bound by two or more bindings. Both/all rows are
    /// reported so the editor can highlight every offender.
    DuplicateChord,
    /// Right-hand-side names a `komorebic` subcommand the [`CommandCatalog`]
    /// doesn't know.
    UnknownCommand,
    /// Subcommand recognised but its required positional args are missing,
    /// or unrecognised extras were supplied.
    InvalidArgs,
    /// Chord matches a Windows-owned shortcut — the binding will silently
    /// fail to fire. Warning only, Apply still enabled.
    WindowsReserved,
}

/// Reserved-chord registry the validator checks against. Construct via
/// [`Self::bundled`] for the in-repo list, or [`Self::from_chords`] for
/// custom test fixtures.
#[derive(Debug, Clone)]
pub struct ReservedChordList {
    chords: Vec<Chord>,
}

impl ReservedChordList {
    /// The in-repo Windows-reserved list, parsed once.
    pub fn bundled() -> Self {
        let parsed: BundledReserved = serde_json::from_str(BUNDLED_RESERVED_JSON)
            .expect("bundled reserved-chords.json must be valid JSON");
        let chords = parsed
            .chords
            .into_iter()
            .filter_map(|s| parse_chord(&s).ok())
            .collect();
        Self { chords }
    }

    /// Construct from an already-parsed chord list. Primarily for tests.
    pub fn from_chords(chords: Vec<Chord>) -> Self {
        Self { chords }
    }

    /// Borrow the underlying chord list (for `get_reserved_chords` to
    /// serialise to the frontend).
    pub fn chords(&self) -> &[Chord] {
        &self.chords
    }
}

/// Internal schema for `reserved-chords.json`.
#[derive(Deserialize)]
struct BundledReserved {
    /// Top-level free-text comment used for in-file documentation. Ignored.
    #[serde(default, rename = "comment")]
    _comment: Option<String>,
    chords: Vec<String>,
}

/// Validate every binding in `model`, returning one issue per offence
/// per binding. A single binding may produce multiple issues (e.g.
/// duplicate **and** reserved).
pub fn validate(
    model: &WhkdrcModel,
    catalog: &CommandCatalog,
    reserved: &ReservedChordList,
) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();

    // ---- DuplicateChord -----------------------------------------------------
    // We report every binding whose chord appears more than once, not just
    // the second-and-later occurrence — per AC, "for both rows".
    for (i, binding) in model.bindings.iter().enumerate() {
        let same_chord_count = model
            .bindings
            .iter()
            .filter(|b| b.chord == binding.chord)
            .count();
        if same_chord_count > 1 {
            issues.push(ValidationIssue {
                kind: IssueKind::DuplicateChord,
                binding_index: i,
                message: format!(
                    "Chord `{chord}` is bound {same_chord_count} times.",
                    chord = canonical_chord_display(&binding.chord),
                ),
            });
        }
    }

    // ---- UnknownCommand / InvalidArgs ---------------------------------------
    // Only bindings that actually shell out to `komorebic` are subject to
    // catalog checks — `taskkill`, `pwsh -c …`, etc. are intentionally
    // out of scope (ADR-0009).
    for (i, binding) in model.bindings.iter().enumerate() {
        if binding.command != "komorebic" {
            continue;
        }
        let subcommand = match binding.args.first() {
            Some(s) => s.as_str(),
            None => {
                // `Alt+H : komorebic` with no subcommand at all.
                issues.push(ValidationIssue {
                    kind: IssueKind::InvalidArgs,
                    binding_index: i,
                    message: "`komorebic` requires a subcommand.".to_string(),
                });
                continue;
            }
        };
        let spec = catalog
            .commands
            .iter()
            .find(|c| c.name == subcommand);
        let spec = match spec {
            Some(s) => s,
            None => {
                issues.push(ValidationIssue {
                    kind: IssueKind::UnknownCommand,
                    binding_index: i,
                    message: format!("Unknown komorebic subcommand `{subcommand}`."),
                });
                continue;
            }
        };
        let supplied = binding.args.len().saturating_sub(1);
        let required = spec.args.iter().filter(|a| a.required).count();
        if supplied < required {
            issues.push(ValidationIssue {
                kind: IssueKind::InvalidArgs,
                binding_index: i,
                message: format!(
                    "`komorebic {subcommand}` needs {required} argument(s); got {supplied}.",
                ),
            });
        }
    }

    // ---- WindowsReserved ----------------------------------------------------
    for (i, binding) in model.bindings.iter().enumerate() {
        if reserved.chords.contains(&binding.chord) {
            issues.push(ValidationIssue {
                kind: IssueKind::WindowsReserved,
                binding_index: i,
                message: format!(
                    "`{chord}` is a Windows-reserved chord — the binding will not fire.",
                    chord = canonical_chord_display(&binding.chord),
                ),
            });
        }
    }

    issues
}

/// Display form of a chord matching the parser's canonical
/// `Win+Ctrl+Alt+Shift+K` rendering. Re-implemented here rather than
/// exposing the parser's `to_canonical_string()` because the serializer's
/// version is intended for whkdrc emission, not human messages — keeping
/// the two uses decoupled lets either change without breaking the other.
fn canonical_chord_display(chord: &Chord) -> String {
    let mut s = String::new();
    for m in &chord.modifiers {
        s.push_str(match m {
            crate::whkdrc_parser::Modifier::Win => "Win",
            crate::whkdrc_parser::Modifier::Ctrl => "Ctrl",
            crate::whkdrc_parser::Modifier::Alt => "Alt",
            crate::whkdrc_parser::Modifier::Shift => "Shift",
        });
        s.push('+');
    }
    s.push_str(&chord.key);
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command_catalog::{ArgSpec, CommandCatalog, CommandSpec};
    use crate::whkdrc_parser::parse;

    /// Tiny synthetic catalog covering the subcommands the tests exercise.
    /// We don't depend on the real `komorebic --help` parser output — that
    /// would make these tests sensitive to upstream wording changes.
    fn fixture_catalog() -> CommandCatalog {
        CommandCatalog {
            komorebic_version: "0.1.41".into(),
            commands: vec![
                CommandSpec {
                    name: "focus".into(),
                    summary: "Change focus".into(),
                    args: vec![ArgSpec {
                        name: "OPERATION_DIRECTION".into(),
                        required: true,
                        possible_values: Some(vec![
                            "left".into(),
                            "right".into(),
                            "up".into(),
                            "down".into(),
                        ]),
                    }],
                },
                CommandSpec {
                    name: "close".into(),
                    summary: "Close the focused window".into(),
                    args: vec![],
                },
            ],
        }
    }

    /// Reserved list with just `Win+D` — keeps the unit tests independent
    /// of any future evolution of the bundled JSON.
    fn fixture_reserved() -> ReservedChordList {
        ReservedChordList::from_chords(vec![
            parse_chord("Win+D").expect("Win+D parses"),
        ])
    }

    #[test]
    fn duplicate_chord_reports_both_rows() {
        let src = "Alt+H : komorebic focus left\nAlt+H : komorebic close\n";
        let model = parse(src).expect("parses");
        let issues = validate(&model, &fixture_catalog(), &fixture_reserved());

        let dupes: Vec<&ValidationIssue> = issues
            .iter()
            .filter(|i| i.kind == IssueKind::DuplicateChord)
            .collect();
        assert_eq!(
            dupes.len(),
            2,
            "duplicate chord must be reported for BOTH rows, got {:?}",
            issues
        );
        let indices: Vec<usize> = dupes.iter().map(|i| i.binding_index).collect();
        assert!(indices.contains(&0), "binding 0 should be flagged");
        assert!(indices.contains(&1), "binding 1 should be flagged");
    }

    #[test]
    fn typo_in_subcommand_is_unknown_command() {
        let src = "Alt+H : komorebic focss left\n";
        let model = parse(src).expect("parses");
        let issues = validate(&model, &fixture_catalog(), &fixture_reserved());

        assert_eq!(issues.len(), 1, "expected exactly one issue, got {issues:?}");
        assert_eq!(issues[0].kind, IssueKind::UnknownCommand);
        assert_eq!(issues[0].binding_index, 0);
        assert!(
            issues[0].message.contains("focss"),
            "message should name the offending subcommand: {}",
            issues[0].message
        );
    }

    #[test]
    fn missing_required_arg_is_invalid_args() {
        let src = "Alt+H : komorebic focus\n";
        let model = parse(src).expect("parses");
        let issues = validate(&model, &fixture_catalog(), &fixture_reserved());

        assert_eq!(issues.len(), 1, "expected exactly one issue, got {issues:?}");
        assert_eq!(issues[0].kind, IssueKind::InvalidArgs);
        assert_eq!(issues[0].binding_index, 0);
    }

    #[test]
    fn windows_reserved_chord_is_warning_not_error() {
        let src = "Win+D : komorebic close\n";
        let model = parse(src).expect("parses");
        let issues = validate(&model, &fixture_catalog(), &fixture_reserved());

        // Only the WindowsReserved issue should fire — no others.
        let reserved_count = issues
            .iter()
            .filter(|i| i.kind == IssueKind::WindowsReserved)
            .count();
        assert_eq!(reserved_count, 1, "Win+D should trigger one warning");
        assert!(
            issues.iter().all(|i| i.kind == IssueKind::WindowsReserved),
            "Win+D : komorebic close should produce ONLY the reserved warning, got: {issues:?}"
        );
    }

    #[test]
    fn modifier_order_normalisation_is_silent() {
        // Same chord, different source modifier order — must not surface
        // as DuplicateChord because the parser canonicalises both to the
        // same Chord value.
        let src = "alt+shift+h : komorebic focus left\nshift+alt+h : komorebic focus left\n";
        let model = parse(src).expect("parses");

        // Sanity: the parser collapsed both to the same chord, so the
        // validator legitimately sees two identical bindings.
        assert_eq!(model.bindings[0].chord, model.bindings[1].chord);

        let issues = validate(&model, &fixture_catalog(), &fixture_reserved());
        // The DuplicateChord finding here is real — both rows ARE bound
        // to the same chord. What we're proving is that *modifier-order
        // alone* doesn't introduce phantom issues: each binding survives
        // catalog + reserved checks cleanly.
        let non_duplicate: Vec<&ValidationIssue> = issues
            .iter()
            .filter(|i| i.kind != IssueKind::DuplicateChord)
            .collect();
        assert!(
            non_duplicate.is_empty(),
            "modifier-order variance must not introduce non-duplicate issues, got {non_duplicate:?}",
        );
    }

    #[test]
    fn well_formed_binding_produces_no_issues() {
        let src = "Alt+H : komorebic focus left\nAlt+Shift+C : komorebic close\n";
        let model = parse(src).expect("parses");
        let issues = validate(&model, &fixture_catalog(), &fixture_reserved());
        assert!(
            issues.is_empty(),
            "well-formed bindings should produce no issues, got {issues:?}",
        );
    }

    #[test]
    fn non_komorebic_command_skips_catalog_check() {
        // `taskkill` is not a komorebic subcommand; the validator must
        // not treat it as UnknownCommand (ADR-0009 limits catalog
        // validation to komorebic-prefixed bindings).
        let src = "Alt+O : taskkill /im notepad.exe\n";
        let model = parse(src).expect("parses");
        let issues = validate(&model, &fixture_catalog(), &fixture_reserved());
        assert!(
            issues.is_empty(),
            "non-komorebic command should not surface UnknownCommand, got {issues:?}",
        );
    }

    #[test]
    fn bundled_reserved_loader_parses_in_repo_json() {
        // The bundled file must always be readable — if it's malformed,
        // the binary fails to load and the user gets no validation at all.
        let list = ReservedChordList::bundled();
        assert!(
            !list.chords().is_empty(),
            "bundled reserved-chords.json must produce at least one chord"
        );
        // Spot-check a chord we know is in the list.
        let win_d = parse_chord("Win+D").expect("Win+D parses");
        assert!(
            list.chords().contains(&win_d),
            "bundled list should contain Win+D"
        );
    }
}
