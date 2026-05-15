//! In-memory cache for the **Bar configuration** JSON Schema, mirroring
//! [`crate::schema_cache`]'s pattern for the Static config (issue #19).
//!
//! The bar schema is emitted by `komorebi-bar.exe --schema`. It's
//! smaller than the static schema (~hundreds of lines vs ~thousands)
//! but the shell-out cost is the same, so the same lazy-fetch +
//! version-keyed-invalidation policy applies.
//!
//! Cache key is the Komorebi version (not the bar version separately —
//! Komorebi ships its bar in lockstep). Mismatch → refetch.

use std::sync::Mutex;

use anyhow::Result;

use crate::komorebic::Komorebic;

/// In-memory bar schema cache. Same shape as [`crate::schema_cache::SchemaCache`].
#[derive(Default)]
pub struct BarSchemaCache {
    inner: Mutex<Option<Entry>>,
}

#[derive(Clone)]
struct Entry {
    version: String,
    json: String,
}

impl BarSchemaCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// Return the bar schema for the currently-installed Komorebi. Lazy
    /// fetch on first call; cached subsequently until the Komorebi
    /// version changes.
    pub fn load(&self, client: &dyn Komorebic) -> Result<String> {
        let current_version = client
            .discover()
            .map(|info| info.version)
            .ok_or_else(|| {
                anyhow::anyhow!("komorebic could not be discovered; cannot fetch bar schema")
            })?;

        {
            let guard = self.inner.lock().expect("bar schema cache mutex not poisoned");
            if let Some(entry) = guard.as_ref() {
                if entry.version == current_version {
                    return Ok(entry.json.clone());
                }
            }
        }

        let json = client.bar_config_schema()?;
        let entry = Entry {
            version: current_version,
            json: json.clone(),
        };
        {
            let mut guard = self.inner.lock().expect("bar schema cache mutex not poisoned");
            *guard = Some(entry);
        }
        Ok(json)
    }

    #[cfg(test)]
    pub fn invalidate(&self) {
        let mut guard = self.inner.lock().expect("bar schema cache mutex not poisoned");
        *guard = None;
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::path::PathBuf;

    use super::*;
    use crate::komorebic::{Komorebic, KomorebicInfo};

    struct FakeKomorebic {
        version: Cell<String>,
        schema: Cell<String>,
        schema_calls: Cell<u32>,
    }

    impl FakeKomorebic {
        fn new(version: &str, schema: &str) -> Self {
            Self {
                version: Cell::new(version.into()),
                schema: Cell::new(schema.into()),
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

    // SAFETY: tests are single-threaded.
    unsafe impl Sync for FakeKomorebic {}

    impl Komorebic for FakeKomorebic {
        fn discover(&self) -> Option<KomorebicInfo> {
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

        fn bar_config_schema(&self) -> Result<String> {
            self.schema_calls.set(self.schema_calls.get() + 1);
            let s = unsafe { (*self.schema.as_ptr()).clone() };
            Ok(s)
        }
    }

    #[test]
    fn first_call_fetches_and_caches() {
        let fake = FakeKomorebic::new("0.1.41", r#"{"$schema":"v1"}"#);
        let cache = BarSchemaCache::new();
        let got = cache.load(&fake).expect("first load succeeds");
        assert_eq!(got, r#"{"$schema":"v1"}"#);
        assert_eq!(fake.schema_calls.get(), 1);
    }

    #[test]
    fn repeated_call_serves_from_cache() {
        let fake = FakeKomorebic::new("0.1.41", r#"{"$schema":"v1"}"#);
        let cache = BarSchemaCache::new();
        let _ = cache.load(&fake).unwrap();
        let _ = cache.load(&fake).unwrap();
        let _ = cache.load(&fake).unwrap();
        assert_eq!(fake.schema_calls.get(), 1, "should only fetch once");
    }

    #[test]
    fn version_change_invalidates_cache() {
        let fake = FakeKomorebic::new("0.1.41", r#"{"$schema":"v1"}"#);
        let cache = BarSchemaCache::new();
        let first = cache.load(&fake).unwrap();
        assert_eq!(first, r#"{"$schema":"v1"}"#);

        fake.set_version("0.2.0");
        fake.set_schema(r#"{"$schema":"v2"}"#);
        let second = cache.load(&fake).unwrap();
        assert_eq!(second, r#"{"$schema":"v2"}"#);
        assert_eq!(fake.schema_calls.get(), 2);
    }

    #[test]
    fn invalidate_forces_refetch() {
        let fake = FakeKomorebic::new("0.1.41", r#"{"$schema":"v1"}"#);
        let cache = BarSchemaCache::new();
        let _ = cache.load(&fake).unwrap();
        cache.invalidate();
        let _ = cache.load(&fake).unwrap();
        assert_eq!(fake.schema_calls.get(), 2);
    }
}
