use std::io::{self, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use fredy_health_route::auth::{AuthBackend, AuthFailure, AuthenticatedUser};
use fredy_health_route::serve_connection_with_auth_config_and_broker;
use fredy_health_route::sse::{DeliveryReport, HeartbeatClock, SseBroker};
use serde_json::json;

const ORIGIN: &str = "https://adhi1419.github.io";
const USER_ID: &str = "uid-alice";

#[derive(Clone)]
struct FakeBackend {
    result: Result<AuthenticatedUser, AuthFailure>,
}

impl AuthBackend for FakeBackend {
    fn authenticate(&self, _id_token: &str) -> Result<AuthenticatedUser, AuthFailure> {
        self.result.clone()
    }
}

fn user() -> AuthenticatedUser {
    AuthenticatedUser {
        user_id: USER_ID.to_owned(),
        username: "alice@example.com".to_owned(),
        is_admin: false,
    }
}

fn request(authorization: Option<&str>) -> Vec<u8> {
    let authorization = authorization
        .map(|value| format!("Authorization: {value}\r\n"))
        .unwrap_or_default();
    format!(
        "GET /api/jobs/events HTTP/1.1\r\nHost: localhost\r\nOrigin: {ORIGIN}\r\n{authorization}\r\n"
    )
    .into_bytes()
}

fn error_round_trip(request: &[u8], result: Result<AuthenticatedUser, AuthFailure>) -> Vec<u8> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("test listener binds");
    let address = listener.local_addr().expect("test listener has an address");
    let broker = Arc::new(SseBroker::default());
    let server = thread::spawn(move || {
        let (stream, _) = listener
            .accept()
            .expect("test listener accepts one request");
        let backend = FakeBackend { result };
        serve_connection_with_auth_config_and_broker(
            stream,
            None,
            Some(ORIGIN),
            false,
            Some(&backend),
            broker,
        )
        .expect("error response writes");
    });

    let mut client = TcpStream::connect(address).expect("test client connects");
    client.write_all(request).expect("test request writes");
    client
        .shutdown(Shutdown::Write)
        .expect("test request closes");
    let mut response = Vec::new();
    client
        .read_to_end(&mut response)
        .expect("test response reads");
    server.join().expect("test server completes");
    response
}

fn open_connection() -> (TcpStream, Arc<SseBroker>, JoinHandle<std::io::Result<()>>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("test listener binds");
    let address = listener.local_addr().expect("test listener has an address");
    let broker = Arc::new(SseBroker::default());
    let server_broker = broker.clone();
    let server = thread::spawn(move || {
        let (stream, _) = listener
            .accept()
            .expect("test listener accepts one request");
        let backend = FakeBackend { result: Ok(user()) };
        serve_connection_with_auth_config_and_broker(
            stream,
            None,
            Some(ORIGIN),
            false,
            Some(&backend),
            server_broker,
        )
    });

    let mut client = TcpStream::connect(address).expect("test client connects");
    client
        .set_read_timeout(Some(Duration::from_secs(2)))
        .expect("test client timeout sets");
    client
        .write_all(&request(Some("Bearer firebase-token")))
        .expect("test request writes");
    (client, broker, server)
}

fn read_until(stream: &mut TcpStream, marker: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 1024];
    while !bytes.windows(marker.len()).any(|window| window == marker) {
        let count = stream.read(&mut chunk).expect("SSE bytes read");
        assert!(count > 0, "SSE stream closed before marker");
        bytes.extend_from_slice(&chunk[..count]);
    }
    bytes
}

struct FailingWriter;

