//! Pure-logic parser and serializer for the `whkdrc` managed config.
//!
//! Komodash is the **sole writer** of `whkdrc` (see ADR-0003). The parser
//! is tolerant — it accepts mixed-case modifier names, non-canonical
//! modifier order, varying whitespace around `+`, leading `#` comments,
//! and trailing ` # ...` comments on binding lines. The serializer always
//! emits Komodash's canonical form:
//!
//! ```text
//! # Managed by Komodash — manual edits will be overwritten.
//!
//! .shell pwsh
//!
//! Alt+H : komorebic focus left
//! ```
//!
//! whkd does not support chord sequences — one chord per line.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

/// The header comment Komodash emits as the first line of every canonical
/// `whkdrc`. Used to signal to a curious **Power user** that the file is
/// owned by Komodash (per ADR-0003).
pub const CANONICAL_HEADER: &str =
    "# Managed by Komodash — manual edits will be overwritten.";

/// The shell directive Komodash always emits. Per ADR-0003 Komodash
/// owns the file format. We default to `powershell` (Windows
/// PowerShell 5.1) which ships on every Windows install, rather than
/// `pwsh` (PowerShell 7+, separately installable) — see issue #67 for
/// the bug where users without pwsh got silent hotkey failures.
/// Power users can override this in the Hotkey editor when we ship
/// shell-directive editing.
pub const CANONICAL_SHELL: &str = "powershell";

/// A keyboard modifier in a [`Chord`]. Listed in Komodash's canonical
/// order: `Win`, `Ctrl`, `Alt`, `Shift`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Modifier {
    Win,
    Ctrl,
    Alt,
    Shift,
}

impl Modifier {
    /// Parse a single modifier token (case-insensitive). Accepts the
    /// common aliases whkd recognises: `win|super|meta`, `ctrl|control`,
    /// `alt`, `shift`.
    fn parse(token: &str) -> Option<Self> {
        match token.to_ascii_lowercase().as_str() {
            "win" | "super" | "meta" => Some(Modifier::Win),
            "ctrl" | "control" => Some(Modifier::Ctrl),
            "alt" => Some(Modifier::Alt),
            "shift" => Some(Modifier::Shift),
            _ => None,
        }
    }

    /// Canonical lowercase-free spelling for serialization.
    fn as_canonical(self) -> &'static str {
        match self {
            Modifier::Win => "Win",
            Modifier::Ctrl => "Ctrl",
            Modifier::Alt => "Alt",
            Modifier::Shift => "Shift",
        }
    }
}

/// A keyboard chord: zero or more modifiers plus exactly one base key.
///
/// Construction via [`Chord::new`] silently normalises the modifier order
/// (`Win`, `Ctrl`, `Alt`, `Shift`) and uppercases the key, so equality
/// comparisons are independent of how the **End user** typed the chord.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Chord {
    /// Modifiers in canonical order: `Win`, `Ctrl`, `Alt`, `Shift`.
    pub modifiers: Vec<Modifier>,
    /// Single base key, uppercased canonical form (e.g. `H`, `1`, `SPACE`,
    /// `OEM_4`).
    pub key: String,
}

impl Chord {
    /// Construct a [`Chord`], normalising modifier order and key case.
    ///
    /// Duplicate modifiers are de-duplicated. The key is uppercased so
    /// `Chord::new(vec![Modifier::Alt], "h")` and
    /// `Chord::new(vec![Modifier::Alt], "H")` compare equal.
    pub fn new(modifiers: Vec<Modifier>, key: &str) -> Self {
        let mut mods = modifiers;
        mods.sort();
        mods.dedup();
        Self {
            modifiers: mods,
            key: key.to_ascii_uppercase(),
        }
    }

    /// Render to the canonical `Win+Ctrl+Alt+Shift+K` form used by the
    /// serializer.
    fn to_canonical_string(&self) -> String {
        let mut parts: Vec<&str> = self.modifiers.iter().map(|m| m.as_canonical()).collect();
        parts.push(&self.key);
        parts.join("+")
    }
}

