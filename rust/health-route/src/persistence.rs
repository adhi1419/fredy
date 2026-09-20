use std::collections::HashSet;
use std::env;
use std::sync::Arc;
use std::time::Duration;

use reqwest::blocking::{Client, RequestBuilder};
use serde::Deserialize;
use serde_json::{Map, Number, Value};

use crate::auth::{AccessTokenProvider, DependencyError, GoogleAccessTokenProvider};

const FIRESTORE_URL: &str = "https://firestore.googleapis.com/v1";
const NO_USER: &str = "__NO_USER__";

pub const COLLECTION_JOBS: &str = "jobs";
pub const COLLECTION_LISTINGS: &str = "listings";

/// Access-critical projection of a stored Fredy job.
#[derive(Debug, Clone, PartialEq)]
pub struct JobRecord {
    pub id: String,
    pub owner_user_id: Option<String>,
    pub enabled: bool,
    pub name: Option<String>,
    pub shared_with_user: Vec<String>,
    pub providers: Vec<Value>,
    pub notification_adapter_refs: Vec<Value>,
    pub deal_type: Option<String>,
    pub last_run_at: Option<i64>,
}

impl JobRecord {
    /// Product visibility is owner-or-explicit-share for every role. There is deliberately no
    /// administrator input or bypass in this contract.
    pub fn is_accessible_to(&self, user_id: &str) -> bool {
        let effective_user_id = effective_user_id(user_id);
        self.owner_user_id.as_deref() == Some(effective_user_id)
            || self
                .shared_with_user
                .iter()
                .any(|shared_user_id| shared_user_id == effective_user_id)
    }
}

/// Access-critical projection of a stored Fredy listing.
#[derive(Debug, Clone, PartialEq)]
pub struct ListingRecord {
    pub id: String,
    pub job_id: Option<String>,
    pub hash: Option<String>,
    pub provider: Option<String>,
    pub title: Option<String>,
    pub address: Option<String>,
    pub link: Option<String>,
    pub price: Option<Value>,
    pub size: Option<Value>,
    pub rooms: Option<Value>,
    pub created_at: Option<i64>,
    pub is_active: bool,
    pub manually_deleted: bool,
}

/// Dormant read contract that routes can adopt incrementally after executable parity exists.
pub trait PersistenceAdapter {
    type Error: std::fmt::Debug + Send + Sync;

    fn get_job(&self, job_id: &str, user_id: &str) -> Result<Option<JobRecord>, Self::Error>;

    fn get_jobs(&self, user_id: &str) -> Result<Vec<JobRecord>, Self::Error>;

    fn get_listing_by_id(
        &self,
        listing_id: &str,
        user_id: &str,
    ) -> Result<Option<ListingRecord>, Self::Error>;

    fn get_visible_listings(&self, user_id: &str) -> Result<Vec<ListingRecord>, Self::Error>;
}

/// Firestore REST implementation used by Cloud Run ADC and the repository emulator.
pub struct FirestorePersistenceAdapter {
    project_id: String,
    base_url: String,
    client: Client,
    access_tokens: Option<Arc<dyn AccessTokenProvider>>,
}

impl FirestorePersistenceAdapter {
    /// Construct the real implementation from Cloud Run ADC or `FIRESTORE_EMULATOR_HOST`.
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

        let access_tokens = Arc::new(GoogleAccessTokenProvider::from_environment(client.clone())?);
        Ok(Self {
            project_id,
            base_url: FIRESTORE_URL.to_owned(),
            client,
            access_tokens: Some(access_tokens),
        })
    }

    fn documents_url(&self, collection: &str) -> String {
        format!(
            "{}/projects/{}/databases/(default)/documents/{}",
            self.base_url,
            encode_path_component(&self.project_id),
            collection,
        )
    }

    fn document_url(&self, collection: &str, document_id: &str) -> String {
        format!(
            "{}/{}",
            self.documents_url(collection),
            encode_path_component(document_id),
        )
    }

    fn authorize(&self, mut request: RequestBuilder) -> Result<RequestBuilder, DependencyError> {
        if let Some(access_tokens) = &self.access_tokens {
            request = request.bearer_auth(access_tokens.access_token()?);
        }
        Ok(request)
    }

    fn get_document(
        &self,
        collection: &str,
        document_id: &str,
    ) -> Result<Option<DecodedDocument>, DependencyError> {
        let response = self
            .authorize(self.client.get(self.document_url(collection, document_id)))?
            .send()
            .map_err(|_| DependencyError)?;
        if response.status().as_u16() == 404 {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(DependencyError);
        }
        let document = response.json::<Value>().map_err(|_| DependencyError)?;
        decode_document(&document).map(Some)
    }

    fn list_documents(&self, collection: &str) -> Result<Vec<DecodedDocument>, DependencyError> {
        let mut documents = Vec::new();
        let mut page_token: Option<String> = None;
        loop {
            let mut request = self
                .client
                .get(self.documents_url(collection))
                .query(&[("pageSize", "1000")]);
            if let Some(token) = page_token.as_deref() {
                request = request.query(&[("pageToken", token)]);
            }
            let response = self
                .authorize(request)?
                .send()
                .map_err(|_| DependencyError)?;
            if !response.status().is_success() {
                return Err(DependencyError);
            }
            let payload = response.json::<Value>().map_err(|_| DependencyError)?;
            for raw_document in payload
                .get("documents")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                documents.push(decode_document(raw_document)?);
            }
            page_token = payload
                .get("nextPageToken")
                .and_then(Value::as_str)
                .filter(|token| !token.is_empty())
                .map(str::to_owned);
            if page_token.is_none() {
                return Ok(documents);
            }
        }
    }

    fn all_jobs(&self) -> Result<Vec<JobRecord>, DependencyError> {
        self.list_documents(COLLECTION_JOBS)?
            .into_iter()
            .map(JobRecord::try_from)
            .collect()
    }

    fn accessible_job_ids(&self, user_id: &str) -> Result<HashSet<String>, DependencyError> {
        Ok(self
            .get_jobs(user_id)?
            .into_iter()
            .map(|job| job.id)
            .collect())
    }
}

