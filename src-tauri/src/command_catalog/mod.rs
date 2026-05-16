//! The **Command catalog** (per `CONTEXT.md`): Komodash's cached parse of
//! `komorebic --help` output — the list of valid `komorebic` subcommands
//! and the arg spec for each.
//!
//! Consumed primarily by the upcoming Hotkey editor (issue #20) and
//! validator (issue #12). Cached at `%LOCALAPPDATA%\komodash\command-catalog.json`
//! with the Komorebi version as its cache key — re-parsed when Komorebi
//! is upgraded.
//!
//! Parsing is intentionally tolerant: any subcommand whose `--help`
//! deviates from the expected clap-derived shape still appears in the
//! catalog with whatever fields we *could* extract; we never crash the
//! cache build because of one unusual subcommand.

use std::path::Path;

use anyhow::Result;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::komorebic::Komorebic;

/// Top-level catalog returned to the frontend / hotkey validator.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommandCatalog {
    /// The Komorebi version this catalog was built against (from
    /// `komorebic --version`). Mismatch with the currently-installed
    /// version triggers a rebuild.
    pub komorebic_version: String,
    /// All subcommands `komorebic --help` reports, in source order.
    pub commands: Vec<CommandSpec>,
}

/// A single `komorebic` subcommand.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommandSpec {
    /// e.g. `focus`, `send-to-workspace`, `replace-configuration`.
    pub name: String,
    /// The one-line description from the top-level help. May be
    /// empty if not parseable.
    pub summary: String,
    /// Positional arguments in declaration order, parsed from the
    /// subcommand's own `--help`. Empty when none.
    pub args: Vec<ArgSpec>,
}

/// A single positional argument to a `komorebic` subcommand.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ArgSpec {
    /// As declared in the `Usage:` line (e.g. `OPERATION_DIRECTION`,
    /// `TARGET`, `WORKSPACE_INDEX`).
    pub name: String,
    /// `true` for `<NAME>`-style required positionals; `false` for
    /// `[NAME]`-style optional ones.
    pub required: bool,
    /// Enumerated allowable values, when clap renders them as
    /// `[possible values: a, b, c]`. `None` when free-form.
    pub possible_values: Option<Vec<String>>,
}

// ---- top-level help parsing ------------------------------------------------

/// Line under `Commands:`: name at column 0..N, then a continuation line
/// indented with whitespace that holds the summary.
static COMMAND_NAME: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^([a-z][a-z0-9-]*)\b").expect("static regex compiles"));

/// Parse the `Commands:` block of `komorebic --help` output into a list
/// of (name, summary) pairs. Tolerant of variations in spacing and the
/// trailing `help` pseudo-command (which we skip).
///
/// clap renders the `Commands:` block as:
///
/// ```text
/// Commands:
///   focus
///           Change focus to the window in the specified direction
///   send-to-workspace
///           Move the focused window to the specified workspace
/// ```
///
/// The distinguishing feature is **indentation depth**: command names
/// are indented `COMMAND_INDENT_MAX` spaces or less; description text
/// is indented strictly deeper. We use that depth threshold to decide
/// whether a non-empty line introduces a new command or continues the
/// description of the previous one. Without this we'd treat a wrapped
/// description word (e.g. an orphan `file` on its own line) as a
/// brand-new subcommand.
pub fn parse_subcommand_list(stdout: &str) -> Vec<(String, String)> {
    /// Maximum leading-space count for a line to count as a command name.
    /// clap uses 2; we allow up to 4 to absorb future tweaks.
    const COMMAND_INDENT_MAX: usize = 4;

    let mut in_commands_block = false;
    let mut commands: Vec<(String, String)> = Vec::new();
    let mut current: Option<(String, String)> = None;

    for line in stdout.lines() {
        if line.trim_start() == "Commands:" || line.trim_start().starts_with("Commands:") {
            in_commands_block = true;
            continue;
        }
        if !in_commands_block {
            continue;
        }
        let trimmed = line.trim_start();
        // A non-indented non-empty line that isn't a subcommand entry
        // ends the Commands block (typically the next "Options:" header).
        if !line.is_empty() && !line.starts_with(char::is_whitespace) {
            break;
        }
        if trimmed.is_empty() {
            continue;
        }
        let indent = line.len() - trimmed.len();
        let looks_like_name =
            indent <= COMMAND_INDENT_MAX && COMMAND_NAME.is_match(trimmed);
        if looks_like_name {
            if let Some(caps) = COMMAND_NAME.captures(trimmed) {
                if let Some(name) = caps.get(1) {
                    // Flush previous in-progress entry.
                    if let Some(prev) = current.take() {
                        if prev.0 != "help" {
                            commands.push(prev);
                        }
                    }
                    current = Some((name.as_str().to_string(), String::new()));
                    continue;
                }
            }
        }
        // Continuation: deeper-indented description for the current entry.
        if let Some((_, summary)) = current.as_mut() {
            if !summary.is_empty() {
                summary.push(' ');
            }
            summary.push_str(trimmed);
        }
    }
    if let Some(last) = current {
        if last.0 != "help" {
            commands.push(last);
        }
    }
    commands
}