/// A single hotkey binding: a [`Chord`] mapped to a command with args.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Binding {
    pub chord: Chord,
    /// The command to run (first whitespace-separated token after `:`).
    pub command: String,
    /// Arguments to `command`, split on whitespace.
    pub args: Vec<String>,
}

/// In-memory representation of a parsed `whkdrc`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct WhkdrcModel {
    /// Value from a `.shell <s>` directive if present. Komodash reads it
    /// but does **not** round-trip it — the serializer always emits
    /// `.shell pwsh` (ADR-0003).
    pub shell: Option<String>,
    /// Paths from `.imports <path>` directives, in source order.
    pub imports: Vec<String>,
    /// Parsed bindings, in source order.
    pub bindings: Vec<Binding>,
    /// Verbatim comment lines and unrecognised directive lines we
    /// encountered on read. Kept so the parser doesn't crash on unknown
    /// content; **not** re-emitted by [`serialize`] (Komodash owns the
    /// file format per ADR-0003).
    pub preserved_lines: Vec<String>,
}

/// Parse a `whkdrc` source string into a [`WhkdrcModel`].
///
/// Tolerates:
/// - leading `# ...` whole-line comments
/// - trailing ` # ...` comments on binding lines (split on whitespace +
///   `#`)
/// - `.shell <value>` and `.imports <path>` directives
/// - any case for modifiers (`Alt`, `ALT`, `alt`)
/// - non-canonical modifier order (`shift+alt+h`)
/// - varying whitespace around `+` (`alt + shift + h` and `alt+shift+h`
///   both work)
///
/// Returns an error only on a binding line we can't make sense of (e.g.
/// missing `:` separator, empty chord, unknown modifier token in chord
/// position).
pub fn parse(text: &str) -> Result<WhkdrcModel> {
    let mut model = WhkdrcModel::default();

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('#') {
            model.preserved_lines.push(raw_line.to_string());
            continue;
        }
        if let Some(rest) = line.strip_prefix(".shell") {
            let value = rest.trim();
            if value.is_empty() {
                model.preserved_lines.push(raw_line.to_string());
            } else {
                model.shell = Some(value.to_string());
            }
            continue;
        }
        if let Some(rest) = line.strip_prefix(".imports") {
            let value = rest.trim();
            if value.is_empty() {
                model.preserved_lines.push(raw_line.to_string());
            } else {
                model.imports.push(value.to_string());
            }
            continue;
        }
        if line.starts_with('.') {
            // Unknown directive — preserve so we don't crash.
            model.preserved_lines.push(raw_line.to_string());
            continue;
        }

        // Binding line: strip any trailing ` # ...` comment first.
        let payload = strip_trailing_comment(line);
        let binding = parse_binding(payload)?;
        model.bindings.push(binding);
    }

    Ok(model)
}

/// Serialize a [`WhkdrcModel`] to Komodash's canonical form.
///
/// Per ADR-0003:
/// 1. Header comment line.
/// 2. Blank line.
/// 3. `.shell pwsh` (always — `model.shell` is ignored).
/// 4. Blank line.
/// 5. `.imports <path>` lines (one per import), then a blank line if any.
/// 6. One canonical binding per line: `Win+Ctrl+Alt+Shift+K : cmd args`.
///
/// `model.preserved_lines` is intentionally **not** re-emitted — Komodash
/// owns the file format.
pub fn serialize(model: &WhkdrcModel) -> String {
    let mut out = String::new();
    out.push_str(CANONICAL_HEADER);
    out.push('\n');
    out.push('\n');
    out.push_str(".shell ");
    out.push_str(CANONICAL_SHELL);
    out.push('\n');
    out.push('\n');

    if !model.imports.is_empty() {
        for import in &model.imports {
            out.push_str(".imports ");
            out.push_str(import);
            out.push('\n');
        }
        out.push('\n');
    }

    for binding in &model.bindings {
        out.push_str(&binding.chord.to_canonical_string());
        out.push_str(" : ");
        out.push_str(&binding.command);
        for arg in &binding.args {
            out.push(' ');
            out.push_str(arg);
        }
        out.push('\n');
    }

    out
}

