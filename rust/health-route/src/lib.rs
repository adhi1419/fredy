use serde_json::{json, Value};
use std::env;
use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::str;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

pub mod auth;

pub mod sse;

use auth::{parse_bearer, AuthBackend, AuthFailure, FirebaseAuthenticator};
use sse::{SseBroker, HEARTBEAT_INTERVAL};

/// The port used when `PORT` is missing or is not a valid non-zero port.
pub const DEFAULT_PORT: u16 = 9998;
/// The address used by the executable so Cloud Run can reach the listener.
pub const BIND_ADDRESS: &str = "0.0.0.0";
/// The exact health response body frozen by Fredy's wire contract.
pub const HEALTH_BODY: &[u8] = br#"{"status":"ok"}"#;
/// The exact API-only fallback response body frozen by Fredy's wire contract.
pub const NOT_FOUND_BODY: &[u8] = br#"{"error":"Not found"}"#;
const BAD_REQUEST_BODY: &[u8] = br#"{"error":"Bad request"}"#;
const CORS_ORIGIN_DENIED_BODY: &[u8] = br#"{"error":"CORS origin denied"}"#;
const CORS_METHOD_DENIED_BODY: &[u8] = br#"{"error":"CORS method denied"}"#;
const CORS_PREFLIGHT_DENIED_BODY: &[u8] = br#"{"error":"CORS preflight denied"}"#;
const INTERNAL_ERROR_BODY: &[u8] = br#"{"error":"Internal Server Error"}"#;
const MAX_REQUEST_BYTES: usize = 8 * 1024;
const INITIAL_REQUEST_READ_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_ACTIVE_CONNECTIONS: usize = 128;
const MAX_ACTIVE_SSE_CONNECTIONS: usize = 96;
const SERVICE_UNAVAILABLE_BODY: &[u8] = br#"{"error":"Service Unavailable"}"#;
const JSON_CONTENT_TYPE: &str = "application/json; charset=utf-8";
const ALLOWED_METHODS: [&str; 5] = ["GET", "POST", "PUT", "DELETE", "OPTIONS"];
const ALLOWED_METHODS_HEADER: &str = "GET,POST,PUT,DELETE,OPTIONS";
const ALLOWED_HEADERS: [&str; 2] = ["authorization", "content-type"];
const ALLOWED_HEADERS_HEADER: &str = "Authorization,Content-Type";

struct ConnectionAdmission {
    active: AtomicUsize,
    limit: usize,
}

impl ConnectionAdmission {
    fn new(limit: usize) -> Self {
        assert!(limit > 0, "connection admission limit must be positive");
        Self {
            active: AtomicUsize::new(0),
            limit,
        }
    }

    fn try_acquire(self: &Arc<Self>) -> Option<ConnectionPermit> {
        let mut active = self.active.load(Ordering::Relaxed);
        loop {
            if active >= self.limit {
                return None;
            }
            match self.active.compare_exchange_weak(
                active,
                active + 1,
                Ordering::AcqRel,
                Ordering::Relaxed,
            ) {
                Ok(_) => {
                    return Some(ConnectionPermit {
                        admission: Arc::clone(self),
                    });
                }
                Err(current) => active = current,
            }
        }
    }

    #[cfg(test)]
    fn active_count(&self) -> usize {
        self.active.load(Ordering::Acquire)
    }
}

struct ConnectionPermit {
    admission: Arc<ConnectionAdmission>,
}

impl Drop for ConnectionPermit {
    fn drop(&mut self) {
        self.admission.active.fetch_sub(1, Ordering::AcqRel);
    }
}

type SseAdmission = ConnectionAdmission;

/// A deterministic HTTP response used by the dormant route executable.
#[derive(Debug, PartialEq, Eq)]
pub struct HttpResponse {
    status_line: &'static str,
    body: Vec<u8>,
    content_type: bool,
    vary_origin: bool,
    allow_origin: Option<String>,
}

