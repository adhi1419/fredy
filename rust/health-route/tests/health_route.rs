use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::thread;

use fredy_health_route::{serve_connection, HEALTH_BODY, NOT_FOUND_BODY};

fn round_trip(request: &[u8]) -> Vec<u8> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("test listener binds");
    let address = listener.local_addr().expect("test listener has an address");
    let server = thread::spawn(move || {
        let (stream, _) = listener
            .accept()
            .expect("test listener accepts one request");
        serve_connection(stream).expect("test response writes");
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