/// Strip a trailing ` # ...` comment from a binding line. The `#` must be
/// preceded by whitespace; otherwise it's treated as part of the payload
/// (so we don't accidentally swallow a `#` inside a command).
fn strip_trailing_comment(line: &str) -> &str {
    let bytes = line.as_bytes();
    for (i, &b) in bytes.iter().enumerate() {
        if b == b'#' && i > 0 && (bytes[i - 1] == b' ' || bytes[i - 1] == b'\t') {
            return line[..i].trim_end();
        }
    }
    line.trim_end()
}

/// Parse a single binding line (already stripped of any trailing comment).
fn parse_binding(line: &str) -> Result<Binding> {
    let (chord_part, command_part) = line
        .split_once(':')
        .ok_or_else(|| anyhow!("binding line missing ':' separator: {line:?}"))?;

    let chord = parse_chord(chord_part.trim())?;
    let mut tokens = command_part.split_whitespace();
    let command = tokens
        .next()
        .ok_or_else(|| anyhow!("binding line has no command after ':': {line:?}"))?
        .to_string();
    let args = tokens.map(|s| s.to_string()).collect();

    Ok(Binding {
        chord,
        command,
        args,
    })
}

/// Parse a chord like `alt + shift + h` (or `Alt+Shift+H`) into a [`Chord`].
///
/// Made `pub` so the hotkey validator (#12) can normalise reserved-chord
/// strings the same way it normalises user-typed bindings, giving us a
/// modifier-order-independent equality check.
pub fn parse_chord(text: &str) -> Result<Chord> {
    let tokens: Vec<&str> = text.split('+').map(|t| t.trim()).collect();
    if tokens.is_empty() || tokens.iter().any(|t| t.is_empty()) {
        return Err(anyhow!("empty chord token in {text:?}"));
    }
    let (key_token, modifier_tokens) = tokens
        .split_last()
        .ok_or_else(|| anyhow!("empty chord: {text:?}"))?;

    let mut modifiers = Vec::with_capacity(modifier_tokens.len());
    for tok in modifier_tokens {
        let modifier = Modifier::parse(tok)
            .ok_or_else(|| anyhow!("unknown modifier {tok:?} in chord {text:?}"))?;
        modifiers.push(modifier);
    }

    Ok(Chord::new(modifiers, key_token))
}

#[cfg(test)]
mod tests {
    use super::*;

    const QUICKSTART: &str = include_str!("../../tests/fixtures/whkdrc/quickstart.whkdrc");
    const WITH_COMMENTS: &str =
        include_str!("../../tests/fixtures/whkdrc/with-comments.whkdrc");

    #[test]
    fn parses_quickstart_whkdrc() {
        let model = parse(QUICKSTART).expect("quickstart fixture must parse");
        assert!(
            !model.bindings.is_empty(),
            "expected at least one binding in the quickstart fixture"
        );
        // Quickstart starts with `.shell powershell` then the first
        // binding is `alt + o : taskkill ...`.
        assert_eq!(model.shell.as_deref(), Some("powershell"));
        let first = &model.bindings[0];
        assert_eq!(
            first.chord,
            Chord::new(vec![Modifier::Alt], "O"),
            "first binding chord should be Alt+O"
        );
        assert_eq!(first.command, "taskkill");

        // Sanity-check a known mid-file binding survives normalisation.
        let focus_left = model
            .bindings
            .iter()
            .find(|b| b.chord == Chord::new(vec![Modifier::Alt], "H"))
            .expect("Alt+H should be present in the quickstart");
        assert_eq!(focus_left.command, "komorebic");
        assert_eq!(focus_left.args, vec!["focus", "left"]);
    }

