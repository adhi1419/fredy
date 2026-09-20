use std::collections::HashMap;
use std::env;
use std::fs;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use jsonwebtoken::{
    decode, decode_header, Algorithm, DecodingKey, EncodingKey, Header, Validation,
};
use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::{json, Value};

const FIREBASE_CERTIFICATE_URL: &str =
    "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const FIRESTORE_URL: &str = "https://firestore.googleapis.com/v1";
const FIRESTORE_SCOPE: &str = "https://www.googleapis.com/auth/datastore";
const METADATA_TOKEN_URL: &str =
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const GOOGLE_TOKEN_URI: &str = "https://oauth2.googleapis.com/token";

/// A dependency failure is intentionally opaque at the HTTP boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DependencyError;

/// Authentication failures used by the HTTP adapter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthFailure {
    InvalidAuthorization,
    InvalidToken,
    InvalidClaims,
    NotAllowed,
    Dependency,
}

/// The identity projection returned by `/api/auth/me` and reused by later protected routes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthenticatedUser {
    pub user_id: String,
    pub username: String,
    pub is_admin: bool,
}

/// An allowlist projection. `is_admin` is always derived from this record, never from the token.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AllowedUser {
    pub is_admin: bool,
}

/// The existing Fredy user projection used to avoid an unnecessary write on every request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserIdentity {
    pub username: String,
    pub is_admin: bool,
}

/// Parse the exact single-value bearer contract used by the Node service.
pub fn parse_bearer<'a>(values: &[&'a str]) -> Result<&'a str, AuthFailure> {
    if values.len() != 1 {
        return Err(AuthFailure::InvalidAuthorization);
    }

    let value = values[0];
    let Some((scheme, token)) = value.split_once(' ') else {
        return Err(AuthFailure::InvalidAuthorization);
    };
    if !scheme.eq_ignore_ascii_case("Bearer")
        || token.is_empty()
        || token.bytes().any(|byte| byte.is_ascii_whitespace())
    {
        return Err(AuthFailure::InvalidAuthorization);
    }
    Ok(token)
}

/// Normalize a verified Firebase email for the raw Firestore allowlist document id.
pub fn normalize_verified_email(email: Option<&str>) -> Option<String> {
    let normalized = email?.trim().to_ascii_lowercase();
    (!normalized.is_empty()).then_some(normalized)
}

/// A clock is injectable only because the production implementation is provided below.
pub trait Clock: Send + Sync {
    fn now(&self) -> Result<u64, DependencyError>;
}

/// The production wall clock.
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Result<u64, DependencyError> {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .map_err(|_| DependencyError)
    }
}

/// Provides the Firebase public certificate selected by JWT `kid`.
pub trait CertificateSource: Send + Sync {
    fn certificate_for_kid(&self, key_id: &str) -> Result<Option<String>, DependencyError>;
}

/// Provides a Google OAuth access token for Firestore REST calls.
pub trait AccessTokenProvider: Send + Sync {
    fn access_token(&self) -> Result<String, DependencyError>;
}

/// Reads the allowlist and the Fredy user projection and synchronizes identity changes.
pub trait IdentityStore: Send + Sync {
    fn allowed_user(&self, email: &str) -> Result<Option<AllowedUser>, DependencyError>;
    fn user_identity(&self, user_id: &str) -> Result<Option<UserIdentity>, DependencyError>;
    fn upsert_user(
        &self,
        user_id: &str,
        username: &str,
        is_admin: bool,
        existing: Option<&UserIdentity>,
    ) -> Result<(), DependencyError>;
}

/// A production Firebase verifier and Firestore identity resolver.
pub struct FirebaseAuthenticator {
    project_id: String,
    certificates: Arc<dyn CertificateSource>,
    identity_store: Arc<dyn IdentityStore>,
    clock: Arc<dyn Clock>,
}

impl FirebaseAuthenticator {
    /// Construct an authenticator with production or test implementations of each real seam.
    pub fn new(
        project_id: impl Into<String>,
        certificates: Arc<dyn CertificateSource>,
        identity_store: Arc<dyn IdentityStore>,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self {
            project_id: project_id.into(),
            certificates,
            identity_store,
            clock,
        }
    }

