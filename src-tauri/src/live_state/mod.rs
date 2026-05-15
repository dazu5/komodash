//! Live-state subscription per [ADR-0008](../../../docs/adr/0008-single-instance-via-mutex.md).
//!
//! Komodash subscribes to Komorebi's event stream over a Windows named
//! pipe. The flow:
//!
//! 1. Generate a per-launch UUID-flavour pipe name (`komodash-{pid}-{ts}`)
//!    so a stale subscription from a crashed prior run never collides.
//! 2. Create the named-pipe **server** at `\\.\pipe\<name>`. Komorebi
//!    will connect as the client.
//! 3. Tell Komorebi about the pipe via `komorebic subscribe-pipe <name>`.
//! 4. Wait for Komorebi to connect, then read JSON `Notification` events
//!    line-by-line.
//! 5. Throttle emissions to the frontend to ≤30 Hz so a burst of events
//!    during a window-spawn storm doesn't pin the React render loop.
//! 6. On EOF or any error, unsubscribe and reconnect with exponential
//!    backoff capped at 30 s.
//!
//! Each event from Komorebi already carries the full `state` (per the
//! `notification-schema`), so we don't model the state shape on the Rust
//! side — we relay the JSON `Value` verbatim and let TS navigate it.

use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::time::{interval, sleep, MissedTickBehavior};

use crate::komorebic::Komorebic;

/// ~30 Hz upper bound on `live-state-update` emissions.
pub const THROTTLE_MS: u64 = 33;

/// First reconnect delay after a subscription error.
pub const INITIAL_BACKOFF: Duration = Duration::from_millis(500);

/// Reconnect delay ceiling per ADR-0008.
pub const MAX_BACKOFF: Duration = Duration::from_secs(30);

/// Tauri event name emitted to the frontend on each throttled state update.
pub const EVENT: &str = "live-state-update";

/// Spawn the live-state subscriber as a long-lived tokio task. It runs
/// for the lifetime of the process — call once from `run()` and forget.
///
/// The task reconnects automatically when Komorebi is unavailable; while
/// disconnected, no `live-state-update` events fire (the frontend store
/// keeps its previous snapshot).
pub fn spawn(app: AppHandle, komorebic: Arc<dyn Komorebic>) {
    tauri::async_runtime::spawn(async move {
        run_forever(app, komorebic).await;
    });
}

/// Reconnect loop with exponential backoff capped at [`MAX_BACKOFF`].
/// Never returns under normal operation — the only way out is process
/// exit.
async fn run_forever(app: AppHandle, komorebic: Arc<dyn Komorebic>) {
    let mut backoff = INITIAL_BACKOFF;
    loop {
        let name = generate_pipe_name();
        match subscribe_and_read(&app, &name, komorebic.as_ref()).await {
            Ok(()) => {
                tracing::info!(pipe = %name, "live-state subscription ended cleanly; reconnecting");
                backoff = INITIAL_BACKOFF;
            }
            Err(err) => {
                tracing::warn!(
                    pipe = %name,
                    error = %err,
                    backoff_ms = backoff.as_millis() as u64,
                    "live-state subscription error; will retry"
                );
                sleep(backoff).await;
                backoff = next_backoff(backoff);
            }
        }
    }
}

/// One end-to-end subscription attempt: create pipe → register with
/// Komorebi → read until EOF or error → unsubscribe → return.
#[cfg(windows)]
async fn subscribe_and_read(
    app: &AppHandle,
    name: &str,
    komorebic: &dyn Komorebic,
) -> anyhow::Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;

    let pipe_path = format!(r"\\.\pipe\{name}");
    let server = ServerOptions::new()
        .first_pipe_instance(true)
        .create(&pipe_path)?;

    // Register AFTER we've successfully created the pipe — otherwise
    // Komorebi may try to connect before the pipe exists.
    komorebic.subscribe_pipe(name)?;

    // Wait for Komorebi to attach. If Komorebi isn't running, this
    // future is pending until it comes up.
    server.connect().await?;

    tracing::info!(pipe = %name, "live-state pipe connected");

    let result = drain_events(app, server).await;

    // Best-effort cleanup — if komorebi is down, this errors and we
    // ignore it.
    let _ = komorebic.unsubscribe_pipe(name);

    result
}

