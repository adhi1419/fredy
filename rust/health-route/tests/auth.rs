use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use fredy_health_route::auth::{
    AccessTokenProvider, AllowedUser, AuthBackend, AuthFailure, CertificateSource, Clock,
    DependencyError, FirebaseAuthenticator, GoogleAccessTokenProvider, GoogleCertificateSource,
    IdentityStore, UserIdentity,
};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::Serialize;

const PROJECT_ID: &str = "fredy";
const NOW: u64 = 1_789_888_494;
const PRIVATE_KEY: &str = r#"-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0+Mzt1UYPj48lD54DimBld7bh9MmfquqOdQeDyiZpFxgL0kA
xaZhMOAz/aS0zC68yZH3xsoGLsys1ltlTtUn1Myec7Ze2dss3VyKafTDzrWrdu89
URkeOZYnRA4oAKlrnch5S+cGCpAckFuWj+Su0xrv5hQEFIOkzXWH+xbWmx5j5utx
xu/Toph6/xDmuky1ianhrL4W5OEr0j3vTFCGi+wv3neee0aaXmpawo1nvrcuEAku
q9154SZyOdoORVOXE+L6zsFynem4y5tIVveFrkqUodWVD8qpjJ+Xvvj0I9G+XfxM
CXzEHHAwa/bMoRE0apSqvT5jstIO7t14eVT/iQIDAQABAoIBAAIyILyTJK5XHcXu
2cv9G8suT+RvSJRXz2qhq0gT7yJYFLpuDWnUSL3lbOnW1aAnZyxy7KLs6rXRyC7B
LA0Y7LyUpvBjC5uYB7XUOi5RQOA5BhRe8/84UpWyhn365D48Leco3IearCIwOSOO
ghfD/Rh8oc98FfNnzoLp52VaPhIbGy5OGyo7NVm0iEI0Nvf0PFotx7quqT8flOp+
GBflDfywbv4Q2+I7uDAFWFcXWTeusRlY0fo1YVG80xQeeHbyvimw2ki+CK09ohIb
H1ysuoasz8w9VLtV5+keNXPSuuObpl4yF87IMfJW5Opc/3MInGBnjMteCf1lMnaO
9Qu4jnMCgYEA+Uc9eA5wxY69MipCvEMGGKfCUFzhddSuHvjl0x2dZqNkO2SHcFLF
0XdvNwuaZ/ve8zvEO1SfTBXoeKZ5RLD/mbdMI1jxSp6JSX4w5mEJEnBaJ84WZLea
pG48DObjWUXWz80iLGagT0nFc3d8tzXRE/GqIzx1xCXuCC5/6dmREUMCgYEA2Zna
x2YPAy3YqNwqYvEzBcPDSoaO8e8IAJIZoe9Ru209wadJ+Nmvbbg6pGX2ltYqS4Z2
lVkeUU6Mgkw+tNDfidtbvEkG14tqfpqNEpExiAJx6WJN7nG0Sxfvm+ttedInq5fG
9ihrepbrmZ1gFUgMJN01Nm5QX28K516k8lGDaUMCgYBefGNPQ2H5cA5EmoIrK9h+
te/QWDRZXmEVelBawknsIpiWbpdruuQibnvoSGyhZ3XtikTqHDw5McCpIqiqodBw
amrgpxDmsMrm4X8Vg8hVheKWXeZdDL7//oyic03Pg8pVf7KpU8kF5LeD+dF6/Fog
jiRoML2OuLXNwhpYAFCdUwKBgCIVKCBdSvKrhqkEOxtePiij/f25T8BzOSSlvaAQ
lROvS6H+auawafrchUrksZf0mZFU0VQZLld73yQ1fwjhQnIcSqUWJx0xuA92c6w5
07FC+MaeYCh95MhySlR4rqALG62Ty1UZBaSg6OwZq0gKDeTkRQZuhuY7xVByEZHm
1JdzAoGBAMbwk3wfeYp54tHOHVM9sJ9faTqWTxqoXQZ0XXhr+D9c55LK0Ou4J2J/
lLm8ZZR+W98tkaqHqluW5EBAdfjIPBQHnSK2iWFlso0T5uatxzkWhXQavq1TKK5v
TNA0ZwQwl9hkxz8AD1kayGwNIL74rjQJ/RLmydKIvDY9jGPC4kiL
-----END RSA PRIVATE KEY-----"#;
const CERTIFICATE_PEM: &str = r#"-----BEGIN CERTIFICATE-----
MIIDETCCAfmgAwIBAgIUAqgbBHR9PF7bhQdan0OJPqfsq40wDQYJKoZIhvcNAQEL
BQAwGDEWMBQGA1UEAwwNZmlyZWJhc2UtdGVzdDAeFw0yNjA5MjAwNzI0MzRaFw0z
NjA5MTcwNzI0MzRaMBgxFjAUBgNVBAMMDWZpcmViYXNlLXRlc3QwggEiMA0GCSqG
SIb3DQEBAQUAA4IBDwAwggEKAoIBAQDT4zO3VRg+PjyUPngOKYGV3tuH0yZ+q6o5
1B4PKJmkXGAvSQDFpmEw4DP9pLTMLrzJkffGygYuzKzWW2VO1SfUzJ5ztl7Z2yzd
XIpp9MPOtat27z1RGR45lidEDigAqWudyHlL5wYKkByQW5aP5K7TGu/mFAQUg6TN
dYf7FtabHmPm63HG79OimHr/EOa6TLWJqeGsvhbk4SvSPe9MUIaL7C/ed557Rppe
alrCjWe+ty4QCS6r3XnhJnI52g5FU5cT4vrOwXKd6bjLm0hW94WuSpSh1ZUPyqmM
n5e++PQj0b5d/EwJfMQccDBr9syhETRqlKq9PmOy0g7u3Xh5VP+JAgMBAAGjUzBR
MB0GA1UdDgQWBBTKCmmqXZdN1b0fDOBJYGwJmokexTAfBgNVHSMEGDAWgBTKCmmq
XZdN1b0fDOBJYGwJmokexTAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUA
A4IBAQBa4lrccW43isVHfLGdu0jMpdPUHfCxVKelSnGh2BT0xtVKxRrYwM+UqCll
+nN41t1+EekoR58JTYLYHkoWyG/kODGnr4mtDlN12CmRvcygmodOROrUVBvH5SWt
WgaQYwlXz++CILStgt6hC1H9LXWjZf5vSs7PDPpelz31AfUqHqhZGzIvTSAHHdQY
C0+f38egRU512gBl+mFWDtduoXOCY1yXBBWTpaTzYDwUGntZhPSywSqoo0JobHlp
g8WyLm0IJlgvQFs+itSY/oGVWml0hSN4CfoPFCbFxROP8m5cjuHfn7Bpb43VGAD7
azUGsK0w/AJirnuDmTUN/qh6VU4j
-----END CERTIFICATE-----"#;