impl PersistenceAdapter for FirestorePersistenceAdapter {
    type Error = DependencyError;

    fn get_job(&self, job_id: &str, user_id: &str) -> Result<Option<JobRecord>, Self::Error> {
        if job_id.is_empty() {
            return Ok(None);
        }
        let Some(job) = self
            .get_document(COLLECTION_JOBS, job_id)?
            .map(JobRecord::try_from)
            .transpose()?
        else {
            return Ok(None);
        };
        Ok(job.is_accessible_to(user_id).then_some(job))
    }

    fn get_jobs(&self, user_id: &str) -> Result<Vec<JobRecord>, Self::Error> {
        let mut jobs: Vec<_> = self
            .all_jobs()?
            .into_iter()
            .filter(|job| job.is_accessible_to(user_id))
            .collect();
        jobs.sort_by(|left, right| match (&left.name, &right.name) {
            (Some(left_name), Some(right_name)) => left_name.cmp(right_name),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => std::cmp::Ordering::Equal,
        });
        Ok(jobs)
    }

    fn get_listing_by_id(
        &self,
        listing_id: &str,
        user_id: &str,
    ) -> Result<Option<ListingRecord>, Self::Error> {
        if listing_id.is_empty() {
            return Ok(None);
        }
        let Some(listing) = self
            .get_document(COLLECTION_LISTINGS, listing_id)?
            .map(ListingRecord::try_from)
            .transpose()?
        else {
            return Ok(None);
        };
        if listing.manually_deleted {
            return Ok(None);
        }
        let Some(job_id) = listing.job_id.as_deref() else {
            return Ok(None);
        };
        Ok(self.get_job(job_id, user_id)?.map(|_| listing))
    }

    fn get_visible_listings(&self, user_id: &str) -> Result<Vec<ListingRecord>, Self::Error> {
        let accessible_job_ids = self.accessible_job_ids(user_id)?;
        let mut listings: Vec<_> = self
            .list_documents(COLLECTION_LISTINGS)?
            .into_iter()
            .map(ListingRecord::try_from)
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .filter(|listing| {
                !listing.manually_deleted
                    && listing
                        .job_id
                        .as_ref()
                        .is_some_and(|job_id| accessible_job_ids.contains(job_id))
            })
            .collect();
        listings.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        Ok(listings)
    }
}

struct DecodedDocument {
    id: String,
    fields: Value,
}

impl TryFrom<DecodedDocument> for JobRecord {
    type Error = DependencyError;

    fn try_from(document: DecodedDocument) -> Result<Self, Self::Error> {
        let stored: StoredJob =
            serde_json::from_value(document.fields).map_err(|_| DependencyError)?;
        Ok(Self {
            id: document.id,
            owner_user_id: stored.user_id,
            enabled: stored.enabled,
            name: stored.name,
            shared_with_user: stored.shared_with_user,
            providers: stored.provider,
            notification_adapter_refs: stored.notification_adapter,
            deal_type: stored.deal_type,
            last_run_at: stored.last_run_at,
        })
    }
}

impl TryFrom<DecodedDocument> for ListingRecord {
    type Error = DependencyError;