    /// Construct the real Cloud Run-capable implementation from Application Default Credentials.
    pub fn from_environment() -> Result<Self, DependencyError> {
        let project_id = env::var("FIREBASE_PROJECT_ID")
            .or_else(|_| env::var("GOOGLE_CLOUD_PROJECT"))
            .map_err(|_| DependencyError)?;
        if project_id.trim().is_empty() {
            return Err(DependencyError);
        }

        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| DependencyError)?;
        let access_tokens = Arc::new(GoogleAccessTokenProvider::from_environment(client.clone())?);
        let certificates = Arc::new(GoogleCertificateSource::new(client.clone()));
        let identity_store = Arc::new(FirestoreIdentityStore::from_environment(
            project_id.clone(),
            client,
            access_tokens,
        )?);

        Ok(Self::new(
            project_id,
            certificates,
            identity_store,
            Arc::new(SystemClock),
        ))
    }
}

impl AuthBackend for FirebaseAuthenticator {
    fn authenticate(&self, id_token: &str) -> Result<AuthenticatedUser, AuthFailure> {
        let now = self.clock.now().map_err(|_| AuthFailure::Dependency)?;
        let header = decode_header(id_token).map_err(|_| AuthFailure::InvalidToken)?;
        if header.alg != Algorithm::RS256 {
            return Err(AuthFailure::InvalidToken);
        }
        let key_id = header.kid.ok_or(AuthFailure::InvalidToken)?;
        let certificate = self
            .certificates
            .certificate_for_kid(&key_id)
            .map_err(|_| AuthFailure::Dependency)?
            .ok_or(AuthFailure::InvalidToken)?;
        let decoding_key = DecodingKey::from_rsa_pem(certificate.as_bytes())
            .map_err(|_| AuthFailure::Dependency)?;

        let issuer = format!("https://securetoken.google.com/{}", self.project_id);
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[issuer.as_str()]);
        validation.set_audience(&[self.project_id.as_str()]);
        validation.leeway = 0;
        validation.validate_exp = false;

        let claims = decode::<FirebaseClaims>(id_token, &decoding_key, &validation)
            .map_err(|_| AuthFailure::InvalidToken)?
            .claims;
        if claims.iss != issuer || claims.aud != self.project_id || claims.exp <= now {
            return Err(AuthFailure::InvalidToken);
        }
        if claims.sub.is_empty()
            || claims.sub.chars().count() > 128
            || claims.iat > now
            || claims.auth_time > now
        {
            return Err(AuthFailure::InvalidClaims);
        }

        let username = normalize_verified_email(claims.email.as_deref())
            .filter(|_| claims.email_verified == Some(true))
            .ok_or(AuthFailure::InvalidClaims)?;
        let allowed = self
            .identity_store
            .allowed_user(&username)
            .map_err(|_| AuthFailure::Dependency)?
            .ok_or(AuthFailure::NotAllowed)?;
        let existing = self
            .identity_store
            .user_identity(&claims.sub)
            .map_err(|_| AuthFailure::Dependency)?;
        if existing.as_ref().is_none_or(|identity| {
            identity.username != username || identity.is_admin != allowed.is_admin
        }) {
            self.identity_store
                .upsert_user(&claims.sub, &username, allowed.is_admin, existing.as_ref())
                .map_err(|_| AuthFailure::Dependency)?;
        }

        Ok(AuthenticatedUser {
            user_id: claims.sub,
            username,
            is_admin: allowed.is_admin,
        })
    }
}

/// Authenticates an already parsed bearer token. HTTP adapters own header collection; this trait
/// owns all identity, cryptographic, allowlist, and synchronization policy.
pub trait AuthBackend: Send + Sync {
    fn authenticate(&self, id_token: &str) -> Result<AuthenticatedUser, AuthFailure>;
}

#[derive(Debug, Deserialize)]
struct FirebaseClaims {
    iss: String,
    aud: String,
    sub: String,
    exp: u64,
    iat: u64,
    auth_time: u64,
    email: Option<String>,
    email_verified: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ServiceAccountCredentials {
    client_email: String,
    private_key: String,
    #[serde(default = "default_token_uri")]
    token_uri: String,
}

fn default_token_uri() -> String {
    GOOGLE_TOKEN_URI.to_owned()
}

#[derive(Debug, Deserialize)]
struct AccessTokenResponse {
    access_token: String,
    #[serde(default)]
    expires_in: Option<u64>,
}

/// Fetches and caches the public X.509 certificate map published by Firebase.
pub struct GoogleCertificateSource {
    client: Client,
    url: String,
    cache: Mutex<CertificateCache>,
}

struct CertificateCache {
    certificates: HashMap<String, String>,
    missing_kids: HashMap<String, Instant>,
    expires_at: Instant,
}

impl GoogleCertificateSource {
    pub fn new(client: Client) -> Self {
        Self::with_url(client, FIREBASE_CERTIFICATE_URL)
    }