#[derive(Debug, Clone, Serialize)]
struct Claims {
    iss: String,
    aud: String,
    sub: String,
    exp: u64,
    iat: u64,
    auth_time: u64,
    email: Option<String>,
    email_verified: Option<bool>,
}

struct FixedClock(u64);
impl Clock for FixedClock {
    fn now(&self) -> Result<u64, DependencyError> {
        Ok(self.0)
    }
}

struct FixedCertificates {
    fail: bool,
}
impl CertificateSource for FixedCertificates {
    fn certificate_for_kid(&self, key_id: &str) -> Result<Option<String>, DependencyError> {
        if self.fail {
            return Err(DependencyError);
        }
        Ok((key_id == "kid-1").then(|| CERTIFICATE_PEM.to_owned()))
    }
}

#[derive(Default)]
struct StoreState {
    allowed: Option<AllowedUser>,
    identity: Option<UserIdentity>,
    fail: bool,
    upserts: Vec<(String, String, bool)>,
}

struct FakeStore(Mutex<StoreState>);
impl IdentityStore for FakeStore {
    fn allowed_user(&self, _email: &str) -> Result<Option<AllowedUser>, DependencyError> {
        let state = self.0.lock().unwrap();
        if state.fail {
            return Err(DependencyError);
        }
        Ok(state.allowed)
    }