    fn try_from(document: DecodedDocument) -> Result<Self, Self::Error> {
        let stored: StoredListing =
            serde_json::from_value(document.fields).map_err(|_| DependencyError)?;
        Ok(Self {
            id: document.id,
            job_id: stored.job_id,
            hash: stored.hash,
            provider: stored.provider,
            title: stored.title,
            address: stored.address,
            link: stored.link,
            price: stored.price,
            size: stored.size,
            rooms: stored.rooms,
            created_at: stored.created_at,
            is_active: stored.is_active,
            manually_deleted: stored.manually_deleted,
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredJob {
    #[serde(default)]
    user_id: Option<String>,
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    shared_with_user: Vec<String>,
    #[serde(default)]
    provider: Vec<Value>,
    #[serde(default)]
    notification_adapter: Vec<Value>,
    #[serde(default)]
    deal_type: Option<String>,
    #[serde(default)]
    last_run_at: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredListing {
    #[serde(default)]
    job_id: Option<String>,
    #[serde(default)]
    hash: Option<String>,
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    address: Option<String>,
    #[serde(default)]
    link: Option<String>,
    #[serde(default)]
    price: Option<Value>,
    #[serde(default)]
    size: Option<Value>,
    #[serde(default)]
    rooms: Option<Value>,
    #[serde(default)]
    created_at: Option<i64>,
    #[serde(default)]
    is_active: bool,
    #[serde(default)]
    manually_deleted: bool,
}

fn effective_user_id(user_id: &str) -> &str {
    if user_id.is_empty() {
        NO_USER
    } else {
        user_id
    }
}

fn decode_document(raw: &Value) -> Result<DecodedDocument, DependencyError> {
    let id = raw
        .get("name")
        .and_then(Value::as_str)
        .and_then(|name| name.rsplit('/').next())
        .filter(|id| !id.is_empty())
        .ok_or(DependencyError)?
        .to_owned();
    let raw_fields = raw
        .get("fields")
        .and_then(Value::as_object)
        .ok_or(DependencyError)?;
    let mut fields = Map::with_capacity(raw_fields.len());
    for (name, value) in raw_fields {
        fields.insert(name.clone(), decode_value(value)?);
    }
    Ok(DecodedDocument {
        id,
        fields: Value::Object(fields),
    })
}

fn decode_value(raw: &Value) -> Result<Value, DependencyError> {
    if let Some(value) = raw.get("stringValue").and_then(Value::as_str) {
        return Ok(Value::String(value.to_owned()));
    }
    if let Some(value) = raw.get("integerValue").and_then(Value::as_str) {
        let integer = value.parse::<i64>().map_err(|_| DependencyError)?;
        return Ok(Value::Number(Number::from(integer)));
    }
    if let Some(value) = raw.get("doubleValue").and_then(Value::as_f64) {
        return Number::from_f64(value)
            .map(Value::Number)
            .ok_or(DependencyError);
    }
    if let Some(value) = raw.get("booleanValue").and_then(Value::as_bool) {
        return Ok(Value::Bool(value));
    }
    if raw.get("nullValue").is_some() {
        return Ok(Value::Null);
    }
    if let Some(value) = raw.get("timestampValue").and_then(Value::as_str) {
        return Ok(Value::String(value.to_owned()));
    }
    if let Some(values) = raw
        .get("arrayValue")
        .and_then(|array| array.get("values"))
        .and_then(Value::as_array)
    {
        return values
            .iter()
            .map(decode_value)
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array);
    }
    if raw.get("arrayValue").is_some() {
        return Ok(Value::Array(Vec::new()));
    }
    if let Some(raw_fields) = raw
        .get("mapValue")
        .and_then(|map| map.get("fields"))
        .and_then(Value::as_object)
    {
        let mut fields = Map::with_capacity(raw_fields.len());
        for (name, value) in raw_fields {
            fields.insert(name.clone(), decode_value(value)?);
        }
        return Ok(Value::Object(fields));
    }
    if raw.get("mapValue").is_some() {
        return Ok(Value::Object(Map::new()));
    }
    Err(DependencyError)
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
    use serde_json::json;

    fn job(owner: Option<&str>, shared_with_user: &[&str]) -> JobRecord {
        JobRecord {
            id: "job-1".to_owned(),
            owner_user_id: owner.map(str::to_owned),
            enabled: true,
            name: Some("Berlin".to_owned()),
            shared_with_user: shared_with_user
                .iter()
                .map(|value| (*value).to_owned())
                .collect(),
            providers: Vec::new(),
            notification_adapter_refs: Vec::new(),
            deal_type: Some("rent".to_owned()),
            last_run_at: None,
        }
    }

    #[test]
    fn access_is_owner_or_explicit_share_without_admin_bypass() {
        assert!(job(Some("owner"), &[]).is_accessible_to("owner"));
        assert!(job(Some("owner"), &["shared"]).is_accessible_to("shared"));
        assert!(!job(Some("owner"), &[]).is_accessible_to("admin"));
        assert!(job(Some("owner"), &["admin"]).is_accessible_to("admin"));
    }

    #[test]
    fn missing_or_empty_identity_fails_closed() {
        assert!(!job(None, &[]).is_accessible_to(""));
        assert!(!job(None, &[]).is_accessible_to("user"));
        assert!(!job(Some("owner"), &[]).is_accessible_to(""));
    }

    #[test]
    fn firestore_values_decode_nested_arrays_and_maps() {
        let decoded = decode_value(&json!({
            "mapValue": { "fields": {
                "enabled": { "booleanValue": true },
                "users": { "arrayValue": { "values": [
                    { "stringValue": "owner" },
                    { "stringValue": "shared" }
                ] } },
                "count": { "integerValue": "42" }
            } }
        }))
        .unwrap();
        assert_eq!(decoded["enabled"], true);
        assert_eq!(decoded["users"], json!(["owner", "shared"]));
        assert_eq!(decoded["count"], 42);
    }
}
