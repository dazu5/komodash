//! In-app update check for Komodash.
//!
//! Per [ADR-0011](../../../docs/adr/0011-v1-ship-posture.md), v1 ships
//! unsigned via GitHub Releases with an *in-app notification* rather than
//! an auto-updater. This module is the backend half of that notification:
//!
//! 1. Poll `api.github.com/repos/dazu5/komodash/releases/latest`.
//! 2. Cache the response to `%LOCALAPPDATA%\komodash\update-cache.json`
//!    for 24 hours so repeated launches don't hammer the API.
//! 3. Expose a pure-logic [`newer_than_bundled`] comparator so the
//!    "should we show the banner?" decision is unit-testable without I/O.
//!
//! External I/O sits behind the [`ReleaseSource`] trait so unit tests can
//! swap in a fake. The Tauri command lives in `lib.rs` and is the only
//! place that touches the real GitHub API or the user's disk.

use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};

use anyhow::{Context, Result};
use semver::Version;
use serde::{Deserialize, Serialize};

/// What the frontend banner needs: the tag to display and the URL to open.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct UpdateInfo {
    /// The release tag as GitHub reports it (e.g. `v0.2.0`). We pass it
    /// through verbatim so the banner can show whatever the maintainer
    /// chose to call the release.
    pub tag_name: String,
    /// `html_url` from the GitHub release — the human-facing page with
    /// the changelog and download assets.
    pub html_url: String,
}

/// Minimal subset of the GitHub release payload that Komodash cares about.
///
/// `serde(default)` on every field so an upstream schema tweak (extra
/// fields, missing fields on draft/prerelease responses) can't crash the
/// banner — at worst the comparator returns `None` and the banner stays
/// hidden.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Release {
    #[serde(default)]
    pub tag_name: String,
    #[serde(default)]
    pub html_url: String,
}

/// Source of latest-release info. Implemented by [`GithubReleaseSource`]
/// in production and faked in unit tests so cache logic can be exercised
/// without a network round-trip.
pub trait ReleaseSource: Send + Sync {
    /// Fetch the latest release. Errors propagate so the caller (the
    /// Tauri command) can decide whether to fall back to a stale cache
    /// or surface nothing.
    fn fetch_latest(&self) -> Result<Release>;
}

/// Production [`ReleaseSource`] backed by `api.github.com`.
///
/// `user_agent` is required: GitHub's API rejects requests without one.
/// We default to `komodash/<crate-version>` in `lib.rs`.
pub struct GithubReleaseSource {
    pub owner: String,
    pub repo: String,
    pub user_agent: String,
}

impl ReleaseSource for GithubReleaseSource {
    fn fetch_latest(&self) -> Result<Release> {
        let url = format!(
            "https://api.github.com/repos/{}/{}/releases/latest",
            self.owner, self.repo
        );
        let client = reqwest::blocking::Client::builder()
            .user_agent(&self.user_agent)
            .timeout(Duration::from_secs(10))
            .build()
            .context("build reqwest client")?;
        let response = client
            .get(&url)
            .header("Accept", "application/vnd.github+json")
            .send()
            .with_context(|| format!("GET {url}"))?
            .error_for_status()
            .with_context(|| format!("non-2xx from {url}"))?;
        let release: Release = response.json().context("parse GitHub release JSON")?;
        Ok(release)
    }
}

/// On-disk cache entry. The release is wrapped with the `SystemTime` at
/// which we stored it so [`cached_or_fresh`] can compute staleness without
/// trusting the file's mtime (which roams across filesystems).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct CacheEntry {
    /// Seconds since the Unix epoch. We store an absolute timestamp rather
    /// than a `SystemTime` because `SystemTime` doesn't round-trip through
    /// JSON cleanly on all platforms.
    fetched_at_unix: u64,
    release: Release,
}

/// Return `Some(UpdateInfo)` iff `latest.tag_name` parses as a strictly
/// greater semver than `bundled`. Tolerant of a leading `v` on either side.
/// Malformed tags return `None` rather than panicking — a release named
/// "Pre-launch" should never crash the banner.
pub fn newer_than_bundled(latest: &Release, bundled: &str) -> Option<UpdateInfo> {
    let latest_version = Version::parse(strip_v(&latest.tag_name)).ok()?;
    let bundled_version = Version::parse(strip_v(bundled)).ok()?;
    if latest_version > bundled_version {
        Some(UpdateInfo {
            tag_name: latest.tag_name.clone(),
            html_url: latest.html_url.clone(),
        })
    } else {
        None
    }
}