    fn user_identity(&self, _user_id: &str) -> Result<Option<UserIdentity>, DependencyError> {
        let state = self.0.lock().unwrap();
        if state.fail {
            return Err(DependencyError);
        }
        Ok(state.identity.clone())
    }

    fn upsert_user(
        &self,
        user_id: &str,
        username: &str,
        is_admin: bool,
        _existing: Option<&UserIdentity>,
    ) -> Result<(), DependencyError> {
        let mut state = self.0.lock().unwrap();
        if state.fail {
            return Err(DependencyError);
        }
        state
            .upserts
            .push((user_id.to_owned(), username.to_owned(), is_admin));
        Ok(())
    }
}

fn claims() -> Claims {
    Claims {
        iss: format!("https://securetoken.google.com/{PROJECT_ID}"),
        aud: PROJECT_ID.to_owned(),
        sub: "uid-alice".to_owned(),
        exp: NOW + 3600,
        iat: NOW - 60,
        auth_time: NOW - 120,
        email: Some(" Alice@Example.COM ".to_owned()),
        email_verified: Some(true),
    }
}

fn token(claims: Claims) -> String {
    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some("kid-1".to_owned());
    encode(
        &header,
        &claims,
        &EncodingKey::from_rsa_pem(PRIVATE_KEY.as_bytes()).unwrap(),
    )
    .unwrap()
}

fn authenticator(
    certificates: FixedCertificates,
    state: StoreState,
) -> (FirebaseAuthenticator, Arc<FakeStore>) {
    let store = Arc::new(FakeStore(Mutex::new(state)));
    let auth = FirebaseAuthenticator::new(
        PROJECT_ID,
        Arc::new(certificates),
        store.clone(),
        Arc::new(FixedClock(NOW)),
    );
    (auth, store)
}

#[test]
fn valid_rs256_kid_token_normalizes_email_and_uses_allowlist_admin_state() {
    let (auth, store) = authenticator(
        FixedCertificates { fail: false },
        StoreState {
            allowed: Some(AllowedUser { is_admin: true }),
            identity: None,
            ..StoreState::default()
        },
    );

    let user = auth.authenticate(&token(claims())).unwrap();

    assert_eq!(user.user_id, "uid-alice");
    assert_eq!(user.username, "alice@example.com");
    assert!(user.is_admin);
    assert_eq!(
        store.0.lock().unwrap().upserts,
        vec![("uid-alice".to_owned(), "alice@example.com".to_owned(), true)]
    );
}

#[test]
fn existing_matching_identity_avoids_a_firestore_write() {
    let (auth, store) = authenticator(
        FixedCertificates { fail: false },
        StoreState {
            allowed: Some(AllowedUser { is_admin: false }),
            identity: Some(UserIdentity {
                username: "alice@example.com".to_owned(),
                is_admin: false,
            }),
            ..StoreState::default()
        },
    );

    assert!(auth.authenticate(&token(claims())).is_ok());
    assert!(store.0.lock().unwrap().upserts.is_empty());
}

#[test]
fn allowlist_false_is_not_admin_and_missing_entry_is_denied() {
    let (auth, _) = authenticator(
        FixedCertificates { fail: false },
        StoreState {
            allowed: Some(AllowedUser { is_admin: false }),
            ..StoreState::default()
        },
    );
    assert!(!auth.authenticate(&token(claims())).unwrap().is_admin);

    let (revoked, _) = authenticator(FixedCertificates { fail: false }, StoreState::default());
    assert_eq!(
        revoked.authenticate(&token(claims())),
        Err(AuthFailure::NotAllowed)
    );
}