impl HttpResponse {
    fn json(status_line: &'static str, body: impl Into<Vec<u8>>) -> Self {
        Self {
            status_line,
            body: body.into(),
            content_type: true,
            vary_origin: false,
            allow_origin: None,
        }
    }

    fn empty(status_line: &'static str) -> Self {
        Self {
            status_line,
            body: Vec::new(),
            content_type: false,
            vary_origin: false,
            allow_origin: None,
        }
    }

    fn with_cors(mut self, allow_origin: Option<&str>) -> Self {
        self.vary_origin = true;
        self.allow_origin = allow_origin.map(str::to_owned);
        self
    }

    fn write_to<W: Write>(&self, mut writer: W) -> io::Result<()> {
        write!(writer, "{}\r\n", self.status_line)?;
        if self.vary_origin {
            writer.write_all(b"Vary: Origin\r\n")?;
        }
        if self.content_type {
            write!(writer, "Content-Type: {JSON_CONTENT_TYPE}\r\n")?;
        }
        if let Some(origin) = &self.allow_origin {
            write!(writer, "Access-Control-Allow-Origin: {origin}\r\n")?;
            write!(
                writer,
                "Access-Control-Allow-Methods: {ALLOWED_METHODS_HEADER}\r\n"
            )?;
            write!(
                writer,
                "Access-Control-Allow-Headers: {ALLOWED_HEADERS_HEADER}\r\n"
            )?;
            writer.write_all(b"Access-Control-Max-Age: 86400\r\n")?;
        }
        write!(
            writer,
            "Content-Length: {}\r\nConnection: close\r\n\r\n",
            self.body.len()
        )?;
        writer.write_all(&self.body)
    }
}

struct HttpRequest<'a> {
    method: &'a str,
    target: &'a str,
    origin: Option<&'a str>,
    requested_method: Option<&'a str>,
    requested_headers: Option<&'a str>,
    authorization_values: Vec<&'a str>,
}

/// Resolves a request without request headers, retaining the original health/fallback API.
pub fn response_for(method: &str, target: &str) -> HttpResponse {
    response_for_with_config(method, target, None)
}

/// Resolves a request with a supplied Firebase web-config value for deterministic tests.
pub fn response_for_with_config(
    method: &str,
    target: &str,
    firebase_web_config: Option<&str>,
) -> HttpResponse {
    response_for_request(
        HttpRequest {
            method,
            target,
            origin: None,
            requested_method: None,
            requested_headers: None,
            authorization_values: Vec::new(),
        },
        firebase_web_config,
        None,
        false,
        None,
    )
}

fn response_for_request(
    request: HttpRequest<'_>,
    firebase_web_config: Option<&str>,
    frontend_origin: Option<&str>,
    production: bool,
    auth_backend: Option<&dyn AuthBackend>,
) -> HttpResponse {
    let response = match (request.method, request.target) {
        ("GET", "/api/auth/config") => auth_config_response(firebase_web_config),
        ("GET", "/api/auth/me") => auth_me_response(&request, auth_backend),
        ("GET", "/health") => HttpResponse::json("HTTP/1.1 200 OK", HEALTH_BODY),
        _ => HttpResponse::json("HTTP/1.1 404 Not Found", NOT_FOUND_BODY),
    };
    apply_cors(request, response, frontend_origin, production)
}

