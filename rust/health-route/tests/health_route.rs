use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::thread;

use fredy_health_route::{serve_connection_with_config, HEALTH_BODY, NOT_FOUND_BODY};
use serde_json::Value;

fn round_trip(request: &[u8]) -> Vec<u8> {
    round_trip_with_config(request, None, None)
}

fn round_trip_with_config(
    request: &[u8],
    firebase_web_config: Option<&str>,
    frontend_origin: Option<&str>,
) -> Vec<u8> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("test listener binds");
    let address = listener.local_addr().expect("test listener has an address");
    let firebase_web_config = firebase_web_config.map(str::to_owned);
    let frontend_origin = frontend_origin.map(str::to_owned);
    let server = thread::spawn(move || {
        let (stream, _) = listener
            .accept()
            .expect("test listener accepts one request");
        serve_connection_with_config(
            stream,
            firebase_web_config.as_deref(),
            frontend_origin.as_deref(),
            false,
        )
        .expect("test response writes");
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

fn response_body(response: &[u8]) -> &[u8] {
    response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|separator| &response[separator + 4..])
        .expect("HTTP response has a header/body separator")
}

fn contract() -> Value {
    serde_json::from_str(include_str!("../../../test/wireContracts.json"))
        .expect("shared wire contract is valid JSON")
}

#[test]
fn tcp_get_health_matches_the_node_wire_contract() {
    let response = round_trip(b"GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n");

    assert!(response.starts_with(b"HTTP/1.1 200 OK\r\n"));
    let content_type = b"Content-Type: application/json; charset=utf-8\r\n";
    assert!(response
        .windows(content_type.len())
        .any(|header| header == content_type));
    assert_eq!(response_body(&response), HEALTH_BODY);
}

#[test]
fn tcp_unrelated_route_and_non_get_health_are_not_found() {
    for request in [
        b"GET /not-a-route HTTP/1.1\r\nHost: localhost\r\n\r\n".as_slice(),
        b"POST /health HTTP/1.1\r\nHost: localhost\r\n\r\n".as_slice(),
    ] {
        let response = round_trip(request);
        assert!(response.starts_with(b"HTTP/1.1 404 Not Found\r\n"));
        assert_eq!(response_body(&response), NOT_FOUND_BODY);
    }
}

#[test]
fn tcp_auth_config_consumes_shared_enabled_absent_and_invalid_cases() {
    let fixture = contract();
    let cases = fixture["http"]["authConfig"]["cases"]
        .as_array()
        .expect("auth config cases are an array");
    let origin = fixture["cors"]["allowOrigin"]
        .as_str()
        .expect("fixture has an allow origin");

    for case in cases {
        let raw_config = case["environment"]["FIREBASE_WEB_CONFIG"].as_str();
        let request =
            format!("GET /api/auth/config HTTP/1.1\r\nHost: localhost\r\nOrigin: {origin}\r\n\r\n");
        let response = round_trip_with_config(request.as_bytes(), raw_config, Some(origin));

        let status = case["status"].as_u64().expect("case status is numeric");
        assert!(response.starts_with(format!("HTTP/1.1 {status} ").as_bytes()));
        assert!(response
            .windows(b"Content-Type: application/json; charset=utf-8\r\n".len())
            .any(|header| header == b"Content-Type: application/json; charset=utf-8\r\n"));
        assert_eq!(
            response_body(&response),
            case["bodyBytes"].as_str().unwrap().as_bytes()
        );
        assert!(response
            .windows(format!("Access-Control-Allow-Origin: {origin}\r\n").len())
            .any(
                |header| header == format!("Access-Control-Allow-Origin: {origin}\r\n").as_bytes()
            ));
    }
}

#[test]
fn tcp_auth_config_keeps_exact_origin_cors_and_preflight_contract() {
    let fixture = contract();
    let auth_config = &fixture["http"]["authConfig"]["cases"][0];
    let origin = fixture["cors"]["allowOrigin"].as_str().unwrap();
    let raw_config = auth_config["environment"]["FIREBASE_WEB_CONFIG"]
        .as_str()
        .unwrap();

    let no_origin = round_trip_with_config(
        b"GET /api/auth/config HTTP/1.1\r\nHost: localhost\r\n\r\n",
        Some(raw_config),
        Some(origin),
    );
    assert!(!no_origin
        .windows(b"Access-Control-Allow-Origin:".len())
        .any(|header| header.starts_with(b"Access-Control-Allow-Origin:")));

    let denied = round_trip_with_config(
        b"GET /api/auth/config HTTP/1.1\r\nHost: localhost\r\nOrigin: https://attacker.example\r\n\r\n",
        Some(raw_config),
        Some(origin),
    );
    assert!(denied.starts_with(b"HTTP/1.1 403 Forbidden\r\n"));
    assert_eq!(response_body(&denied), br#"{"error":"CORS origin denied"}"#);
    assert!(!denied
        .windows(b"Access-Control-Allow-Origin:".len())
        .any(|header| header.starts_with(b"Access-Control-Allow-Origin:")));

    let preflight = format!(
        "OPTIONS /api/auth/config HTTP/1.1\r\nHost: localhost\r\nOrigin: {origin}\r\nAccess-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: Authorization, Content-Type\r\n\r\n"
    );
    let approved = round_trip_with_config(preflight.as_bytes(), None, Some(origin));
    assert!(approved.starts_with(b"HTTP/1.1 204 No Content\r\n"));
    assert_eq!(response_body(&approved), b"");
    assert!(approved
        .windows(b"Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS\r\n".len())
        .any(|header| header == b"Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS\r\n"));
    assert!(approved
        .windows(b"Access-Control-Allow-Headers: Authorization,Content-Type\r\n".len())
        .any(|header| header == b"Access-Control-Allow-Headers: Authorization,Content-Type\r\n"));
    assert!(approved
        .windows(b"Access-Control-Max-Age: 86400\r\n".len())
        .any(|header| header == b"Access-Control-Max-Age: 86400\r\n"));
}
