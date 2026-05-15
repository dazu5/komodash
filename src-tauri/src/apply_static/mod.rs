//! Live-apply of the Static configuration (issue #18, per ADR-0006).
//!
//! Sits between the Tauri command layer and the Komorebic shell-out.
//! Translates Komorebi's stderr into plain-English **friendly** messages
//! the editor renders inline under the offending field; the **raw** text
//! is kept alongside so a curious **Power user** can copy the original.

use std::path::Path;

use serde::Serialize;

use crate::komorebic::Komorebic;

/// What [`apply`] returns on failure. Carries both a translated message
/// for the inline error UI and the raw stderr for debugging.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ApplyError {
    /// Plain-English explanation suitable for an inline red error.
    pub friendly: String,
    /// The original stderr/error text. Surfaced via the diagnostic-info
    /// blob (issue #10) so support requests carry the verbatim message.
    pub raw: String,
}

/// Invoke `komorebic replace-configuration <path>` and surface a
/// frontend-friendly error on failure.
///
/// Success: returns `Ok(())`. The caller should show a brief "saved"
/// toast at the top of the page.
///
/// Failure: returns `Err(ApplyError)`. The caller keeps the bad value
/// in the **Working buffer** and renders `error.friendly` under the
/// offending field. The file on disk is unchanged by this function —
/// the write step happens separately in the live-apply flow.
pub fn apply(client: &dyn Komorebic, path: &Path) -> Result<(), ApplyError> {
    match client.replace_configuration(path) {
        Ok(()) => Ok(()),
        Err(err) => {
            let raw = err.to_string();
            Err(ApplyError {
                friendly: translate(&raw),
                raw,
            })
        }
    }
}

/// Map a Komorebic stderr line to a friendlier sentence. The mapping is
/// intentionally narrow — we only translate strings whose pattern we've
/// seen verbatim from Komorebi. Anything outside the list passes through
/// unchanged: a **Power user** prefers the original message over a
/// poorly-fitting paraphrase.
fn translate(raw: &str) -> String {
    let lowered = raw.to_ascii_lowercase();

    // JSON parse errors from serde_json typically read:
    //   "expected `,` or `}` at line 12 column 5"
    //   "EOF while parsing a value at line 1 column 0"
    if lowered.contains("expected") && lowered.contains("line") {
        return format!(
            "The configuration isn't valid JSON yet — Komorebi reported: {}",
            first_line(raw)
        );
    }
    if lowered.contains("eof while parsing") {
        return "The configuration is missing a closing brace or bracket.".into();
    }
    // schemars / serde-derived validation:
    //   "additionalProperty 'foo' is not allowed"
    if lowered.contains("additionalproperty") || lowered.contains("additional property") {
        return format!("Unknown field rejected by Komorebi: {}", first_line(raw));
    }
    if lowered.contains("invalid type") || lowered.contains("expected one of") {
        return format!(
            "A field has the wrong type or an unsupported value: {}",
            first_line(raw)
        );
    }
    // Path errors
    if lowered.contains("no such file") || lowered.contains("not found") {
        return "Komorebi couldn't find the configuration file on disk.".into();
    }
    // Komorebi not running — the pipe used to talk to the daemon is absent.
    if lowered.contains("could not connect") || lowered.contains("pipe") {
        return "Komorebi isn't running, so it couldn't reload the config.".into();
    }

    // Unknown — pass the raw message through so it's at least visible.
    first_line(raw).to_string()
}