fn auth_config_response(firebase_web_config: Option<&str>) -> HttpResponse {
    let config = firebase_web_config.and_then(|raw| serde_json::from_str::<Value>(raw).ok());
    let enabled = config.as_ref().is_some_and(|value| !value.is_null());
    let body = serde_json::to_vec(&json!({
        "enabled": enabled,
        "firebaseConfig": config,
    }))
    .unwrap_or_else(|_| br#"{"enabled":false,"firebaseConfig":null}"#.to_vec());
    HttpResponse::json("HTTP/1.1 200 OK", body)
}

fn authenticate_request(
    request: &HttpRequest<'_>,
    auth_backend: Option<&dyn AuthBackend>,
) -> Result<auth::AuthenticatedUser, AuthFailure> {
    let token = parse_bearer(&request.authorization_values)?;
    let Some(auth_backend) = auth_backend else {
        return Err(AuthFailure::Dependency);
    };
    auth_backend.authenticate(token)
}

fn write_sse_headers(stream: &mut TcpStream, allow_origin: Option<&str>) -> io::Result<()> {
    stream.write_all(b"HTTP/1.1 200 OK\r\nVary: Origin\r\n")?;
    if let Some(origin) = allow_origin {
        write!(stream, "Access-Control-Allow-Origin: {origin}\r\n")?;
        write!(
            stream,
            "Access-Control-Allow-Methods: {ALLOWED_METHODS_HEADER}\r\n"
        )?;
        write!(
            stream,
            "Access-Control-Allow-Headers: {ALLOWED_HEADERS_HEADER}\r\n"
        )?;
        stream.write_all(b"Access-Control-Max-Age: 86400\r\n")?;
    }
    stream.write_all(
        b"Content-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n",
    )
}

fn peer_closed(stream: &TcpStream) -> bool {
    let mut byte = [0_u8; 1];
    match stream.peek(&mut byte) {
        Ok(0) => true,
        Ok(_) => false,
        Err(error)
            if error.kind() == io::ErrorKind::WouldBlock
                || error.kind() == io::ErrorKind::TimedOut =>
        {
            false
        }
        Err(_) => true,
    }
}

/// Write and flush one SSE frame through an injectable writer.
pub fn write_sse_frame<W: Write>(writer: &mut W, frame: &[u8]) -> io::Result<()> {
    writer.write_all(frame)?;
    writer.flush()
}

fn serve_sse_connection(
    mut stream: TcpStream,
    request: HttpRequest<'_>,
    frontend_origin: Option<&str>,
    production: bool,
    auth_backend: Option<&dyn AuthBackend>,
    broker: Arc<SseBroker>,
    sse_admission: Option<Arc<SseAdmission>>,
) -> io::Result<()> {
    let user = match authenticate_request(&request, auth_backend) {
        Ok(user) => user,
        Err(failure) => {
            let response = apply_cors(
                request,
                auth_failure_response(failure),
                frontend_origin,
                production,
            );
            return response.write_to(&mut stream);
        }
    };

    let sse_permit = match sse_admission {
        Some(admission) => match admission.try_acquire() {
            Some(permit) => Some(permit),
            None => {
                return apply_cors(
                    request,
                    HttpResponse::json(
                        "HTTP/1.1 503 Service Unavailable",
                        SERVICE_UNAVAILABLE_BODY,
                    ),
                    frontend_origin,
                    production,
                )
                .write_to(&mut stream);
            }
        },
        None => None,
    };

    let cors = apply_cors(
        request,
        HttpResponse::empty("HTTP/1.1 200 OK"),
        frontend_origin,
        production,
    );
    if cors.status_line != "HTTP/1.1 200 OK" {
        return cors.write_to(&mut stream);
    }

    let _sse_permit = sse_permit;
    write_sse_headers(&mut stream, cors.allow_origin.as_deref())?;
    stream.write_all(b": connected\n\n")?;
    let subscription = broker.subscribe(user.user_id);
    stream.set_read_timeout(Some(Duration::from_millis(250)))?;

    loop {
        match subscription.recv_timeout(Duration::from_millis(250)) {
            Ok(frame) => {
                write_sse_frame(&mut stream, &frame)?;
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if peer_closed(&stream) {
                    return Ok(());
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return Ok(()),
        }
    }
}

fn auth_me_response(
    request: &HttpRequest<'_>,
    auth_backend: Option<&dyn AuthBackend>,
) -> HttpResponse {
    let token = match parse_bearer(&request.authorization_values) {
        Ok(token) => token,
        Err(failure) => return auth_failure_response(failure),
    };
    let Some(auth_backend) = auth_backend else {
        return auth_failure_response(AuthFailure::Dependency);
    };
    match auth_backend.authenticate(token) {
        Ok(user) => HttpResponse::json(
            "HTTP/1.1 200 OK",
            serde_json::to_vec(&json!({
                "userId": user.user_id,
                "username": user.username,
                "isAdmin": user.is_admin,
            }))
            .unwrap_or_else(|_| INTERNAL_ERROR_BODY.to_vec()),
        ),
        Err(failure) => auth_failure_response(failure),
    }
}

fn auth_failure_response(failure: AuthFailure) -> HttpResponse {
    match failure {
        AuthFailure::InvalidAuthorization => HttpResponse::json(
            "HTTP/1.1 401 Unauthorized",
            br#"{"reason":"invalid authorization"}"#,
        ),
        AuthFailure::InvalidToken => HttpResponse::json(
            "HTTP/1.1 401 Unauthorized",
            br#"{"reason":"invalid token"}"#,
        ),
        AuthFailure::InvalidClaims => HttpResponse::json(
            "HTTP/1.1 401 Unauthorized",
            br#"{"reason":"invalid token claims"}"#,
        ),
        AuthFailure::NotAllowed => {
            HttpResponse::json("HTTP/1.1 403 Forbidden", br#"{"reason":"not allowed"}"#)
        }
        AuthFailure::Dependency => {
            HttpResponse::json("HTTP/1.1 500 Internal Server Error", INTERNAL_ERROR_BODY)
        }
    }
}

fn apply_cors(
    request: HttpRequest<'_>,
    response: HttpResponse,
    frontend_origin: Option<&str>,
    production: bool,
) -> HttpResponse {
    let Some(origin) = request.origin else {
        return response.with_cors(None);
    };

    let Some(configured_origin) = frontend_origin.filter(|origin| !origin.is_empty()) else {
        return if production {
            cors_error("HTTP/1.1 403 Forbidden", CORS_ORIGIN_DENIED_BODY)
        } else {
            response.with_cors(None)
        };
    };

    if origin != configured_origin {
        return cors_error("HTTP/1.1 403 Forbidden", CORS_ORIGIN_DENIED_BODY);
    }
    if !ALLOWED_METHODS.contains(&request.method) {
        return cors_error("HTTP/1.1 403 Forbidden", CORS_METHOD_DENIED_BODY);
    }
    if request.method == "OPTIONS"
        && !is_allowed_preflight(request.requested_method, request.requested_headers)
    {
        return cors_error("HTTP/1.1 403 Forbidden", CORS_PREFLIGHT_DENIED_BODY);
    }
    if request.method == "OPTIONS" {
        return HttpResponse::empty("HTTP/1.1 204 No Content").with_cors(Some(configured_origin));
    }
    response.with_cors(Some(configured_origin))
}

fn cors_error(status_line: &'static str, body: &'static [u8]) -> HttpResponse {
    HttpResponse::json(status_line, body).with_cors(None)
}

fn is_allowed_preflight(requested_method: Option<&str>, requested_headers: Option<&str>) -> bool {
    let Some(method) = requested_method else {
        return false;
    };
    if !ALLOWED_METHODS.contains(&method.to_ascii_uppercase().as_str()) {
        return false;
    }
    requested_headers
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|header| !header.is_empty())
        .all(|header| ALLOWED_HEADERS.contains(&header.to_ascii_lowercase().as_str()))
}

/// Applies the runtime contract's `PORT` parsing and `9998` fallback.
pub fn port_from_value(value: Option<&str>) -> u16 {
    value
        .and_then(|port| port.parse::<u16>().ok())
        .filter(|port| *port != 0)
        .unwrap_or(DEFAULT_PORT)
}

/// Reads `PORT` from the process environment using the runtime contract fallback.
pub fn port_from_env() -> u16 {
    port_from_value(env::var("PORT").ok().as_deref())
}

fn parse_request(request: &[u8]) -> Option<HttpRequest<'_>> {
    let text = str::from_utf8(request).ok()?;
    let mut lines = text.split('\n');
    let request_line = lines.next()?.trim_end_matches('\r');
    let mut fields = request_line.split_whitespace();
    let method = fields.next()?;
    let target = fields.next()?;
    fields.next()?;
    if fields.next().is_some() {
        return None;
    }

    let mut origin = None;
    let mut requested_method = None;
    let mut requested_headers = None;
    let mut authorization_values = Vec::new();
    for line in lines {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            break;
        }
        let (name, value) = line.split_once(':')?;
        let value = value.trim();
        match name.trim().to_ascii_lowercase().as_str() {
            "origin" => origin = Some(value),
            "access-control-request-method" => requested_method = Some(value),
            "access-control-request-headers" => requested_headers = Some(value),
            "authorization" => authorization_values.push(value),
            _ => {}
        }
    }
    Some(HttpRequest {
        method,
        target,
        origin,
        requested_method,
        requested_headers,
        authorization_values,
    })
}

/// Handles one HTTP connection using the process environment and closes it after one response.
pub fn serve_connection(stream: TcpStream) -> io::Result<()> {
    let firebase_web_config = env::var("FIREBASE_WEB_CONFIG").ok();
    let frontend_origin = env::var("FRONTEND_ORIGIN").ok();
    let production = matches!(env::var("NODE_ENV").as_deref(), Ok("production"));
    let auth_backend = FirebaseAuthenticator::from_environment().ok();
    serve_connection_with_auth_config(
        stream,
        firebase_web_config.as_deref(),
        frontend_origin.as_deref(),
        production,
        auth_backend
            .as_ref()
            .map(|backend| backend as &dyn AuthBackend),
    )
}

/// Handles one HTTP connection with explicit configuration for deterministic parity tests.
pub fn serve_connection_with_config(
    stream: TcpStream,
    firebase_web_config: Option<&str>,
    frontend_origin: Option<&str>,
    production: bool,
) -> io::Result<()> {
    serve_connection_with_auth_config(
        stream,
        firebase_web_config,
        frontend_origin,
        production,
        None,
    )
}

/// Handles one HTTP connection with an injectable authentication backend.
pub fn serve_connection_with_auth_config(
    stream: TcpStream,
    firebase_web_config: Option<&str>,
    frontend_origin: Option<&str>,
    production: bool,
    auth_backend: Option<&dyn AuthBackend>,
) -> io::Result<()> {
    serve_connection_with_optional_broker(
        stream,
        firebase_web_config,
        frontend_origin,
        production,
        auth_backend,
        None,
        None,
        INITIAL_REQUEST_READ_TIMEOUT,
    )
}

/// Handles one connection with a reusable broker for the authenticated SSE route.
pub fn serve_connection_with_auth_config_and_broker(
    stream: TcpStream,
    firebase_web_config: Option<&str>,
    frontend_origin: Option<&str>,
    production: bool,
    auth_backend: Option<&dyn AuthBackend>,
    broker: Arc<SseBroker>,
) -> io::Result<()> {
    serve_connection_with_optional_broker(
        stream,
        firebase_web_config,
        frontend_origin,
        production,
        auth_backend,
        Some(broker),
        None,
        INITIAL_REQUEST_READ_TIMEOUT,
    )
}

#[expect(
    clippy::too_many_arguments,
    reason = "keeps the short timeout and broker seams independently injectable"
)]
fn serve_connection_with_optional_broker(
    mut stream: TcpStream,
    firebase_web_config: Option<&str>,
    frontend_origin: Option<&str>,
    production: bool,
    auth_backend: Option<&dyn AuthBackend>,
    broker: Option<Arc<SseBroker>>,
    sse_admission: Option<Arc<SseAdmission>>,
    initial_request_read_timeout: Duration,
) -> io::Result<()> {
    stream.set_read_timeout(Some(initial_request_read_timeout))?;
    let mut request = [0_u8; MAX_REQUEST_BYTES];
    let bytes_read = stream.read(&mut request)?;
    let Some(request) = parse_request(&request[..bytes_read]) else {
        return HttpResponse::json("HTTP/1.1 400 Bad Request", BAD_REQUEST_BODY)
            .write_to(&mut stream);
    };

    if request.method == "GET" && request.target == "/api/jobs/events" {
        if let Some(broker) = broker {
            return serve_sse_connection(
                stream,
                request,
                frontend_origin,
                production,
                auth_backend,
                broker,
                sse_admission,
            );
        }
    }

    response_for_request(
        request,
        firebase_web_config,
        frontend_origin,
        production,
        auth_backend,
    )
    .write_to(&mut stream)
}