// ---- subcommand-help parsing -----------------------------------------------

/// Match a positional arg in a Usage line: `<FOO>` or `[FOO]`. The
/// `\bUsage:` anchor isn't here — callers extract the Usage line first.
static USAGE_ARG: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"<([A-Z][A-Z0-9_]*)>|\[([A-Z][A-Z0-9_]*)\]").expect("static regex compiles"));

/// Match a `[possible values: a, b, c]` line in an Arguments block.
static POSSIBLE_VALUES: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\[possible values:\s*([^\]]+)\]").expect("static regex compiles")
});

/// Parse the args declared by a single subcommand's `--help` output.
///
/// Strategy:
/// 1. Find the `Usage:` line, scan it for `<NAME>` (required) and
///    `[NAME]` (optional) tokens — those define the positional args
///    in declaration order.
/// 2. Walk the `Arguments:` section for each positional and look for
///    a `[possible values: ...]` clause that pins it to an enum.
///
/// Subcommands with no positional args (e.g. `retile`) return an empty
/// vec, which is correct.
pub fn parse_subcommand_help(stdout: &str) -> Vec<ArgSpec> {
    let Some(usage_line) = stdout.lines().find(|l| l.trim_start().starts_with("Usage:"))
    else {
        return Vec::new();
    };

    let mut args: Vec<ArgSpec> = Vec::new();
    for caps in USAGE_ARG.captures_iter(usage_line) {
        if let Some(name) = caps.get(1) {
            args.push(ArgSpec {
                name: name.as_str().to_string(),
                required: true,
                possible_values: None,
            });
        } else if let Some(name) = caps.get(2) {
            // clap inserts a literal `[OPTIONS]` marker in the Usage line
            // to point at the Options section; it is NOT a positional arg.
            // Same convention for `[COMMAND]` on subcommand-of-subcommand
            // entries. Skip both.
            let candidate = name.as_str();
            if candidate == "OPTIONS" || candidate == "COMMAND" {
                continue;
            }
            args.push(ArgSpec {
                name: candidate.to_string(),
                required: false,
                possible_values: None,
            });
        }
    }

    if args.is_empty() {
        return args;
    }

    // Look up possible_values for each arg by scanning the Arguments
    // block. We don't strictly require Arguments: to exist — some clap
    // outputs put `[possible values:]` inline with the Usage. So just
    // look at the whole stdout per-arg.
    for arg in args.iter_mut() {
        let needle_angle = format!("<{}>", arg.name);
        let needle_square = format!("[{}]", arg.name);
        // Find the line that introduces this arg in the Arguments block.
        let Some(intro_idx) = stdout.lines().position(|l| {
            let trimmed = l.trim_start();
            trimmed.starts_with(&needle_angle) || trimmed.starts_with(&needle_square)
        }) else {
            continue;
        };
        // Scan up to 10 lines after the intro for a `[possible values:]`
        // clause — clap typically renders it within a few lines.
        let candidates = stdout.lines().skip(intro_idx + 1).take(10);
        for line in candidates {
            if let Some(caps) = POSSIBLE_VALUES.captures(line) {
                if let Some(values) = caps.get(1) {
                    let parsed: Vec<String> = values
                        .as_str()
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                    if !parsed.is_empty() {
                        arg.possible_values = Some(parsed);
                    }
                }
                break;
            }
            // If the next arg starts (a new `<NAME>` at the start of
            // a trimmed line), stop scanning for THIS arg.
            let trimmed = line.trim_start();
            if (trimmed.starts_with('<') || trimmed.starts_with('['))
                && !trimmed.starts_with(&needle_angle)
                && !trimmed.starts_with(&needle_square)
            {
                break;
            }
        }
    }

    args
}