    #[test]
    fn round_trips_canonical_form() {
        let canonical = format!(
            "{CANONICAL_HEADER}\n\n.shell {CANONICAL_SHELL}\n\n\
             Alt+H : komorebic focus left\n\
             Alt+Shift+H : komorebic move left\n\
             Win+Ctrl+Alt+Shift+K : komorebic close\n"
        );
        let model = parse(&canonical).expect("canonical sample must parse");
        let serialised = serialize(&model);
        let reparsed = parse(&serialised).expect("re-serialised output must re-parse");
        assert_eq!(model, reparsed, "round-trip must preserve the model");
        // And the canonical form is a fixed point of serialize itself.
        assert_eq!(serialised, canonical);
    }

    #[test]
    fn parses_file_with_comments() {
        let model = parse(WITH_COMMENTS).expect("with-comments fixture must parse");
        assert_eq!(model.bindings.len(), 3, "fixture has three bindings");
        assert!(
            !model.preserved_lines.is_empty(),
            "leading and interleaved `#` lines must be captured in preserved_lines"
        );
        assert!(
            model
                .preserved_lines
                .iter()
                .any(|l| l.contains("Focus the left window")),
            "expected comment text to be preserved verbatim"
        );
    }

    #[test]
    fn parses_file_with_shell_directive() {
        let model = parse(".shell powershell\n").expect("must parse");
        assert_eq!(model.shell, Some("powershell".to_string()));
        assert!(model.bindings.is_empty());
    }

    #[test]
    fn parses_file_with_imports_directive() {
        let model = parse(".imports foo.whkdrc\n.imports bar.whkdrc\n").expect("must parse");
        assert_eq!(
            model.imports,
            vec!["foo.whkdrc".to_string(), "bar.whkdrc".to_string()]
        );
    }

    #[test]
    fn serializer_always_emits_canonical_shell() {
        // Even when the parsed model claims `pwsh`, we emit the
        // canonical shell directive (`powershell` per #67 — broadest
        // Windows compatibility; `pwsh` is opt-in for PS7+ users).
        let model = WhkdrcModel {
            shell: Some("pwsh".to_string()),
            imports: vec![],
            bindings: vec![],
            preserved_lines: vec![],
        };
        let out = serialize(&model);
        assert!(
            out.contains(&format!(".shell {CANONICAL_SHELL}")),
            "serializer must always emit `.shell {CANONICAL_SHELL}`, got:\n{out}"
        );
        assert!(
            !out.contains(".shell pwsh"),
            "serializer must NOT round-trip the parsed shell value, got:\n{out}"
        );
    }

    #[test]
    fn serializer_emits_header_comment() {
        let out = serialize(&WhkdrcModel::default());
        let first_line = out.lines().next().expect("serialised output is non-empty");
        assert_eq!(first_line, CANONICAL_HEADER);
    }

    #[test]
    fn chord_normalises_modifier_order() {
        let chord = Chord::new(vec![Modifier::Shift, Modifier::Alt], "h");
        assert_eq!(chord.modifiers, vec![Modifier::Alt, Modifier::Shift]);
        assert_eq!(chord.key, "H");
    }

    #[test]
    fn parser_normalises_modifier_order_in_input() {
        let a = parse("shift + alt + h : komorebic focus left\n").expect("parses");
        let b = parse("alt + shift + h : komorebic focus left\n").expect("parses");
        assert_eq!(a, b, "modifier order in source must not affect the model");
        assert_eq!(
            a.bindings[0].chord.modifiers,
            vec![Modifier::Alt, Modifier::Shift]
        );
    }

    #[test]
    fn parser_accepts_lowercase_keys() {
        let model = parse("alt + h : komorebic focus left\n").expect("parses");
        assert_eq!(model.bindings[0].chord.key, "H");
    }

    #[test]
    fn parser_accepts_capitalized_modifiers() {
        let model = parse("Alt + Shift + H : komorebic focus left\n")
            .expect("capitalized modifiers must parse");
        assert_eq!(
            model.bindings[0].chord,
            Chord::new(vec![Modifier::Alt, Modifier::Shift], "H")
        );
    }
}