#[cfg(not(windows))]
async fn subscribe_and_read(
    _app: &AppHandle,
    _name: &str,
    _komorebic: &dyn Komorebic,
) -> anyhow::Result<()> {
    anyhow::bail!("live-state subscription is Windows-only");
}

/// Read JSON lines from `server` and emit throttled `live-state-update`
/// events. Returns `Ok(())` on EOF (peer disconnected), `Err` on I/O
/// failure.
#[cfg(windows)]
async fn drain_events(
    app: &AppHandle,
    server: tokio::net::windows::named_pipe::NamedPipeServer,
) -> anyhow::Result<()> {
    let mut reader = BufReader::new(server);
    let mut tick = interval(Duration::from_millis(THROTTLE_MS));
    // We only care about firing AT MOST ~30 Hz; skipping missed ticks
    // is the correct behaviour for a UI throttle.
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);

    let mut latest: Option<Value> = None;
    let mut line = String::new();

    loop {
        line.clear();
        tokio::select! {
            res = reader.read_line(&mut line) => {
                let n = res?;
                if n == 0 {
                    // EOF — flush whatever's pending so the UI sees the
                    // last state before the disconnect indicator kicks in.
                    if let Some(v) = latest.take() {
                        let _ = app.emit(EVENT, v);
                    }
                    return Ok(());
                }
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                match serde_json::from_str::<Value>(trimmed) {
                    Ok(v) => { latest = Some(v); }
                    Err(err) => {
                        tracing::debug!(error = %err, "skipped non-JSON notification line");
                    }
                }
            }
            _ = tick.tick() => {
                if let Some(v) = latest.take() {
                    let _ = app.emit(EVENT, v);
                }
            }
        }
    }
}

/// A per-launch pipe name that's globally unique enough to dodge stale
/// subscriptions left by a crashed prior Komodash. UUIDs would be
/// "more correct" but `<pid>-<ms>` is already collision-free in
/// practice and avoids pulling in the uuid crate.
fn generate_pipe_name() -> String {
    format!(
        "komodash-{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_millis()
    )
}

/// Exponential backoff with [`MAX_BACKOFF`] ceiling. Public so the
/// test module can probe the curve.
pub fn next_backoff(current: Duration) -> Duration {
    let doubled = current.saturating_mul(2);
    if doubled > MAX_BACKOFF {
        MAX_BACKOFF
    } else {
        doubled
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_doubles_until_ceiling() {
        let mut b = INITIAL_BACKOFF;
        assert_eq!(b, Duration::from_millis(500));
        b = next_backoff(b);
        assert_eq!(b, Duration::from_secs(1));
        b = next_backoff(b);
        assert_eq!(b, Duration::from_secs(2));
        b = next_backoff(b);
        assert_eq!(b, Duration::from_secs(4));
    }

    #[test]
    fn backoff_caps_at_max() {
        let near_max = Duration::from_secs(20);
        let after = next_backoff(near_max);
        assert_eq!(after, MAX_BACKOFF);
        // And stays there.
        assert_eq!(next_backoff(after), MAX_BACKOFF);
    }

    #[test]
    fn backoff_handles_saturating_input() {
        let huge = Duration::from_secs(u64::MAX / 2);
        assert_eq!(next_backoff(huge), MAX_BACKOFF);
    }

    #[test]
    fn pipe_name_includes_komodash_prefix() {
        let n = generate_pipe_name();
        assert!(n.starts_with("komodash-"));
    }

    #[test]
    fn pipe_name_is_unique_per_call() {
        // Two adjacent calls in the same ms COULD collide if the
        // generator only used the timestamp, so we also include pid
        // (constant) and trust the timestamp's ms resolution. This
        // test catches the most likely regression — dropping the
        // timestamp altogether and only using pid.
        let a = generate_pipe_name();
        std::thread::sleep(Duration::from_millis(2));
        let b = generate_pipe_name();
        assert_ne!(a, b);
    }

    #[test]
    fn throttle_constant_is_thirty_hz_or_better() {
        assert!(THROTTLE_MS <= 33, "throttle should be at least 30 Hz");
    }

    #[test]
    fn max_backoff_matches_adr_0008_ceiling() {
        assert_eq!(MAX_BACKOFF, Duration::from_secs(30));
    }
}