    /// Uses the same production implementation with a supplied endpoint for local contract tests.
    pub fn with_url(client: Client, url: impl Into<String>) -> Self {
        Self {
            client,
            url: url.into(),
            cache: Mutex::new(CertificateCache {
                certificates: HashMap::new(),
                missing_kids: HashMap::new(),
                expires_at: Instant::now(),
            }),
        }
    }

    fn refresh(&self, cache: &mut CertificateCache) -> Result<(), DependencyError> {
        let response = self
            .client
            .get(&self.url)
            .send()
            .map_err(|_| DependencyError)?;
        if !response.status().is_success() {
            return Err(DependencyError);
        }
        let max_age = response
            .headers()
            .get("cache-control")
            .and_then(|value| value.to_str().ok())
            .and_then(cache_control_max_age)
            .unwrap_or(0);
        let certificates = response
            .json::<HashMap<String, String>>()
            .map_err(|_| DependencyError)?;
        cache.certificates = certificates;
        cache.missing_kids.clear();
        cache.expires_at = Instant::now() + Duration::from_secs(max_age);
        Ok(())
    }
}

impl CertificateSource for GoogleCertificateSource {
    fn certificate_for_kid(&self, key_id: &str) -> Result<Option<String>, DependencyError> {
        const MISSING_KID_CACHE_SECONDS: u64 = 60;

        let mut cache = self.cache.lock().map_err(|_| DependencyError)?;
        let now = Instant::now();
        let refreshed_expired_cache = now >= cache.expires_at;
        if refreshed_expired_cache {
            self.refresh(&mut cache)?;
        }
        if let Some(certificate) = cache.certificates.get(key_id) {
            return Ok(Some(certificate.clone()));
        }
        if cache
            .missing_kids
            .get(key_id)
            .is_some_and(|expires_at| now < *expires_at)
        {
            return Ok(None);
        }

        // A previously valid cache without this kid may be stale during Firebase key rotation.
        // Refresh once, then briefly remember a still-unknown kid so arbitrary JWT headers cannot
        // turn the certificate endpoint into a request-per-authentication dependency.
        if !refreshed_expired_cache {
            self.refresh(&mut cache)?;
            if let Some(certificate) = cache.certificates.get(key_id) {
                return Ok(Some(certificate.clone()));
            }
        }
        cache.missing_kids.insert(
            key_id.to_owned(),
            Instant::now() + Duration::from_secs(MISSING_KID_CACHE_SECONDS),
        );
        Ok(None)
    }
}

fn cache_control_max_age(value: &str) -> Option<u64> {
    value.split(',').find_map(|directive| {
        let (name, seconds) = directive.trim().split_once('=')?;
        name.trim()
            .eq_ignore_ascii_case("max-age")
            .then(|| seconds.trim_matches('"').parse::<u64>().ok())?
    })
}

/// Uses a service-account JSON file or the Cloud Run metadata server, matching ADC behavior.
pub struct GoogleAccessTokenProvider {
    client: Client,
    credentials: CredentialSource,
    token_endpoint: String,
    clock: Arc<dyn Clock>,
    cache: Mutex<Option<CachedAccessToken>>,
}

struct CachedAccessToken {
    value: String,
    expires_at: u64,
}

enum CredentialSource {
    ServiceAccount(ServiceAccountCredentials),
    Metadata,
}

impl GoogleAccessTokenProvider {
    pub fn from_environment(client: Client) -> Result<Self, DependencyError> {
        let clock: Arc<dyn Clock> = Arc::new(SystemClock);
        match env::var("GOOGLE_APPLICATION_CREDENTIALS") {
            Ok(path) => {
                let raw = fs::read_to_string(path).map_err(|_| DependencyError)?;
                let credentials: ServiceAccountCredentials =
                    serde_json::from_str(&raw).map_err(|_| DependencyError)?;
                let token_endpoint = credentials.token_uri.clone();
                Ok(Self {
                    client,
                    credentials: CredentialSource::ServiceAccount(credentials),
                    token_endpoint,
                    clock,
                    cache: Mutex::new(None),
                })
            }
            Err(_) => Ok(Self {
                client,
                credentials: CredentialSource::Metadata,
                token_endpoint: METADATA_TOKEN_URL.to_owned(),
                clock,
                cache: Mutex::new(None),
            }),
        }
    }