fn reject_at_capacity(mut stream: TcpStream) {
    let _ = HttpResponse::json("HTTP/1.1 503 Service Unavailable", SERVICE_UNAVAILABLE_BODY)
        .write_to(&mut stream);
}

/// Serves connections concurrently and emits broker heartbeats every 25 seconds.
pub fn serve_listener(listener: TcpListener) -> io::Result<()> {
    let auth_backend: Option<Arc<dyn AuthBackend>> = FirebaseAuthenticator::from_environment()
        .ok()
        .map(|backend| Arc::new(backend) as Arc<dyn AuthBackend>);
    let firebase_web_config = env::var("FIREBASE_WEB_CONFIG").ok();
    let frontend_origin = env::var("FRONTEND_ORIGIN").ok();
    let production = matches!(env::var("NODE_ENV").as_deref(), Ok("production"));
    let broker = Arc::new(SseBroker::default());
    let admission = Arc::new(ConnectionAdmission::new(MAX_ACTIVE_CONNECTIONS));
    let sse_admission = Arc::new(SseAdmission::new(MAX_ACTIVE_SSE_CONNECTIONS));

    let heartbeat_broker = Arc::clone(&broker);
    thread::spawn(move || loop {
        thread::sleep(HEARTBEAT_INTERVAL);
        heartbeat_broker.heartbeat();
    });

    for stream in listener.incoming() {
        let stream = stream?;
        let Some(permit) = admission.try_acquire() else {
            reject_at_capacity(stream);
            continue;
        };
        let auth_backend = auth_backend.clone();
        let firebase_web_config = firebase_web_config.clone();
        let frontend_origin = frontend_origin.clone();
        let broker = Arc::clone(&broker);
        let sse_admission = Arc::clone(&sse_admission);
        thread::spawn(move || {
            let _permit = permit;
            let _ = serve_connection_with_optional_broker(
                stream,
                firebase_web_config.as_deref(),
                frontend_origin.as_deref(),
                production,
                auth_backend.as_deref(),
                Some(broker),
                Some(sse_admission),
                INITIAL_REQUEST_READ_TIMEOUT,
            );
        });
    }
    Ok(())
}

