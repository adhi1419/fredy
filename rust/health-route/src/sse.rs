use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::Value;

/// The wire-compatible interval used by the listener heartbeat loop.
pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(25);
/// A bounded queue prevents a slow browser from blocking all publishers.
pub const DEFAULT_QUEUE_CAPACITY: usize = 32;

const HELLO_FRAME: &[u8] = b"event: hello\ndata: {\"ok\":true}\n\n";

/// A deterministic clock seam for heartbeat tests and future scheduler adapters.
pub trait HeartbeatClock: Send + Sync {
    /// Return the current Unix timestamp in milliseconds.
    fn now_millis(&self) -> u64;
}

/// The production wall clock used by the dormant listener.
pub struct SystemHeartbeatClock;

impl HeartbeatClock for SystemHeartbeatClock {
    fn now_millis(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or_default()
    }
}

type SubscriberSender = SyncSender<Vec<u8>>;
type UserSubscribers = HashMap<u64, SubscriberSender>;
type SubscriberRegistry = HashMap<String, UserSubscribers>;

struct BrokerInner {
    next_id: AtomicU64,
    subscribers: Mutex<SubscriberRegistry>,
}

/// Delivery results from a targeted publish or heartbeat tick.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct DeliveryReport {
    /// Number of subscribers that accepted the frame.
    pub delivered: usize,
    /// Number of subscribers removed because their bounded queue could not accept the frame.
    pub dropped: usize,
}

/// A reusable, per-user SSE broker.
#[derive(Clone)]
pub struct SseBroker {
    inner: Arc<BrokerInner>,
    queue_capacity: usize,
}

impl Default for SseBroker {
    fn default() -> Self {
        Self::with_queue_capacity(DEFAULT_QUEUE_CAPACITY)
    }
}

impl SseBroker {
    /// Create a broker with a bounded queue for every subscriber.
    pub fn with_queue_capacity(queue_capacity: usize) -> Self {
        assert!(queue_capacity > 0, "SSE queue capacity must be positive");
        Self {
            inner: Arc::new(BrokerInner {
                next_id: AtomicU64::new(1),
                subscribers: Mutex::new(HashMap::new()),
            }),
            queue_capacity,
        }
    }

    /// Register a user connection and enqueue the exact Node-compatible hello frame.
    pub fn subscribe(&self, user_id: impl Into<String>) -> SseSubscription {
        let user_id = user_id.into();
        let (sender, receiver) = sync_channel(self.queue_capacity);
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        let mut subscribers = self
            .inner
            .subscribers
            .lock()
            .expect("SSE broker mutex is not poisoned");
        subscribers
            .entry(user_id)
            .or_default()
            .insert(id, sender.clone());
        drop(subscribers);

        sender
            .try_send(HELLO_FRAME.to_vec())
            .expect("new SSE subscriber has room for its hello frame");

        SseSubscription {
            broker: self.clone(),
            id,
            receiver,
        }
    }

    /// Publish one JSON SSE event only to the requested user.
    pub fn publish(
        &self,
        user_id: &str,
        event: &str,
        data: &Value,
    ) -> Result<DeliveryReport, serde_json::Error> {
        let payload = serde_json::to_string(data)?;
        Ok(self.publish_frame(
            user_id,
            format!("event: {event}\ndata: {payload}\n\n").into_bytes(),
        ))
    }

    /// Run a heartbeat tick with an injected clock.
    pub fn heartbeat_with_clock(&self, clock: &dyn HeartbeatClock) -> DeliveryReport {
        self.broadcast_frame(format!(": ping {}\n\n", clock.now_millis()).into_bytes())
    }

    /// Run a heartbeat tick using the production wall clock.
    pub fn heartbeat(&self) -> DeliveryReport {
        self.heartbeat_with_clock(&SystemHeartbeatClock)
    }

    /// Return the number of currently registered connections.
    pub fn connection_count(&self) -> usize {
        self.inner
            .subscribers
            .lock()
            .expect("SSE broker mutex is not poisoned")
            .values()
            .map(HashMap::len)
            .sum()
    }

    fn publish_frame(&self, user_id: &str, frame: Vec<u8>) -> DeliveryReport {
        let targets = {
            let subscribers = self
                .inner
                .subscribers
                .lock()
                .expect("SSE broker mutex is not poisoned");
            subscribers
                .get(user_id)
                .into_iter()
                .flat_map(|connections| connections.iter())
                .map(|(id, sender)| (*id, sender.clone()))
                .collect::<Vec<_>>()
        };
        self.deliver(targets, frame)
    }

    fn broadcast_frame(&self, frame: Vec<u8>) -> DeliveryReport {
        let targets = {
            let subscribers = self
                .inner
                .subscribers
                .lock()
                .expect("SSE broker mutex is not poisoned");
            subscribers
                .values()
                .flat_map(|connections| connections.iter())
                .map(|(id, sender)| (*id, sender.clone()))
                .collect::<Vec<_>>()
        };
        self.deliver(targets, frame)
    }

    fn deliver(&self, targets: Vec<(u64, SubscriberSender)>, frame: Vec<u8>) -> DeliveryReport {
        let mut report = DeliveryReport::default();
        for (id, sender) in targets {
            match sender.try_send(frame.clone()) {
                Ok(()) => report.delivered += 1,
                Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {
                    self.remove_id(id);
                    report.dropped += 1;
                }
            }
        }
        report
    }

    fn remove_id(&self, id: u64) {
        let mut subscribers = self
            .inner
            .subscribers
            .lock()
            .expect("SSE broker mutex is not poisoned");
        subscribers.retain(|_, connections| {
            connections.remove(&id);
            !connections.is_empty()
        });
    }

    fn remove(&self, id: u64) {
        self.remove_id(id);
    }
}

/// The receiving half of a registered SSE connection.
pub struct SseSubscription {
    broker: SseBroker,
    id: u64,
    receiver: Receiver<Vec<u8>>,
}

impl SseSubscription {
    /// Receive the next frame, allowing a route adapter to probe for disconnects on timeout.
    pub fn recv_timeout(&self, timeout: Duration) -> Result<Vec<u8>, RecvTimeoutError> {
        self.receiver.recv_timeout(timeout)
    }
}

impl Drop for SseSubscription {
    fn drop(&mut self) {
        self.broker.remove(self.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FixedClock(u64);

    impl HeartbeatClock for FixedClock {
        fn now_millis(&self) -> u64 {
            self.0
        }
    }

    #[test]
    fn hello_frame_is_enqueued_on_subscription() {
        let broker = SseBroker::default();
        let subscription = broker.subscribe("alice");
        assert_eq!(
            subscription.recv_timeout(Duration::ZERO).unwrap(),
            HELLO_FRAME
        );
    }

    #[test]
    fn heartbeat_uses_the_injected_clock() {
        let broker = SseBroker::default();
        let subscription = broker.subscribe("alice");
        let _ = subscription.recv_timeout(Duration::ZERO);
        let report = broker.heartbeat_with_clock(&FixedClock(1234));
        assert_eq!(report.delivered, 1);
        assert_eq!(
            subscription.recv_timeout(Duration::ZERO).unwrap(),
            b": ping 1234\n\n"
        );
    }
}