    /// Uses the production metadata response/parser with a local endpoint and clock for tests.
    pub fn with_metadata_endpoint(
        client: Client,
        endpoint: impl Into<String>,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self {
            client,
            credentials: CredentialSource::Metadata,
            token_endpoint: endpoint.into(),
            clock,
            cache: Mutex::new(None),
        }
    }

    fn service_account_token(
        &self,
        credentials: &ServiceAccountCredentials,
    ) -> Result<(String, u64), DependencyError> {
        let now = self.clock.now()?;
        let claims = json!({
            "iss": credentials.client_email,
            "scope": FIRESTORE_SCOPE,
            "aud": credentials.token_uri,
            "iat": now,
            "exp": now + 3600,
        });
        let signing_key = EncodingKey::from_rsa_pem(credentials.private_key.as_bytes())
            .map_err(|_| DependencyError)?;
        let assertion = jsonwebtoken::encode(&Header::new(Algorithm::RS256), &claims, &signing_key)
            .map_err(|_| DependencyError)?;
        let body = format!(
            "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion={assertion}"
        );
        let response = self
            .client
            .post(&self.token_endpoint)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .map_err(|_| DependencyError)?;
        if !response.status().is_success() {
            return Err(DependencyError);
        }
        let token = response
            .json::<AccessTokenResponse>()
            .map_err(|_| DependencyError)?;
        Ok((token.access_token, token.expires_in.unwrap_or(3600)))
    }

    fn fetch_access_token(&self) -> Result<(String, u64), DependencyError> {
        match &self.credentials {
            CredentialSource::ServiceAccount(credentials) => {
                self.service_account_token(credentials)
            }
            CredentialSource::Metadata => {
                let response = self
                    .client
                    .get(&self.token_endpoint)
                    .header("Metadata-Flavor", "Google")
                    .send()
                    .map_err(|_| DependencyError)?;
                if !response.status().is_success() {
                    return Err(DependencyError);
                }
                let token = response
                    .json::<AccessTokenResponse>()
                    .map_err(|_| DependencyError)?;
                Ok((token.access_token, token.expires_in.unwrap_or(3600)))
            }
        }
    }
}

impl AccessTokenProvider for GoogleAccessTokenProvider {
    fn access_token(&self) -> Result<String, DependencyError> {
        let now = self.clock.now()?;
        let mut cache = self.cache.lock().map_err(|_| DependencyError)?;
        if let Some(cached) = cache.as_ref() {
            if now < cached.expires_at {
                return Ok(cached.value.clone());
            }
        }
        let (value, expires_in) = self.fetch_access_token()?;
        let expires_at = now.saturating_add(expires_in.saturating_sub(60));
        *cache = Some(CachedAccessToken {
            value: value.clone(),
            expires_at,
        });
        Ok(value)
    }
}

/// Firestore REST implementation for the existing `allowed_users` and `users` collections.
pub struct FirestoreIdentityStore {
    project_id: String,
    base_url: String,
    client: Client,
    access_tokens: Option<Arc<dyn AccessTokenProvider>>,
}

impl FirestoreIdentityStore {
    pub fn new(
        project_id: impl Into<String>,
        client: Client,
        access_tokens: Arc<dyn AccessTokenProvider>,
    ) -> Self {
        Self {
            project_id: project_id.into(),
            base_url: FIRESTORE_URL.to_owned(),
            client,
            access_tokens: Some(access_tokens),
        }
    }

    pub fn from_environment(
        project_id: impl Into<String>,
        client: Client,
        access_tokens: Arc<dyn AccessTokenProvider>,
    ) -> Result<Self, DependencyError> {
        let project_id = project_id.into();
        if let Ok(host) = env::var("FIRESTORE_EMULATOR_HOST") {
            if host.trim().is_empty() {
                return Err(DependencyError);
            }
            return Ok(Self {
                project_id,
                base_url: format!("http://{host}/v1"),
                client,
                access_tokens: None,
            });
        }
        Ok(Self::new(project_id, client, access_tokens))
    }