/// Strip a single leading `v` or `V` from a tag for semver parsing.
/// Idempotent — `strip_v("0.1.0")` is still `"0.1.0"`.
fn strip_v(tag: &str) -> &str {
    tag.strip_prefix('v')
        .or_else(|| tag.strip_prefix('V'))
        .unwrap_or(tag)
}

/// Return a cached release if `cache_path` exists and is younger than
/// `max_age`; otherwise call `fetch`, persist the result, and return it.
///
/// If `fetch` fails, fall back to whatever is in the cache (even if
/// stale). Only if there is no cache at all do we propagate the error.
/// This keeps the banner working through transient network outages.
pub fn cached_or_fresh<F>(cache_path: &Path, max_age: Duration, fetch: F) -> Result<Release>
where
    F: FnOnce() -> Result<Release>,
{
    let cached = read_cache(cache_path);

    if let Some(entry) = cached.as_ref() {
        if !is_stale(entry, max_age) {
            return Ok(entry.release.clone());
        }
    }

    match fetch() {
        Ok(release) => {
            // Best-effort persistence — a failure to write the cache
            // shouldn't fail the call (the next launch just refetches).
            let _ = write_cache(cache_path, &release);
            Ok(release)
        }
        Err(err) => match cached {
            Some(entry) => Ok(entry.release),
            None => Err(err),
        },
    }
}

/// `true` if the cache entry was fetched longer than `max_age` ago, or if
/// the timestamp is in the future (clock skew → treat as stale).
fn is_stale(entry: &CacheEntry, max_age: Duration) -> bool {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if entry.fetched_at_unix > now {
        return true;
    }
    let age = now.saturating_sub(entry.fetched_at_unix);
    age > max_age.as_secs()
}

