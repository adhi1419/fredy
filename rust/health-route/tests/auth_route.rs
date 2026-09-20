use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::thread;

use fredy_health_route::auth::{AuthBackend, AuthFailure, AuthenticatedUser};
use fredy_health_route::serve_connection_with_auth_config;

const ORIGIN: &str = "https://adhi1419.github.io";

struct FakeBackend {
    result: Result<AuthenticatedUser, AuthFailure>,
}

impl AuthBackend for FakeBackend {
    fn authenticate(&self, _id_token: &str) -> Result<AuthenticatedUser, AuthFailure> {
        self.result.clone()
    }
}

fn round_trip(request: &[u8], result: Result<AuthenticatedUser, AuthFailure>) -> Vec<u8> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("test listener binds");
    let address = listener.local_addr().expect("test listener has an address");
    let server = thread::spawn(move || {
        let (stream, _) = listener
            .accept()
            .expect("test listener accepts one request");
        let backend = FakeBackend { result };
        serve_connection_with_auth_config(stream, None, Some(ORIGIN), false, Some(&backend))
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

fn body(response: &[u8]) -> &[u8] {
    let separator = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .expect("HTTP response has a header/body separator");
    &response[separator + 4..]
}

fn has_header(response: &[u8], header: &[u8]) -> bool {
    response
        .windows(header.len())
        .any(|candidate| candidate == header)
}

fn user() -> AuthenticatedUser {
    AuthenticatedUser {
        user_id: "uid-alice".to_owned(),
        username: "alice@example.com".to_owned(),
        is_admin: false,
    }
}

#[test]
fn auth_me_success_matches_node_body_and_cors() {
    let response = round_trip(
        b"GET /api/auth/me HTTP/1.1\r\nHost: localhost\r\nOrigin: https://adhi1419.github.io\r\nAuthorization: Bearer firebase-token\r\n\r\n",
        Ok(user()),
    );

    assert!(response.starts_with(b"HTTP/1.1 200 OK\r\n"));
    assert_eq!(
        body(&response),
        br#"{"userId":"uid-alice","username":"alice@example.com","isAdmin":false}"#
    );
    assert!(has_header(&response, b"Vary: Origin\r\n"));
    assert!(has_header(
        &response,
        b"Access-Control-Allow-Origin: https://adhi1419.github.io\r\n"
    ));
    assert!(has_header(
        &response,
        b"Access-Control-Allow-Headers: Authorization,Content-Type\r\n"
    ));
}

#[test]
fn auth_me_maps_exact_auth_failures() {
    let cases = [
        (
            b"GET /api/auth/me HTTP/1.1\r\nHost: localhost\r\n\r\n".as_slice(),
            Ok(user()),
            b"HTTP/1.1 401 Unauthorized\r\n".as_slice(),
            br#"{"reason":"invalid authorization"}"#.as_slice(),
        ),
        (
            b"GET /api/auth/me HTTP/1.1\r\nHost: localhost\r\nAuthorization: Basic token\r\n\r\n"
                .as_slice(),
            Ok(user()),
            b"HTTP/1.1 401 Unauthorized\r\n".as_slice(),
            br#"{"reason":"invalid authorization"}"#.as_slice(),
        ),
        (
            b"GET /api/auth/me HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer token\r\n\r\n"
                .as_slice(),
            Err(AuthFailure::InvalidToken),
            b"HTTP/1.1 401 Unauthorized\r\n".as_slice(),
            br#"{"reason":"invalid token"}"#.as_slice(),
        ),
        (
            b"GET /api/auth/me HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer token\r\n\r\n"
                .as_slice(),
            Err(AuthFailure::InvalidClaims),
            b"HTTP/1.1 401 Unauthorized\r\n".as_slice(),
            br#"{"reason":"invalid token claims"}"#.as_slice(),
        ),
        (
            b"GET /api/auth/me HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer token\r\n\r\n"
                .as_slice(),
            Err(AuthFailure::NotAllowed),
            b"HTTP/1.1 403 Forbidden\r\n".as_slice(),
            br#"{"reason":"not allowed"}"#.as_slice(),
        ),
        (
            b"GET /api/auth/me HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer token\r\n\r\n"
                .as_slice(),
            Err(AuthFailure::Dependency),
            b"HTTP/1.1 500 Internal Server Error\r\n".as_slice(),
            br#"{"error":"Internal Server Error"}"#.as_slice(),
        ),
    ];

    for (request, result, expected_status, expected_body) in cases {
        let response = round_trip(request, result);
        assert!(response.starts_with(expected_status));
        assert_eq!(body(&response), expected_body);
    }
}

#[test]
fn duplicate_authorization_headers_are_rejected_before_backend_verification() {
    let response = round_trip(
        b"GET /api/auth/me HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer first\r\nAuthorization: Bearer second\r\n\r\n",
        Ok(user()),
    );
    assert!(response.starts_with(b"HTTP/1.1 401 Unauthorized\r\n"));
    assert_eq!(body(&response), br#"{"reason":"invalid authorization"}"#);
}

#[test]
fn auth_me_preserves_exact_origin_and_preflight_rules() {
    let denied = round_trip(
        b"GET /api/auth/me HTTP/1.1\r\nHost: localhost\r\nOrigin: https://attacker.example\r\nAuthorization: Bearer token\r\n\r\n",
        Ok(user()),
    );
    assert!(denied.starts_with(b"HTTP/1.1 403 Forbidden\r\n"));
    assert_eq!(body(&denied), br#"{"error":"CORS origin denied"}"#);

    let preflight = round_trip(
        b"OPTIONS /api/auth/me HTTP/1.1\r\nHost: localhost\r\nOrigin: https://adhi1419.github.io\r\nAccess-Control-Request-Method: GET\r\nAccess-Control-Request-Headers: Authorization, Content-Type\r\n\r\n",
        Ok(user()),
    );
    assert!(preflight.starts_with(b"HTTP/1.1 204 No Content\r\n"));
    assert_eq!(body(&preflight), b"");
    assert!(has_header(&preflight, b"Access-Control-Max-Age: 86400\r\n"));
}