    fn document_url(&self, collection: &str, document_id: &str) -> String {
        format!(
            "{}/projects/{}/databases/(default)/documents/{}/{}",
            self.base_url,
            encode_path_component(&self.project_id),
            collection,
            encode_path_component(document_id),
        )
    }

    fn get_document(
        &self,
        collection: &str,
        document_id: &str,
    ) -> Result<Option<Value>, DependencyError> {
        let mut request = self.client.get(self.document_url(collection, document_id));
        if let Some(access_tokens) = &self.access_tokens {
            request = request.bearer_auth(access_tokens.access_token()?);
        }
        let response = request.send().map_err(|_| DependencyError)?;
        if response.status().as_u16() == 404 {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(DependencyError);
        }
        response
            .json::<Value>()
            .map(Some)
            .map_err(|_| DependencyError)
    }

    fn patch_document(
        &self,
        collection: &str,
        document_id: &str,
        fields: Value,
        update_masks: &[&str],
    ) -> Result<(), DependencyError> {
        let mut request = self
            .client
            .patch(self.document_url(collection, document_id));
        if let Some(access_tokens) = &self.access_tokens {
            request = request.bearer_auth(access_tokens.access_token()?);
        }
        let mut request = request.json(&json!({ "fields": fields }));
        if !update_masks.is_empty() {
            request = request.query(
                &update_masks
                    .iter()
                    .map(|field| ("updateMask.fieldPaths", *field))
                    .collect::<Vec<_>>(),
            );
        }
        let response = request.send().map_err(|_| DependencyError)?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(DependencyError)
        }
    }
}

impl IdentityStore for FirestoreIdentityStore {
    fn allowed_user(&self, email: &str) -> Result<Option<AllowedUser>, DependencyError> {
        let document = self.get_document("allowed_users", email)?;
        Ok(document.map(|document| AllowedUser {
            is_admin: field(&document, "isAdmin")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        }))
    }

    fn user_identity(&self, user_id: &str) -> Result<Option<UserIdentity>, DependencyError> {
        let Some(document) = self.get_document("users", user_id)? else {
            return Ok(None);
        };
        let Some(username) = field(&document, "username").and_then(Value::as_str) else {
            return Ok(None);
        };
        Ok(Some(UserIdentity {
            username: username.to_owned(),
            is_admin: field(&document, "isAdmin")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        }))
    }

    fn upsert_user(
        &self,
        user_id: &str,
        username: &str,
        is_admin: bool,
        existing: Option<&UserIdentity>,
    ) -> Result<(), DependencyError> {
        let fields = json!({
            "username": { "stringValue": username },
            "isAdmin": { "booleanValue": is_admin },
        });
        if existing.is_none() {
            let mut fields = fields;
            fields["lastLogin"] = json!({ "nullValue": null });
            self.patch_document("users", user_id, fields, &[])
        } else {
            self.patch_document("users", user_id, fields, &["username", "isAdmin"])
        }
    }
}

fn field<'a>(document: &'a Value, name: &str) -> Option<&'a Value> {
    document.get("fields")?.get(name).and_then(|field| {
        field
            .get("stringValue")
            .or_else(|| field.get("booleanValue"))
            .or_else(|| field.get("nullValue"))
    })
}

fn encode_path_component(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push('%');
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 0x0f) as usize] as char);
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bearer_parser_requires_one_exact_bearer_value() {
        assert_eq!(parse_bearer(&["Bearer token"]).unwrap(), "token");
        for values in [
            vec![],
            vec!["Basic token"],
            vec!["Bearer"],
            vec!["Bearer token with spaces"],
            vec!["Bearer one", "Bearer two"],
        ] {
            assert_eq!(
                parse_bearer(&values),
                Err(AuthFailure::InvalidAuthorization)
            );
        }
    }

    #[test]
    fn email_normalization_matches_node_policy() {
        assert_eq!(
            normalize_verified_email(Some("  Alice@Example.COM ")),
            Some("alice@example.com".to_owned())
        );
        assert_eq!(normalize_verified_email(Some("  ")), None);
        assert_eq!(normalize_verified_email(None), None);
    }
}