/// Read and parse a cache file. Any error (missing file, bad JSON) becomes
/// `None` so the caller treats a corrupt cache as a cache-miss.
fn read_cache(path: &Path) -> Option<CacheEntry> {
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Persist a release to the cache file. Creates the parent dir if missing.
fn write_cache(path: &Path, release: &Release) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("mkdir -p {}", parent.display()))?;
    }
    let entry = CacheEntry {
        fetched_at_unix: SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        release: release.clone(),
    };
    let json = serde_json::to_vec_pretty(&entry).context("serialize cache entry")?;
    fs::write(path, json).with_context(|| format!("write {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use tempfile::tempdir;

    fn release(tag: &str) -> Release {
        Release {
            tag_name: tag.to_string(),
            html_url: format!("https://example.test/releases/{tag}"),
        }
    }

    #[test]
    fn newer_release_is_detected() {
        let latest = release("0.2.0");
        let info = newer_than_bundled(&latest, "0.1.0").expect("update available");
        assert_eq!(info.tag_name, "0.2.0");
        assert_eq!(info.html_url, "https://example.test/releases/0.2.0");
    }

    #[test]
    fn same_version_no_update() {
        let latest = release("0.1.0");
        assert!(newer_than_bundled(&latest, "0.1.0").is_none());
    }

    #[test]
    fn older_release_no_update() {
        let latest = release("0.1.0");
        assert!(newer_than_bundled(&latest, "0.2.0").is_none());
    }

    #[test]
    fn v_prefix_is_stripped() {
        let latest = release("v0.2.0");
        let info = newer_than_bundled(&latest, "0.1.0").expect("update available");
        // The reported tag passes through verbatim so the UI can show the
        // tag exactly as the maintainer wrote it.
        assert_eq!(info.tag_name, "v0.2.0");
    }

    #[test]
    fn v_prefix_on_bundled_is_stripped() {
        let latest = release("0.2.0");
        assert!(newer_than_bundled(&latest, "v0.1.0").is_some());
    }

    #[test]
    fn malformed_tag_returns_none() {
        let latest = release("not-a-version");
        assert!(newer_than_bundled(&latest, "0.1.0").is_none());
    }

    #[test]
    fn malformed_bundled_returns_none() {
        let latest = release("0.2.0");
        assert!(newer_than_bundled(&latest, "garbage").is_none());
    }

    /// Helper: write a cache file with a chosen `fetched_at_unix`.
    fn write_cache_at(path: &Path, release: &Release, fetched_at_unix: u64) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let entry = CacheEntry {
            fetched_at_unix,
            release: release.clone(),
        };
        let json = serde_json::to_vec_pretty(&entry).unwrap();
        fs::write(path, json).unwrap();
    }

    fn now_unix() -> u64 {
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs()
    }

    /// Tracks how many times the fake fetcher was called so we can assert
    /// caching prevented an unwanted network hit.
    struct FetchCounter {
        calls: Cell<u32>,
    }

    impl FetchCounter {
        fn new() -> Self {
            Self {
                calls: Cell::new(0),
            }
        }
        fn bump(&self) {
            self.calls.set(self.calls.get() + 1);
        }
    }

    #[test]
    fn cached_or_fresh_uses_cache_when_fresh() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("cache.json");
        let cached = release("0.1.0");
        // Written "right now" — comfortably within a 1-hour window.
        write_cache_at(&path, &cached, now_unix());

        let counter = FetchCounter::new();
        let got = cached_or_fresh(&path, Duration::from_secs(3600), || {
            counter.bump();
            Ok(release("0.9.0"))
        })
        .unwrap();

        assert_eq!(got.tag_name, "0.1.0");
        assert_eq!(counter.calls.get(), 0, "fetch should not be called");
    }

    #[test]
    fn cached_or_fresh_refetches_when_stale() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("cache.json");
        let cached = release("0.1.0");
        // 25 hours ago, past a 24-hour max-age.
        let twenty_five_hours = 25 * 60 * 60;
        write_cache_at(&path, &cached, now_unix().saturating_sub(twenty_five_hours));

        let counter = FetchCounter::new();
        let got = cached_or_fresh(&path, Duration::from_secs(24 * 60 * 60), || {
            counter.bump();
            Ok(release("0.2.0"))
        })
        .unwrap();

        assert_eq!(got.tag_name, "0.2.0");
        assert_eq!(counter.calls.get(), 1, "fetch should be called once");
    }

    #[test]
    fn cached_or_fresh_handles_missing_cache() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("subdir/cache.json");
        assert!(!path.exists());

        let counter = FetchCounter::new();
        let got = cached_or_fresh(&path, Duration::from_secs(3600), || {
            counter.bump();
            Ok(release("0.2.0"))
        })
        .unwrap();

        assert_eq!(got.tag_name, "0.2.0");
        assert_eq!(counter.calls.get(), 1);
        // Verify the cache was written for the next call.
        assert!(path.exists(), "cache file should be created");
        let reread = read_cache(&path).expect("cache parses");
        assert_eq!(reread.release.tag_name, "0.2.0");
    }

    #[test]
    fn cached_or_fresh_falls_back_to_stale_on_fetch_failure() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("cache.json");
        let cached = release("0.1.0");
        let twenty_five_hours = 25 * 60 * 60;
        write_cache_at(&path, &cached, now_unix().saturating_sub(twenty_five_hours));

        let got = cached_or_fresh(&path, Duration::from_secs(24 * 60 * 60), || {
            Err(anyhow::anyhow!("network down"))
        })
        .unwrap();

        // Stale cache is better than nothing — the banner just shows the
        // last-known release.
        assert_eq!(got.tag_name, "0.1.0");
    }

    #[test]
    fn cached_or_fresh_propagates_error_when_no_cache() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("cache.json");

        let result = cached_or_fresh(&path, Duration::from_secs(3600), || {
            Err(anyhow::anyhow!("network down"))
        });

        assert!(result.is_err());
    }

    #[test]
    fn corrupt_cache_is_treated_as_miss() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("cache.json");
        fs::write(&path, b"this is not json").unwrap();

        let counter = FetchCounter::new();
        let got = cached_or_fresh(&path, Duration::from_secs(3600), || {
            counter.bump();
            Ok(release("0.2.0"))
        })
        .unwrap();

        assert_eq!(got.tag_name, "0.2.0");
        assert_eq!(counter.calls.get(), 1);
    }
}
