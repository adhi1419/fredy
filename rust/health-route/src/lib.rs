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
const MAX_REQUEST_BYTES: usize = 8 * 1024;

/// A small fixed JSON response used by the dormant route.
#[derive(Debug, PartialEq, Eq)]
pub struct HttpResponse {
    status_line: &'static str,
    body: &'static [u8],
}

impl HttpResponse {
    fn new(status_line: &'static str, body: &'static [u8]) -> Self {
        Self { status_line, body }
    }

    fn write_to<W: Write>(&self, mut writer: W) -> io::Result<()> {
        write!(
            writer,
            "{}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            self.status_line,
            self.body.len()
        )?;
        writer.write_all(self.body)
    }
}

/// Resolves a request to the only route currently implemented by this executable.
pub fn response_for(method: &str, target: &str) -> HttpResponse {
    match (method, target) {
        ("GET", "/health") => HttpResponse::new("HTTP/1.1 200 OK", HEALTH_BODY),
        _ => HttpResponse::new("HTTP/1.1 404 Not Found", NOT_FOUND_BODY),
    }
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

fn parse_request_line(request: &[u8]) -> Option<(&str, &str)> {
    let line_end = request
        .windows(2)
        .position(|window| window == b"\r\n")
        .or_else(|| request.iter().position(|byte| *byte == b'\n'))?;
    let line = str::from_utf8(&request[..line_end]).ok()?;
    let mut fields = line.split_whitespace();
    let method = fields.next()?;
    let target = fields.next()?;
    fields.next()?;
    if fields.next().is_some() {
        return None;
    }
    Some((method, target))
}

/// Handles one HTTP connection and closes it after one deterministic response.
pub fn serve_connection(mut stream: TcpStream) -> io::Result<()> {
    let mut request = [0_u8; MAX_REQUEST_BYTES];
    let bytes_read = stream.read(&mut request)?;
    let response = parse_request_line(&request[..bytes_read]).map_or_else(
        || HttpResponse::new("HTTP/1.1 400 Bad Request", BAD_REQUEST_BODY),
        |(method, target)| response_for(method, target),
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