// ---- builder + cache -------------------------------------------------------

/// Build the catalog from scratch by shelling out to `komorebic`.
/// Failures on individual subcommands degrade to "name + summary only,
/// no args" rather than aborting the entire build.
pub fn build_catalog(client: &dyn Komorebic, komorebic_version: String) -> Result<CommandCatalog> {
    let top_help = client.help()?;
    let entries = parse_subcommand_list(&top_help);

    let mut commands = Vec::with_capacity(entries.len());
    for (name, summary) in entries {
        let args = match client.help_for_subcommand(&name) {
            Ok(sub_help) => parse_subcommand_help(&sub_help),
            Err(err) => {
                tracing::debug!(subcommand = %name, error = %err, "failed to parse subcommand help");
                Vec::new()
            }
        };
        commands.push(CommandSpec { name, summary, args });
    }

    Ok(CommandCatalog {
        komorebic_version,
        commands,
    })
}

/// Load the cached catalog if its `komorebic_version` matches `current_version`;
/// otherwise rebuild via [`build_catalog`] and persist the fresh copy.
///
/// Cache failures (corrupt JSON, missing dir) are not propagated —
/// they trigger a rebuild. Write failures after a rebuild are logged
/// but the freshly-built catalog is still returned.
pub fn load_or_build(
    cache_path: &Path,
    client: &dyn Komorebic,
    current_version: &str,
) -> Result<CommandCatalog> {
    if let Some(cached) = read_cache(cache_path) {
        if cached.komorebic_version == current_version {
            return Ok(cached);
        }
        tracing::info!(
            cached_version = %cached.komorebic_version,
            current_version = %current_version,
            "command catalog cache stale; rebuilding"
        );
    }
    let fresh = build_catalog(client, current_version.to_string())?;
    if let Err(err) = write_cache(cache_path, &fresh) {
        tracing::warn!(error = %err, "failed to persist command catalog cache");
    }
    Ok(fresh)
}