/// Binds the dormant executable to the Cloud Run-compatible address and port.
pub fn run() -> io::Result<()> {
    let listener = TcpListener::bind((BIND_ADDRESS, port_from_env()))?;
    serve_listener(listener)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::AuthenticatedUser;
    use std::net::Shutdown;

    fn serialized(response: &HttpResponse) -> Vec<u8> {
        let mut bytes = Vec::new();
        response
            .write_to(&mut bytes)
            .expect("in-memory writes cannot fail");
        bytes
    }

    #[test]
    fn health_response_matches_exact_wire_bytes() {
        let response = response_for("GET", "/health");
        let bytes = serialized(&response);

        assert_eq!(response.status_line, "HTTP/1.1 200 OK");
        assert_eq!(response.body, HEALTH_BODY);
        assert_eq!(
            bytes,
            b"HTTP/1.1 200 OK\r\nVary: Origin\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: 15\r\nConnection: close\r\n\r\n{\"status\":\"ok\"}"
        );
    }

    #[test]
    fn auth_config_serializes_nested_json_without_hand_rolled_escaping() {
        let response = response_for_with_config(
            "GET",
            "/api/auth/config",
            Some(r#"{"apiKey":"public-\"key","nested":{"path":"a\\b"}}"#),
        );

        assert_eq!(response.status_line, "HTTP/1.1 200 OK");
        assert_eq!(
            response.body,
            br#"{"enabled":true,"firebaseConfig":{"apiKey":"public-\"key","nested":{"path":"a\\b"}}}"#
        );
    }

    #[test]
    fn auth_config_absent_or_invalid_config_is_disabled() {
        for raw in [None, Some("not-json")] {
            let response = response_for_with_config("GET", "/api/auth/config", raw);
            assert_eq!(response.body, br#"{"enabled":false,"firebaseConfig":null}"#);
        }
    }

    #[test]
    fn unrelated_paths_and_methods_return_api_only_not_found() {
        assert_eq!(
            response_for("GET", "/not-a-route").status_line,
            "HTTP/1.1 404 Not Found"
        );
        assert_eq!(
            response_for("POST", "/health").status_line,
            "HTTP/1.1 404 Not Found"
        );
        assert_eq!(response_for("GET", "/health?probe=1").body, NOT_FOUND_BODY);
    }

    #[test]
    fn port_fallback_is_deterministic() {
        assert_eq!(port_from_value(None), DEFAULT_PORT);
        assert_eq!(port_from_value(Some("")), DEFAULT_PORT);
        assert_eq!(port_from_value(Some("not-a-port")), DEFAULT_PORT);
        assert_eq!(port_from_value(Some("0")), DEFAULT_PORT);
        assert_eq!(port_from_value(Some("8123")), 8123);
    }

    #[test]
    fn connection_admission_refuses_at_capacity_and_recovers() {
        let admission = Arc::new(ConnectionAdmission::new(1));
        let permit = admission
            .try_acquire()
            .expect("first connection is admitted");
        assert_eq!(admission.active_count(), 1);
        assert!(
            admission.try_acquire().is_none(),
            "capacity must refuse a second connection"
        );

        drop(permit);
        assert_eq!(admission.active_count(), 0);
        let recovered = admission
            .try_acquire()
            .expect("capacity recovers after cleanup");
        assert_eq!(admission.active_count(), 1);
        drop(recovered);
        assert_eq!(admission.active_count(), 0);
    }

    #[test]
    fn production_initial_request_timeout_is_seconds_scale() {
        assert_eq!(INITIAL_REQUEST_READ_TIMEOUT, Duration::from_secs(5));
        assert!(INITIAL_REQUEST_READ_TIMEOUT >= Duration::from_secs(1));
    }

    #[test]
    fn idle_initial_request_times_out_and_releases_admission() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("test listener binds");
        let address = listener.local_addr().expect("test listener has an address");
        let admission = Arc::new(ConnectionAdmission::new(1));
        let server_admission = Arc::clone(&admission);
        let server = thread::spawn(move || {
            let (stream, _) = listener
                .accept()
                .expect("test listener accepts one connection");
            let _permit = server_admission
                .try_acquire()
                .expect("idle connection is admitted before the timeout");
            serve_connection_with_optional_broker(
                stream,
                None,
                None,
                false,
                None,
                None,
                None,
                Duration::from_millis(10),
            )
        });

        let client = TcpStream::connect(address).expect("test client connects");
        let error = server
            .join()
            .expect("timeout server thread completes")
            .expect_err("idle connection must time out before request parsing");
        assert!(matches!(
            error.kind(),
            io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock
        ));
        drop(client);
        assert_eq!(admission.active_count(), 0);
    }

    struct AllowBackend;

    impl AuthBackend for AllowBackend {
        fn authenticate(&self, _id_token: &str) -> Result<AuthenticatedUser, AuthFailure> {
            Ok(AuthenticatedUser {
                user_id: "uid-test".to_owned(),
                username: "test@example.com".to_owned(),
                is_admin: false,
            })
        }
    }

    fn route_round_trip(
        request: &'static [u8],
        admission: Arc<ConnectionAdmission>,
        broker: Arc<SseBroker>,
        sse_admission: Arc<SseAdmission>,
    ) -> Vec<u8> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("test listener binds");
        let address = listener.local_addr().expect("test listener has an address");
        let server = thread::spawn(move || {
            let (stream, _) = listener
                .accept()
                .expect("test listener accepts one request");
            let _permit = admission
                .try_acquire()
                .expect("route test request has total capacity");
            let backend = AllowBackend;
            serve_connection_with_optional_broker(
                stream,
                None,
                None,
                false,
                Some(&backend),
                Some(broker),
                Some(sse_admission),
                Duration::from_millis(50),
            )
            .expect("route response writes");
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

    #[test]
    fn full_sse_capacity_preserves_ordinary_route_capacity_and_recovers() {
        let total = Arc::new(ConnectionAdmission::new(4));
        let sse = Arc::new(SseAdmission::new(2));
        let broker = Arc::new(SseBroker::default());
        let sse_total_one = total.try_acquire().expect("first SSE total permit");
        let sse_total_two = total.try_acquire().expect("second SSE total permit");
        let sse_one = sse.try_acquire().expect("first SSE permit");
        let sse_two = sse.try_acquire().expect("second SSE permit");

        let ordinary_one = total
            .try_acquire()
            .expect("reserved capacity admits an ordinary request");
        drop(ordinary_one);
        let health_response = route_round_trip(
            b"GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n",
            Arc::clone(&total),
            Arc::clone(&broker),
            Arc::clone(&sse),
        );
        assert!(health_response.starts_with(b"HTTP/1.1 200 OK\r\n"));
        assert!(
            health_response
                .windows(HEALTH_BODY.len())
                .any(|window| window == HEALTH_BODY),
            "ordinary health route remains available while SSE is full"
        );

        let excess_sse_response = route_round_trip(
            b"GET /api/jobs/events HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer test\r\n\r\n",
            Arc::clone(&total),
            Arc::clone(&broker),
            Arc::clone(&sse),
        );
        assert!(excess_sse_response.starts_with(b"HTTP/1.1 503 Service Unavailable\r\n"));
        assert!(
            excess_sse_response
                .windows(SERVICE_UNAVAILABLE_BODY.len())
                .any(|window| window == SERVICE_UNAVAILABLE_BODY),
            "excess authenticated SSE is refused at the route boundary"
        );

        drop(sse_one);
        drop(sse_two);
        drop(sse_total_one);
        drop(sse_total_two);
        assert_eq!(sse.active_count(), 0);
        assert_eq!(total.active_count(), 0);
        let recovered = sse
            .try_acquire()
            .expect("SSE capacity recovers on disconnect");
        drop(recovered);
    }

    #[test]
    fn idle_initial_connections_are_bounded_by_total_pre_auth_capacity() {
        let admission = Arc::new(ConnectionAdmission::new(1));
        let permit = admission
            .try_acquire()
            .expect("first idle socket is bounded");
        assert!(
            admission.try_acquire().is_none(),
            "a second idle unauthenticated socket cannot exceed the pre-auth cap"
        );
        drop(permit);
        assert_eq!(admission.active_count(), 0);
    }

    #[test]
    fn listener_address_is_cloud_run_compatible() {
        assert_eq!(BIND_ADDRESS, "0.0.0.0");
    }
}