impl Write for FailingWriter {
    fn write(&mut self, _buffer: &[u8]) -> io::Result<usize> {
        Err(io::Error::new(io::ErrorKind::BrokenPipe, "peer closed"))
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[test]
fn write_failure_is_returned_to_the_route_adapter() {
    let mut writer = FailingWriter;
    let error = fredy_health_route::write_sse_frame(&mut writer, b"event: jobStatus\n\n")
        .expect_err("the failing writer must surface its write error");
    assert_eq!(error.kind(), io::ErrorKind::BrokenPipe);
}

#[test]
fn sse_rejects_missing_malformed_and_invalid_bearers() {
    let cases = [
        (
            request(None),
            Ok(user()),
            b"HTTP/1.1 401 Unauthorized\r\n".as_slice(),
            br#"{"reason":"invalid authorization"}"#.as_slice(),
        ),
        (
            request(Some("Basic not-a-bearer")),
            Ok(user()),
            b"HTTP/1.1 401 Unauthorized\r\n".as_slice(),
            br#"{"reason":"invalid authorization"}"#.as_slice(),
        ),
        (
            request(Some("Bearer expired-token")),
            Err(AuthFailure::InvalidToken),
            b"HTTP/1.1 401 Unauthorized\r\n".as_slice(),
            br#"{"reason":"invalid token"}"#.as_slice(),
        ),
    ];

    for (request, result, status, body) in cases {
        let response = error_round_trip(&request, result);
        assert!(response.starts_with(status));
        assert!(response.windows(body.len()).any(|window| window == body));
    }
}

#[test]
fn authenticated_connection_matches_sse_headers_handshake_and_hello() {
    let (mut client, broker, server) = open_connection();
    let initial = read_until(&mut client, b"event: hello\ndata: {\"ok\":true}\n\n");

    assert!(initial.starts_with(b"HTTP/1.1 200 OK\r\n"));
    for header in [
        b"Vary: Origin\r\n".as_slice(),
        b"Access-Control-Allow-Origin: https://adhi1419.github.io\r\n".as_slice(),
        b"Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS\r\n".as_slice(),
        b"Access-Control-Allow-Headers: Authorization,Content-Type\r\n".as_slice(),
        b"Access-Control-Max-Age: 86400\r\n".as_slice(),
        b"Content-Type: text/event-stream\r\n".as_slice(),
        b"Cache-Control: no-cache\r\n".as_slice(),
        b"Connection: keep-alive\r\n".as_slice(),
    ] {
        assert!(initial
            .windows(header.len())
            .any(|candidate| candidate == header));
    }
    assert!(initial.ends_with(b": connected\n\nevent: hello\ndata: {\"ok\":true}\n\n"));
    assert_eq!(broker.connection_count(), 1);

    let report = broker
        .publish(USER_ID, "jobStatus", &json!({"running": true}))
        .expect("JSON event serializes");
    assert_eq!(
        report,
        DeliveryReport {
            delivered: 1,
            dropped: 0
        }
    );
    assert_eq!(
        read_until(
            &mut client,
            b"event: jobStatus\ndata: {\"running\":true}\n\n"
        ),
        b"event: jobStatus\ndata: {\"running\":true}\n\n"
    );

    drop(client);
    let _ = broker.publish(USER_ID, "jobStatus", &json!({"running": false}));
    let _ = server.join();
    assert_eq!(broker.connection_count(), 0);
}

#[test]
fn broker_isolates_users_and_targets_publish() {
    let broker = SseBroker::default();
    let alice = broker.subscribe("alice");
    let bob = broker.subscribe("bob");
    assert_eq!(
        alice.recv_timeout(Duration::ZERO).unwrap(),
        b"event: hello\ndata: {\"ok\":true}\n\n"
    );
    assert_eq!(
        bob.recv_timeout(Duration::ZERO).unwrap(),
        b"event: hello\ndata: {\"ok\":true}\n\n"
    );

    let report = broker
        .publish("alice", "jobStatus", &json!({"running": true}))
        .unwrap();
    assert_eq!(report.delivered, 1);
    assert_eq!(
        alice.recv_timeout(Duration::ZERO).unwrap(),
        b"event: jobStatus\ndata: {\"running\":true}\n\n"
    );
    assert!(bob.recv_timeout(Duration::ZERO).is_err());
}

#[test]
fn wildcard_uid_is_targeted_and_heartbeat_broadcasts_to_all_users() {
    let broker = SseBroker::default();
    let wildcard = broker.subscribe("*");
    let other = broker.subscribe("another-user");
    assert_eq!(
        wildcard.recv_timeout(Duration::ZERO).unwrap(),
        b"event: hello\ndata: {\"ok\":true}\n\n"
    );
    assert_eq!(
        other.recv_timeout(Duration::ZERO).unwrap(),
        b"event: hello\ndata: {\"ok\":true}\n\n"
    );

    let report = broker
        .publish("*", "jobStatus", &json!({"running": true}))
        .unwrap();
    assert_eq!(
        report,
        DeliveryReport {
            delivered: 1,
            dropped: 0
        }
    );
    assert_eq!(
        wildcard.recv_timeout(Duration::ZERO).unwrap(),
        b"event: jobStatus\ndata: {\"running\":true}\n\n"
    );
    assert!(other.recv_timeout(Duration::ZERO).is_err());

    let heartbeat = broker.heartbeat_with_clock(&PausedClock(Arc::new(Mutex::new(25_000))));
    assert_eq!(
        heartbeat,
        DeliveryReport {
            delivered: 2,
            dropped: 0
        }
    );
    assert_eq!(
        wildcard.recv_timeout(Duration::ZERO).unwrap(),
        b": ping 25000\n\n"
    );
    assert_eq!(
        other.recv_timeout(Duration::ZERO).unwrap(),
        b": ping 25000\n\n"
    );
}

struct PausedClock(Arc<Mutex<u64>>);

impl HeartbeatClock for PausedClock {
    fn now_millis(&self) -> u64 {
        *self.0.lock().expect("paused clock mutex is not poisoned")
    }
}

#[test]
fn heartbeat_uses_paused_time_and_exact_comment_framing() {
    let broker = SseBroker::default();
    let subscription = broker.subscribe("alice");
    let _ = subscription.recv_timeout(Duration::ZERO);
    let now = Arc::new(Mutex::new(25_000));
    let report = broker.heartbeat_with_clock(&PausedClock(now.clone()));
    assert_eq!(
        report,
        DeliveryReport {
            delivered: 1,
            dropped: 0
        }
    );
    assert_eq!(
        subscription.recv_timeout(Duration::ZERO).unwrap(),
        b": ping 25000\n\n"
    );
    *now.lock().unwrap() = 50_000;
    assert_eq!(
        broker.heartbeat_with_clock(&PausedClock(now)),
        DeliveryReport {
            delivered: 1,
            dropped: 0
        }
    );
    assert_eq!(
        subscription.recv_timeout(Duration::ZERO).unwrap(),
        b": ping 50000\n\n"
    );
}

#[test]
fn bounded_backpressure_drops_a_slow_subscriber() {
    let broker = SseBroker::with_queue_capacity(1);
    let subscription = broker.subscribe("slow");
    let report = broker
        .publish("slow", "jobStatus", &json!({"running": true}))
        .unwrap();
    assert_eq!(
        report,
        DeliveryReport {
            delivered: 0,
            dropped: 1
        }
    );
    assert_eq!(broker.connection_count(), 0);
    drop(subscription);
}

#[test]
fn dropping_a_subscription_cleans_up_the_user_entry() {
    let broker = SseBroker::default();
    let subscription = broker.subscribe("alice");
    assert_eq!(broker.connection_count(), 1);
    drop(subscription);
    assert_eq!(broker.connection_count(), 0);
    assert_eq!(
        broker
            .publish("alice", "jobStatus", &json!({}))
            .unwrap()
            .delivered,
        0
    );
}
