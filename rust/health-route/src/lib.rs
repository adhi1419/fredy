use serde_json::{json, Value};
use std::env;
use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::str;

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
const MAX_REQUEST_BYTES: usize = 8 * 1024;
const JSON_CONTENT_TYPE: &str = "application/json; charset=utf-8";
const ALLOWED_METHODS: [&str; 5] = ["GET", "POST", "PUT", "DELETE", "OPTIONS"];
const ALLOWED_METHODS_HEADER: &str = "GET,POST,PUT,DELETE,OPTIONS";
const ALLOWED_HEADERS: [&str; 2] = ["authorization", "content-type"];
const ALLOWED_HEADERS_HEADER: &str = "Authorization,Content-Type";

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
        },
        firebase_web_config,
        None,
        false,
    )
}

fn response_for_request(
    request: HttpRequest<'_>,
    firebase_web_config: Option<&str>,
    frontend_origin: Option<&str>,
    production: bool,
) -> HttpResponse {
    if request.target == "/api/auth/config" {
        let response = if request.method == "GET" {
            auth_config_response(firebase_web_config).with_cors(None)
        } else {
            HttpResponse::json("HTTP/1.1 404 Not Found", NOT_FOUND_BODY)
        };
        return apply_cors(request, response, frontend_origin, production);
    }

    match (request.method, request.target) {
        ("GET", "/health") => HttpResponse::json("HTTP/1.1 200 OK", HEALTH_BODY),
        _ => HttpResponse::json("HTTP/1.1 404 Not Found", NOT_FOUND_BODY),
    }
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
            _ => {}
        }
    }
    Some(HttpRequest {
        method,
        target,
        origin,
        requested_method,
        requested_headers,
    })
}

/// Handles one HTTP connection using the process environment and closes it after one response.
pub fn serve_connection(stream: TcpStream) -> io::Result<()> {
    let firebase_web_config = env::var("FIREBASE_WEB_CONFIG").ok();
    let frontend_origin = env::var("FRONTEND_ORIGIN").ok();
    let production = matches!(env::var("NODE_ENV").as_deref(), Ok("production"));
    serve_connection_with_config(
        stream,
        firebase_web_config.as_deref(),
        frontend_origin.as_deref(),
        production,
    )
}

/// Handles one HTTP connection with explicit configuration for deterministic parity tests.
pub fn serve_connection_with_config(
    mut stream: TcpStream,
    firebase_web_config: Option<&str>,
    frontend_origin: Option<&str>,
    production: bool,
) -> io::Result<()> {
    let mut request = [0_u8; MAX_REQUEST_BYTES];
    let bytes_read = stream.read(&mut request)?;
    let response = parse_request(&request[..bytes_read]).map_or_else(
        || HttpResponse::json("HTTP/1.1 400 Bad Request", BAD_REQUEST_BODY),
        |request| response_for_request(request, firebase_web_config, frontend_origin, production),
    );
    response.write_to(&mut stream)
}

/// Serves connections serially until the listener returns an accept error.
pub fn serve_listener(listener: TcpListener) -> io::Result<()> {
    for stream in listener.incoming() {
        serve_connection(stream?)?;
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
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: 15\r\nConnection: close\r\n\r\n{\"status\":\"ok\"}"
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
    fn listener_address_is_cloud_run_compatible() {
        assert_eq!(BIND_ADDRESS, "0.0.0.0");
    }
}
