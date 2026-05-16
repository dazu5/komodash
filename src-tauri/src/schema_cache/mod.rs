//! In-memory cache for the **Static configuration** JSON Schema fetched
//! from `komorebic static-config-schema` (per [ADR-0002]).
//!
//! [ADR-0002]: ../../../docs/adr/0002-schema-driven-editor.md
//!
//! The schema is large (~4 400 lines of JSON in Komorebi v0.1.41) and
//! reading it requires shelling out to `komorebic.exe`. Komodash fetches
//! it once at first request, stashes it alongside the Komorebi version it
//! was fetched for, and serves cached bytes on every subsequent request.
//! A version mismatch (user upgraded Komorebi while the app was running)
//! invalidates the cache and re-fetches.
//!
//! The cache lives in-process only — no disk persistence. A fresh app
//! launch re-fetches once. This is intentional: the cost of one extra
//! `komorebic.exe` invocation per launch is trivial (<200 ms) and we
//! avoid every persistence-cache failure mode (stale file across
//! upgrades, corrupted JSON on disk, etc.).

use std::sync::Mutex;

use anyhow::Result;

use crate::komorebic::Komorebic;

/// In-memory schema cache. Cheap to clone (it just clones the `Arc`-like
/// `Mutex` reference). Held inside `AppState` so every Tauri command can
/// reach it.
#[derive(Default)]
pub struct SchemaCache {
    /// `Some(version, schema_json)` once warm. The version is the
    /// `komorebic --version` string at the time the schema was fetched
    /// — used to detect upgrades during a single app session.
    inner: Mutex<Option<Entry>>,
}

#[derive(Clone)]
struct Entry {
    version: String,
    json: String,
}

impl SchemaCache {
    /// Construct an empty cache. The first call to [`Self::load`] warms it.
    pub fn new() -> Self {
        Self::default()
    }

    /// Return the schema for the currently-installed Komorebi version.
    ///
    /// On cache hit, returns the stashed JSON immediately.
    ///
    /// On cache miss or version mismatch, invokes
    /// [`Komorebic::static_config_schema`], stashes the result, and
    /// returns it.
    ///
    /// Returns an error iff the Komorebic call fails *and* we have no
    /// cached entry at all. (A subsequent failure with a warm cache from
    /// a prior version still serves the cached bytes — degraded but not
    /// blank — and surfaces the version-detection error to the caller.)
    pub fn load(&self, client: &dyn Komorebic) -> Result<String> {
        let current_version = client
            .discover()
            .map(|info| info.version)
            .ok_or_else(|| {
                anyhow::anyhow!("komorebic could not be discovered; cannot fetch schema")
            })?;

        // Cache hit?
        {
            let guard = self.inner.lock().expect("schema cache mutex not poisoned");
            if let Some(entry) = guard.as_ref() {
                if entry.version == current_version {
                    return Ok(entry.json.clone());
                }
            }
        }

        // Miss or version mismatch — refetch.
        let json = client.static_config_schema()?;
        let entry = Entry {
            version: current_version,
            json: json.clone(),
        };
        {
            let mut guard = self.inner.lock().expect("schema cache mutex not poisoned");
            *guard = Some(entry);
        }
        Ok(json)
    }

    /// Drop any cached entry. Mostly useful for tests that want to force
    /// a refetch without changing the version.
    #[cfg(test)]
    pub fn invalidate(&self) {
        let mut guard = self.inner.lock().expect("schema cache mutex not poisoned");
        *guard = None;
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::path::PathBuf;

    use super::*;
    use crate::komorebic::{Komorebic, KomorebicInfo};

    /// Fake that lets each test rig discover() and static_config_schema()
    /// independently and assert call counts.
    struct FakeKomorebic {
        version: Cell<String>,
        schema: Cell<String>,
        discover_calls: Cell<u32>,
        schema_calls: Cell<u32>,
    }

    impl FakeKomorebic {
        fn new(version: &str, schema: &str) -> Self {
            Self {
                version: Cell::new(version.into()),
                schema: Cell::new(schema.into()),
                discover_calls: Cell::new(0),
                schema_calls: Cell::new(0),
            }
        }

        fn set_version(&self, v: &str) {
            self.version.set(v.into());
        }

        fn set_schema(&self, s: &str) {
            self.schema.set(s.into());
        }
    }

    // SAFETY: tests are single-threaded; the Cell makes this !Sync but
    // we never share across threads.
    unsafe impl Sync for FakeKomorebic {}

    impl Komorebic for FakeKomorebic {
        fn discover(&self) -> Option<KomorebicInfo> {
            self.discover_calls.set(self.discover_calls.get() + 1);
            let v = unsafe { (*self.version.as_ptr()).clone() };
            Some(KomorebicInfo {
                path: PathBuf::from("C:/fake/komorebic.exe"),
                version: v,
                supported: true,
            })
        }

        fn is_running(&self) -> bool {
            false
        }

        fn static_config_schema(&self) -> Result<String> {
            self.schema_calls.set(self.schema_calls.get() + 1);
            let s = unsafe { (*self.schema.as_ptr()).clone() };
            Ok(s)
        }
    }

    #[test]
    fn first_call_fetches_schema_and_caches() {
        let fake = FakeKomorebic::new("0.1.41", r#"{"$schema": "v1"}"#);
        let cache = SchemaCache::new();

        let got = cache.load(&fake).expect("first load succeeds");
        assert_eq!(got, r#"{"$schema": "v1"}"#);
        assert_eq!(fake.schema_calls.get(), 1, "schema fetched once");
    }

    #[test]
    fn second_call_serves_from_cache() {
        let fake = FakeKomorebic::new("0.1.41", r#"{"$schema": "v1"}"#);
        let cache = SchemaCache::new();

        let _ = cache.load(&fake).expect("first load succeeds");
        let _ = cache.load(&fake).expect("second load succeeds");
        let _ = cache.load(&fake).expect("third load succeeds");

        assert_eq!(
            fake.schema_calls.get(),
            1,
            "schema should be fetched only once for repeated reads at the same version"
        );
    }

    #[test]
    fn version_change_invalidates_cache() {
        let fake = FakeKomorebic::new("0.1.41", r#"{"$schema": "v1"}"#);
        let cache = SchemaCache::new();

        let first = cache.load(&fake).expect("first load succeeds");
        assert_eq!(first, r#"{"$schema": "v1"}"#);

        // User upgrades Komorebi mid-session. Both the version AND the
        // schema body change.
        fake.set_version("0.2.0");
        fake.set_schema(r#"{"$schema": "v2"}"#);

        let second = cache.load(&fake).expect("post-upgrade load succeeds");
        assert_eq!(second, r#"{"$schema": "v2"}"#);
        assert_eq!(
            fake.schema_calls.get(),
            2,
            "schema must be re-fetched when version changes"
        );
    }

    #[test]
    fn invalidate_forces_refetch() {
        let fake = FakeKomorebic::new("0.1.41", r#"{"$schema": "v1"}"#);
        let cache = SchemaCache::new();

        let _ = cache.load(&fake).expect("first load");
        cache.invalidate();
        let _ = cache.load(&fake).expect("post-invalidate load");

        assert_eq!(
            fake.schema_calls.get(),
            2,
            "invalidate() must drop the cached entry"
        );
    }
}