#[test]
fn rejects_non_rs256_or_missing_kid_tokens() {
    let (auth, _) = authenticator(
        FixedCertificates { fail: false },
        StoreState {
            allowed: Some(AllowedUser { is_admin: false }),
            ..StoreState::default()
        },
    );
    let mut header = Header::new(Algorithm::HS256);
    header.kid = Some("kid-1".to_owned());
    let hmac_token = encode(
        &header,
        &claims(),
        &jsonwebtoken::EncodingKey::from_secret(b"wrong"),
    )
    .unwrap();
    assert_eq!(
        auth.authenticate(&hmac_token),
        Err(AuthFailure::InvalidToken)
    );

    let mut missing_kid = Header::new(Algorithm::RS256);
    missing_kid.kid = None;
    let token_without_kid = encode(
        &missing_kid,
        &claims(),
        &EncodingKey::from_rsa_pem(PRIVATE_KEY.as_bytes()).unwrap(),
    )
    .unwrap();
    assert_eq!(
        auth.authenticate(&token_without_kid),
        Err(AuthFailure::InvalidToken)
    );
}

#[test]
fn rejects_invalid_firebase_issuer_audience_and_expiry() {
    let (auth, _) = authenticator(
        FixedCertificates { fail: false },
        StoreState {
            allowed: Some(AllowedUser { is_admin: false }),
            ..StoreState::default()
        },
    );

    let mut wrong_issuer = claims();
    wrong_issuer.iss = "https://securetoken.google.com/other".to_owned();
    assert_eq!(
        auth.authenticate(&token(wrong_issuer)),
        Err(AuthFailure::InvalidToken)
    );

    let mut wrong_audience = claims();
    wrong_audience.aud = "other".to_owned();
    assert_eq!(
        auth.authenticate(&token(wrong_audience)),
        Err(AuthFailure::InvalidToken)
    );

    let mut expired = claims();
    expired.exp = NOW - 1;
    assert_eq!(
        auth.authenticate(&token(expired)),
        Err(AuthFailure::InvalidToken)
    );
}

#[test]
fn rejects_invalid_subject_issued_at_auth_time_and_email_claims() {
    let (auth, _) = authenticator(
        FixedCertificates { fail: false },
        StoreState {
            allowed: Some(AllowedUser { is_admin: false }),
            ..StoreState::default()
        },
    );

    let mut future_iat = claims();
    future_iat.iat = NOW + 1;
    assert_eq!(
        auth.authenticate(&token(future_iat)),
        Err(AuthFailure::InvalidClaims)
    );

    let mut future_auth_time = claims();
    future_auth_time.auth_time = NOW + 1;
    assert_eq!(
        auth.authenticate(&token(future_auth_time)),
        Err(AuthFailure::InvalidClaims)
    );

    let mut empty_subject = claims();
    empty_subject.sub.clear();
    assert_eq!(
        auth.authenticate(&token(empty_subject)),
        Err(AuthFailure::InvalidClaims)
    );

    let mut maximum_multibyte_subject = claims();
    maximum_multibyte_subject.sub = "é".repeat(128);
    assert!(auth.authenticate(&token(maximum_multibyte_subject)).is_ok());

    let mut oversized_subject = claims();
    oversized_subject.sub = "x".repeat(129);
    assert_eq!(
        auth.authenticate(&token(oversized_subject)),
        Err(AuthFailure::InvalidClaims)
    );

    let mut unverified = claims();
    unverified.email_verified = Some(false);
    assert_eq!(
        auth.authenticate(&token(unverified)),
        Err(AuthFailure::InvalidClaims)
    );

    let mut empty_email = claims();
    empty_email.email = Some("  ".to_owned());
    assert_eq!(
        auth.authenticate(&token(empty_email)),
        Err(AuthFailure::InvalidClaims)
    );
}