/// Trim Komorebic's multi-line errors to one line for the inline display.
/// The raw text is still carried in [`ApplyError::raw`] for the full chain.
fn first_line(s: &str) -> &str {
    s.lines().next().unwrap_or("").trim()
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::path::PathBuf;

    use super::*;
    use crate::komorebic::{Komorebic, KomorebicInfo};

    /// Fake whose `replace_configuration` returns whatever the test sets.
    struct FakeKomorebic {
        result: Cell<Option<anyhow::Error>>,
    }

    impl FakeKomorebic {
        fn ok() -> Self {
            Self {
                result: Cell::new(None),
            }
        }
        fn err(message: &str) -> Self {
            Self {
                result: Cell::new(Some(anyhow::anyhow!("{}", message))),
            }
        }
    }

    // SAFETY: single-threaded tests.
    unsafe impl Sync for FakeKomorebic {}

    impl Komorebic for FakeKomorebic {
        fn discover(&self) -> Option<KomorebicInfo> {
            None
        }
        fn is_running(&self) -> bool {
            true
        }
        fn replace_configuration(&self, _path: &Path) -> anyhow::Result<()> {
            match self.result.take() {
                None => Ok(()),
                Some(e) => Err(e),
            }
        }
    }

    #[test]
    fn ok_when_replace_succeeds() {
        let fake = FakeKomorebic::ok();
        let got = apply(&fake, &PathBuf::from("C:/komorebi.json"));
        assert!(got.is_ok(), "expected Ok, got {got:?}");
    }

    #[test]
    fn translates_json_parse_error() {
        let fake = FakeKomorebic::err("expected `,` or `}` at line 12 column 5");
        let err = apply(&fake, &PathBuf::from("C:/komorebi.json")).unwrap_err();
        assert!(
            err.friendly.to_ascii_lowercase().contains("isn't valid json"),
            "friendly message should explain JSON, got: {:?}",
            err.friendly
        );
        assert!(
            err.raw.contains("line 12 column 5"),
            "raw text should be preserved, got: {:?}",
            err.raw
        );
    }

    #[test]
    fn translates_eof_error() {
        let fake = FakeKomorebic::err("EOF while parsing a value at line 1 column 0");
        let err = apply(&fake, &PathBuf::from("C:/komorebi.json")).unwrap_err();
        assert!(
            err.friendly.to_ascii_lowercase().contains("missing a closing brace"),
            "EOF should map to missing-brace, got: {:?}",
            err.friendly
        );
    }

    #[test]
    fn translates_unknown_field() {
        let fake = FakeKomorebic::err(
            "additionalProperty 'completelyBogusField' is not allowed in the schema",
        );
        let err = apply(&fake, &PathBuf::from("C:/komorebi.json")).unwrap_err();
        assert!(
            err.friendly
                .to_ascii_lowercase()
                .contains("unknown field rejected"),
            "additional-property should map to unknown field, got: {:?}",
            err.friendly
        );
    }

    #[test]
    fn translates_invalid_type() {
        let fake = FakeKomorebic::err("invalid type: string \"yes\", expected a boolean");
        let err = apply(&fake, &PathBuf::from("C:/komorebi.json")).unwrap_err();
        assert!(
            err.friendly
                .to_ascii_lowercase()
                .contains("wrong type"),
            "invalid-type should map to wrong-type message, got: {:?}",
            err.friendly
        );
    }

    #[test]
    fn translates_pipe_error_as_not_running() {
        let fake = FakeKomorebic::err("could not connect to named pipe \\\\.\\pipe\\komorebi");
        let err = apply(&fake, &PathBuf::from("C:/komorebi.json")).unwrap_err();
        assert!(
            err.friendly
                .to_ascii_lowercase()
                .contains("komorebi isn't running"),
            "pipe-error should map to not-running, got: {:?}",
            err.friendly
        );
    }

    #[test]
    fn passes_through_unknown_error_unchanged() {
        let fake = FakeKomorebic::err("xyz unanticipated failure mode");
        let err = apply(&fake, &PathBuf::from("C:/komorebi.json")).unwrap_err();
        assert!(
            err.friendly.contains("xyz unanticipated failure mode"),
            "unknown error should pass through verbatim, got: {:?}",
            err.friendly
        );
    }

    #[test]
    fn raw_field_preserves_full_error_chain() {
        // anyhow renders multi-line context chains with `: ` separators
        // when sourced from .context() — we don't have one here, but
        // first_line still trims to the first line for the friendly view
        // while raw keeps everything.
        let fake = FakeKomorebic::err("first failure\nsecond cause");
        let err = apply(&fake, &PathBuf::from("C:/komorebi.json")).unwrap_err();
        assert!(
            err.raw.contains("second cause"),
            "raw should keep the full multi-line chain, got: {:?}",
            err.raw
        );
        assert!(
            !err.friendly.contains("second cause"),
            "friendly should trim to one line, got: {:?}",
            err.friendly
        );
    }
}