/// Read and JSON-parse the cache file. Returns `None` on any failure
/// (missing file, bad JSON) so callers fall through to rebuild.
fn read_cache(cache_path: &Path) -> Option<CommandCatalog> {
    let text = std::fs::read_to_string(cache_path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Persist `catalog` as JSON at `cache_path`, creating the parent
/// directory if needed.
fn write_cache(cache_path: &Path, catalog: &CommandCatalog) -> Result<()> {
    if let Some(parent) = cache_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(catalog)?;
    std::fs::write(cache_path, json)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::path::PathBuf;
    use tempfile::tempdir;

    use crate::komorebic::KomorebicInfo;

    // ---- list parser ----

    const TOP_HELP_SAMPLE: &str = "\
The command-line interface for Komorebi, a tiling window manager for Windows

Usage: komorebic.exe <COMMAND>

Commands:
  quickstart
          Gather example configurations for a new-user quickstart
  start
          Start komorebi.exe as a background process
  focus
          Change focus to the window in the specified direction
  send-to-workspace
          Move the focused window to the specified workspace
  retile
          Force the retiling of all managed windows
  replace-configuration
          Replace the configuration of a running instance of komorebi from a static configuration
          file
  help
          Print this message or the help of the given subcommand(s)

Options:
  -h, --help     Print help
  -V, --version  Print version
";

    #[test]
    fn list_parser_extracts_all_named_subcommands() {
        let parsed = parse_subcommand_list(TOP_HELP_SAMPLE);
        let names: Vec<&str> = parsed.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "quickstart",
                "start",
                "focus",
                "send-to-workspace",
                "retile",
                "replace-configuration",
            ]
        );
    }

    #[test]
    fn list_parser_skips_help_pseudo_command() {
        let parsed = parse_subcommand_list(TOP_HELP_SAMPLE);
        assert!(parsed.iter().all(|(n, _)| n != "help"));
    }

    #[test]
    fn list_parser_captures_first_line_summary() {
        let parsed = parse_subcommand_list(TOP_HELP_SAMPLE);
        let focus = parsed.iter().find(|(n, _)| n == "focus").unwrap();
        assert_eq!(focus.1, "Change focus to the window in the specified direction");
    }

    #[test]
    fn list_parser_concatenates_multi_line_summary() {
        let parsed = parse_subcommand_list(TOP_HELP_SAMPLE);
        let rc = parsed
            .iter()
            .find(|(n, _)| n == "replace-configuration")
            .unwrap();
        assert!(rc.1.contains("Replace the configuration"));
        assert!(rc.1.contains("file"));
    }

    // ---- subcommand parser ----

    const FOCUS_HELP: &str = "\
Change focus to the window in the specified direction

Usage: komorebic.exe focus <OPERATION_DIRECTION>

Arguments:
  <OPERATION_DIRECTION>
          [possible values: left, right, up, down]

Options:
  -h, --help
          Print help
";

    const SEND_TO_WORKSPACE_HELP: &str = "\
Move the focused window to the specified workspace

Usage: komorebic.exe send-to-workspace [OPTIONS] <TARGET>

Arguments:
  <TARGET>
          The 1-indexed target workspace

Options:
      --follow
  -h, --help
          Print help
";

    const RETILE_HELP: &str = "\
Force the retiling of all managed windows

Usage: komorebic.exe retile

Options:
  -h, --help
          Print help
";

    #[test]
    fn subcommand_parser_extracts_required_positional_with_choices() {
        let args = parse_subcommand_help(FOCUS_HELP);
        assert_eq!(args.len(), 1);
        let arg = &args[0];
        assert_eq!(arg.name, "OPERATION_DIRECTION");
        assert!(arg.required);
        assert_eq!(
            arg.possible_values.as_deref(),
            Some(&["left".to_string(), "right".to_string(), "up".to_string(), "down".to_string()][..]),
        );
    }

    #[test]
    fn subcommand_parser_extracts_required_freeform_positional() {
        let args = parse_subcommand_help(SEND_TO_WORKSPACE_HELP);
        assert_eq!(args.len(), 1);
        let arg = &args[0];
        assert_eq!(arg.name, "TARGET");
        assert!(arg.required);
        assert!(arg.possible_values.is_none());
    }

    #[test]
    fn subcommand_parser_returns_empty_for_no_arg_subcommand() {
        let args = parse_subcommand_help(RETILE_HELP);
        assert!(args.is_empty());
    }

    #[test]
    fn subcommand_parser_handles_missing_usage_line() {
        // A subcommand whose --help is empty or shaped differently
        // should not panic; just yields empty args.
        let args = parse_subcommand_help("totally unexpected output\n");
        assert!(args.is_empty());
    }

    // ---- builder + cache ----

    /// Fake Komorebic that returns canned --help strings.
    struct FakeKomorebic {
        top_help: String,
        sub_helps: HashMap<String, String>,
        sub_calls: RefCell<Vec<String>>,
    }

    impl FakeKomorebic {
        fn new(top_help: &str, sub_helps: &[(&str, &str)]) -> Self {
            Self {
                top_help: top_help.to_string(),
                sub_helps: sub_helps
                    .iter()
                    .map(|(k, v)| (k.to_string(), v.to_string()))
                    .collect(),
                sub_calls: RefCell::new(Vec::new()),
            }
        }
    }

    // Cell-based interior mutability ⇒ not Sync by default; we run
    // tests single-threaded so this is safe.
    unsafe impl Sync for FakeKomorebic {}

    impl Komorebic for FakeKomorebic {
        fn discover(&self) -> Option<KomorebicInfo> {
            Some(KomorebicInfo {
                path: PathBuf::from("C:/fake/komorebic.exe"),
                version: "0.1.41".into(),
                supported: true,
            })
        }
        fn is_running(&self) -> bool {
            false
        }
        fn help(&self) -> Result<String> {
            Ok(self.top_help.clone())
        }
        fn help_for_subcommand(&self, name: &str) -> Result<String> {
            self.sub_calls.borrow_mut().push(name.to_string());
            self.sub_helps
                .get(name)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("no fake help for {name}"))
        }
    }

    #[test]
    fn builder_assembles_catalog_with_arg_specs() {
        let fake = FakeKomorebic::new(
            TOP_HELP_SAMPLE,
            &[
                ("focus", FOCUS_HELP),
                ("send-to-workspace", SEND_TO_WORKSPACE_HELP),
                ("retile", RETILE_HELP),
                // Missing sub_help for quickstart, start, replace-configuration
                // — builder should still include them with empty args.
            ],
        );
        let cat = build_catalog(&fake, "0.1.41".into()).unwrap();
        assert_eq!(cat.komorebic_version, "0.1.41");
        assert_eq!(cat.commands.len(), 6);

        let focus = cat.commands.iter().find(|c| c.name == "focus").unwrap();
        assert_eq!(focus.args.len(), 1);
        assert_eq!(focus.args[0].name, "OPERATION_DIRECTION");
        assert!(focus.args[0].possible_values.is_some());

        let retile = cat.commands.iter().find(|c| c.name == "retile").unwrap();
        assert!(retile.args.is_empty());

        // Failing subcommand help shouldn't bomb the whole build.
        let qs = cat.commands.iter().find(|c| c.name == "quickstart").unwrap();
        assert!(qs.args.is_empty());
    }

    #[test]
    fn load_or_build_uses_cache_when_version_matches() {
        let dir = tempdir().unwrap();
        let cache_path = dir.path().join("catalog.json");
        let fake = FakeKomorebic::new(TOP_HELP_SAMPLE, &[("focus", FOCUS_HELP)]);

        // First call builds and writes to cache.
        let first = load_or_build(&cache_path, &fake, "0.1.41").unwrap();
        assert_eq!(first.commands.len(), 6);
        assert_eq!(fake.sub_calls.borrow().len(), 6);

        // Second call should hit cache — no further sub_help calls.
        let second = load_or_build(&cache_path, &fake, "0.1.41").unwrap();
        assert_eq!(first, second);
        assert_eq!(
            fake.sub_calls.borrow().len(),
            6,
            "second call should not invoke help_for_subcommand"
        );
    }

    #[test]
    fn load_or_build_rebuilds_on_version_change() {
        let dir = tempdir().unwrap();
        let cache_path = dir.path().join("catalog.json");
        let fake = FakeKomorebic::new(TOP_HELP_SAMPLE, &[("focus", FOCUS_HELP)]);

        let _ = load_or_build(&cache_path, &fake, "0.1.41").unwrap();
        assert_eq!(fake.sub_calls.borrow().len(), 6);

        let rebuilt = load_or_build(&cache_path, &fake, "0.1.42").unwrap();
        assert_eq!(rebuilt.komorebic_version, "0.1.42");
        assert_eq!(
            fake.sub_calls.borrow().len(),
            12,
            "version change should trigger a fresh round of help_for_subcommand calls"
        );
    }

    #[test]
    fn load_or_build_handles_corrupt_cache() {
        let dir = tempdir().unwrap();
        let cache_path = dir.path().join("catalog.json");
        std::fs::write(&cache_path, "{not json").unwrap();
        let fake = FakeKomorebic::new(TOP_HELP_SAMPLE, &[]);
        let cat = load_or_build(&cache_path, &fake, "0.1.41").unwrap();
        assert_eq!(cat.komorebic_version, "0.1.41");
        // Overwritten with a valid JSON now:
        let reread: CommandCatalog =
            serde_json::from_str(&std::fs::read_to_string(&cache_path).unwrap()).unwrap();
        assert_eq!(reread, cat);
    }
}