#[test]
fn certificate_and_firestore_failures_are_not_authorized() {
    let (key_failure, _) = authenticator(FixedCertificates { fail: true }, StoreState::default());
    assert_eq!(
        key_failure.authenticate(&token(claims())),
        Err(AuthFailure::Dependency)
    );

    let (store_failure, _) = authenticator(
        FixedCertificates { fail: false },
        StoreState {
            fail: true,
            ..StoreState::default()
        },
    );
    assert_eq!(
        store_failure.authenticate(&token(claims())),
        Err(AuthFailure::Dependency)
    );
}

struct MutableClock(AtomicU64);
impl Clock for MutableClock {
    fn now(&self) -> Result<u64, DependencyError> {
        Ok(self.0.load(Ordering::SeqCst))
    }
}

fn json_server(responses: Vec<String>) -> (String, Arc<AtomicUsize>, thread::JoinHandle<()>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let requests = Arc::new(AtomicUsize::new(0));
    let count = requests.clone();
    let server = thread::spawn(move || {
        for body in responses {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 4096];
            let _ = stream.read(&mut request);
            count.fetch_add(1, Ordering::SeqCst);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: max-age=600\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(), body
            );
            stream.write_all(response.as_bytes()).unwrap();
        }
    });
    (format!("http://{address}/token"), requests, server)
}

#[test]
fn certificate_cache_reuses_keys_and_refreshes_once_for_a_missing_kid() {
    let first = serde_json::to_string(&serde_json::json!({"kid-1": CERTIFICATE_PEM})).unwrap();
    let second = serde_json::to_string(&serde_json::json!({
        "kid-1": CERTIFICATE_PEM,
        "kid-2": CERTIFICATE_PEM
    }))
    .unwrap();
    let (url, requests, server) = json_server(vec![first, second]);
    let source = GoogleCertificateSource::with_url(reqwest::blocking::Client::new(), url);

    assert!(source.certificate_for_kid("kid-1").unwrap().is_some());
    assert!(source.certificate_for_kid("kid-1").unwrap().is_some());
    assert!(source.certificate_for_kid("kid-2").unwrap().is_some());
    assert!(source.certificate_for_kid("kid-2").unwrap().is_some());
    assert_eq!(requests.load(Ordering::SeqCst), 2);
    server.join().unwrap();
}

#[test]
fn certificate_cache_briefly_remembers_a_kid_missing_after_refresh() {
    let body = serde_json::to_string(&serde_json::json!({"kid-1": CERTIFICATE_PEM})).unwrap();
    let (url, requests, server) = json_server(vec![body.clone(), body]);
    let source = GoogleCertificateSource::with_url(reqwest::blocking::Client::new(), url);

    assert!(source.certificate_for_kid("kid-1").unwrap().is_some());
    assert_eq!(source.certificate_for_kid("unknown-kid").unwrap(), None);
    assert_eq!(source.certificate_for_kid("unknown-kid").unwrap(), None);
    assert_eq!(requests.load(Ordering::SeqCst), 2);
    server.join().unwrap();
}

#[test]
fn access_token_cache_reuses_tokens_until_safe_refresh_skew() {
    let clock = Arc::new(MutableClock(AtomicU64::new(1_000)));
    let (url, requests, server) = json_server(vec![
        r#"{"access_token":"token-one","expires_in":120}"#.to_owned(),
        r#"{"access_token":"token-two","expires_in":120}"#.to_owned(),
    ]);
    let provider = GoogleAccessTokenProvider::with_metadata_endpoint(
        reqwest::blocking::Client::new(),
        url,
        clock.clone(),
    );

    assert_eq!(provider.access_token().unwrap(), "token-one");
    assert_eq!(provider.access_token().unwrap(), "token-one");
    assert_eq!(requests.load(Ordering::SeqCst), 1);

    clock.0.store(1_060, Ordering::SeqCst);
    assert_eq!(provider.access_token().unwrap(), "token-two");
    assert_eq!(requests.load(Ordering::SeqCst), 2);
    server.join().unwrap();
}
