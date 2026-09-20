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

/// Node defaults a job with no supplied deal type to `rent` on create (`DEAL_TYPES.RENT`).
const DEFAULT_DEAL_TYPE: &str = "rent";

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

    /// Mutation is strictly narrower than read: only the owner may change the search itself.
    /// This mirrors Node `canModifyJob` - neither administrator status nor an explicit share
    /// grants mutation rights, and it fails closed on a missing owner or an empty caller. The
    /// `__NO_USER__` sentinel is never a real owner, so an unauthenticated caller can never match.
    pub fn is_modifiable_by(&self, user_id: &str) -> bool {
        if user_id.is_empty() {
            return false;
        }
        self.owner_user_id.as_deref() == Some(user_id)
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

/// Caller-supplied job mutation. There is deliberately **no owner field**: ownership is assigned
/// from the authenticated actor on create and preserved from storage on update, so no caller input
/// can set or move a job to another owner. `spatial_filter`, `spec_filter`, `commute_filter`,
/// `provider`, `notification_adapter` and `blacklist` are carried as opaque JSON so this seam does
/// not re-implement Node's provider application-policy engine; it enforces ownership, the mutable
/// field whitelist, and the Firestore storage shape only.
#[derive(Debug, Clone, PartialEq)]
pub struct JobWriteInput {
    pub enabled: bool,
    pub name: Option<String>,
    pub blacklist: Vec<Value>,
    pub provider: Vec<Value>,
    pub notification_adapter: Vec<Value>,
    pub shared_with_user: Vec<String>,
    pub spatial_filter: Option<Value>,
    pub spec_filter: Option<Value>,
    pub commute_filter: Option<Value>,
    /// Node writes `autoSendInquiry` on create unconditionally (default `false`) but only when a
    /// boolean is supplied on update. `None` reproduces "omitted": preserved on update, defaulted
    /// to `false` on create.
    pub auto_send_inquiry: Option<bool>,
    /// Node defaults a missing `dealType` to `rent` on create and leaves the stored value untouched
    /// on update. `None` reproduces "omitted".
    pub deal_type: Option<String>,
}

impl Default for JobWriteInput {
    fn default() -> Self {
        Self {
            // Node's destructuring default is `enabled = true`; `upsertJob` then stores `!!enabled`.
            enabled: true,
            name: None,
            blacklist: Vec::new(),
            provider: Vec::new(),
            notification_adapter: Vec::new(),
            shared_with_user: Vec::new(),
            spatial_filter: None,
            spec_filter: None,
            commute_filter: None,
            auto_send_inquiry: None,
            deal_type: None,
        }
    }
}

/// Whether a write created a new job or updated an existing one, with the resulting access-critical
/// projection so callers never have to issue a follow-up read to learn the persisted owner.
#[derive(Debug, Clone, PartialEq)]
pub enum JobWriteOutcome {
    Created(JobRecord),
    Updated(JobRecord),
}

impl JobWriteOutcome {
    /// The persisted job projection regardless of whether it was created or updated.
    pub fn record(&self) -> &JobRecord {
        match self {
            JobWriteOutcome::Created(record) | JobWriteOutcome::Updated(record) => record,
        }
    }
}

/// A typed write failure. Authorization and input failures are distinct from opaque dependency
/// failures so the eventual route can map them to `403`/`400`/`500` without leaking Firestore
/// detail; every variant is fail-closed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JobWriteError {
    /// The authenticated actor is empty/missing, so no ownership can be assigned or checked.
    MissingIdentity,
    /// The target job id was empty, which Firestore would otherwise reject or misroute.
    InvalidJobId,
    /// The existing job is owned by someone else; mutation is owner-only (no admin/share bypass).
    NotOwner,
    /// A stored document could not be decoded into the access-critical projection.
    Malformed,
    /// An opaque downstream failure.
    Dependency,
}

impl From<DependencyError> for JobWriteError {
    fn from(_: DependencyError) -> Self {
        JobWriteError::Dependency
    }
}

/// Dormant owner-preserving write contract, kept separate from the read trait so routes can adopt
/// reads and writes independently. Create assigns ownership to the authenticated actor; update
/// mutates only an existing job owned by that actor and preserves its owner.
pub trait JobWriteAdapter {
    fn create_job(
        &self,
        job_id: &str,
        actor_user_id: &str,
        input: &JobWriteInput,
    ) -> Result<JobWriteOutcome, JobWriteError>;

    fn update_job(
        &self,
        job_id: &str,
        actor_user_id: &str,
        input: &JobWriteInput,
    ) -> Result<JobWriteOutcome, JobWriteError>;
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

    /// Write `fields` to `collection/document_id` via a Firestore REST `PATCH`. Passing an explicit
    /// `updateMask` (Node's `ref.update`) leaves fields outside the mask untouched - this is how the
    /// existing owner (`userId`) and `lastRunAt` survive an update. Omitting the mask (Node's
    /// `ref.set`) writes exactly the supplied field set for a create. Firestore `PATCH` is
    /// create-or-update, so callers enforce existence/ownership before calling this.
    fn commit_fields(
        &self,
        collection: &str,
        document_id: &str,
        fields: Value,
        update_mask: Option<&[&str]>,
    ) -> Result<(), DependencyError> {
        let request = self
            .client
            .patch(self.document_url(collection, document_id))
            .json(&serde_json::json!({ "fields": fields }));
        let mut request = self.authorize(request)?;
        if let Some(field_paths) = update_mask {
            request = request.query(
                &field_paths
                    .iter()
                    .map(|field_path| ("updateMask.fieldPaths", *field_path))
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

impl JobWriteAdapter for FirestorePersistenceAdapter {
    /// Create a job owned by the authenticated actor. Fails closed on a missing actor or job id.
    /// If a document already exists at `job_id` this is not a create, so it is routed through the
    /// owner-preserving update path rather than silently overwriting an owner.
    fn create_job(
        &self,
        job_id: &str,
        actor_user_id: &str,
        input: &JobWriteInput,
    ) -> Result<JobWriteOutcome, JobWriteError> {
        if actor_user_id.is_empty() {
            return Err(JobWriteError::MissingIdentity);
        }
        if job_id.is_empty() {
            return Err(JobWriteError::InvalidJobId);
        }
        if self.load_job_for_write(job_id)?.is_some() {
            return self.update_job(job_id, actor_user_id, input);
        }

        // Node's create branch (`ref.set`) writes the full field set, assigning `userId` from the
        // authenticated actor and stamping `lastRunAt: null`. No caller input can supply the owner.
        let mut fields = mutable_write_fields(input, WriteMode::Create);
        fields.insert("userId".to_owned(), encode_string(actor_user_id));
        fields.insert("lastRunAt".to_owned(), encode_null());
        self.commit_fields(COLLECTION_JOBS, job_id, Value::Object(fields), None)?;

        let record = self
            .load_job_for_write(job_id)?
            .ok_or(JobWriteError::Dependency)?;
        Ok(JobWriteOutcome::Created(record))
    }

    /// Update only an existing job owned by the authenticated actor. The owner (`userId`) and
    /// `lastRunAt` are outside the update mask, so Firestore preserves them exactly as Node's
    /// `ref.update` does. Administrator status and explicit shares never grant this.
    fn update_job(
        &self,
        job_id: &str,
        actor_user_id: &str,
        input: &JobWriteInput,
    ) -> Result<JobWriteOutcome, JobWriteError> {
        if actor_user_id.is_empty() {
            return Err(JobWriteError::MissingIdentity);
        }
        if job_id.is_empty() {
            return Err(JobWriteError::InvalidJobId);
        }
        let existing = self
            .load_job_for_write(job_id)?
            .ok_or(JobWriteError::InvalidJobId)?;
        if !existing.is_modifiable_by(actor_user_id) {
            return Err(JobWriteError::NotOwner);
        }

        let fields = mutable_write_fields(input, WriteMode::Update);
        // The update mask is exactly the fields we wrote: `userId` and `lastRunAt` are never in it,
        // so they cannot be cleared or reassigned by an update.
        let field_paths: Vec<&str> = fields.keys().map(String::as_str).collect();
        self.commit_fields(
            COLLECTION_JOBS,
            job_id,
            Value::Object(fields.clone()),
            Some(&field_paths),
        )?;

        let record = self
            .load_job_for_write(job_id)?
            .ok_or(JobWriteError::Dependency)?;
        Ok(JobWriteOutcome::Updated(record))
    }
}

impl FirestorePersistenceAdapter {
    /// Load a raw job projection for a write decision. Unlike `get_job`, this performs no read-side
    /// access filtering: a mutation must observe the true stored owner (including a job the actor
    /// cannot read) so it can fail closed with `NotOwner` rather than a misleading create.
    fn load_job_for_write(&self, job_id: &str) -> Result<Option<JobRecord>, JobWriteError> {
        match self.get_document(COLLECTION_JOBS, job_id) {
            Ok(Some(document)) => JobRecord::try_from(document)
                .map(Some)
                .map_err(|_| JobWriteError::Malformed),
            Ok(None) => Ok(None),
            Err(_) => Err(JobWriteError::Dependency),
        }
    }
}

/// Which Node branch a field set is being built for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WriteMode {
    Create,
    Update,
}

/// Build the Firestore field map for the mutable job whitelist, encoded as REST typed values.
///
/// This is the single source of the whitelist and matches Node `upsertJob`: `enabled`, `name`,
/// `blacklist`, `provider`, `notificationAdapter`, `sharedWithUser`, `spatialFilter` (serialized to
/// a JSON string because Firestore forbids the triple-nested arrays in a GeoJSON polygon),
/// `specFilter`, `commuteFilter`, plus the two conditional fields. `userId` and `lastRunAt` are
/// deliberately absent - the caller adds them only on create.
fn mutable_write_fields(input: &JobWriteInput, mode: WriteMode) -> Map<String, Value> {
    let mut fields = Map::new();
    fields.insert("enabled".to_owned(), encode_bool(input.enabled));
    fields.insert(
        "name".to_owned(),
        encode_optional_string(input.name.as_deref()),
    );
    fields.insert("blacklist".to_owned(), encode_array(&input.blacklist));
    fields.insert("provider".to_owned(), encode_array(&input.provider));
    fields.insert(
        "notificationAdapter".to_owned(),
        encode_array(&input.notification_adapter),
    );
    fields.insert(
        "sharedWithUser".to_owned(),
        encode_string_array(&input.shared_with_user),
    );
    fields.insert(
        "spatialFilter".to_owned(),
        encode_serialized_spatial_filter(input.spatial_filter.as_ref()),
    );
    fields.insert(
        "specFilter".to_owned(),
        encode_optional_value(input.spec_filter.as_ref()),
    );
    fields.insert(
        "commuteFilter".to_owned(),
        encode_optional_value(input.commute_filter.as_ref()),
    );

    // `autoSendInquiry`: Node writes it unconditionally on create (default false) but on update only
    // when a boolean is supplied; an omitted value keeps the stored flag.
    match (mode, input.auto_send_inquiry) {
        (WriteMode::Create, value) => {
            fields.insert(
                "autoSendInquiry".to_owned(),
                encode_bool(value.unwrap_or(false)),
            );
        }
        (WriteMode::Update, Some(value)) => {
            fields.insert("autoSendInquiry".to_owned(), encode_bool(value));
        }
        (WriteMode::Update, None) => {}
    }

    // `dealType`: Node defaults a missing value to `rent` on create, and on update writes it only
    // when supplied so an omitted value keeps the stored deal type.
    match (mode, input.deal_type.as_deref()) {
        (WriteMode::Create, deal_type) => {
            fields.insert(
                "dealType".to_owned(),
                encode_string(deal_type.unwrap_or(DEFAULT_DEAL_TYPE)),
            );
        }
        (WriteMode::Update, Some(deal_type)) => {
            fields.insert("dealType".to_owned(), encode_string(deal_type));
        }
        (WriteMode::Update, None) => {}
    }

    fields
}

fn encode_string(value: &str) -> Value {
    serde_json::json!({ "stringValue": value })
}

fn encode_optional_string(value: Option<&str>) -> Value {
    match value {
        Some(value) => encode_string(value),
        None => encode_null(),
    }
}

fn encode_bool(value: bool) -> Value {
    serde_json::json!({ "booleanValue": value })
}

fn encode_null() -> Value {
    serde_json::json!({ "nullValue": null })
}

fn encode_string_array(values: &[String]) -> Value {
    let encoded: Vec<Value> = values.iter().map(|value| encode_string(value)).collect();
    serde_json::json!({ "arrayValue": { "values": encoded } })
}

fn encode_array(values: &[Value]) -> Value {
    let encoded: Vec<Value> = values.iter().map(encode_value).collect();
    serde_json::json!({ "arrayValue": { "values": encoded } })
}

fn encode_optional_value(value: Option<&Value>) -> Value {
    match value {
        Some(value) => encode_value(value),
        None => encode_null(),
    }
}

/// Firestore forbids the triple-nested arrays in a GeoJSON polygon, so Node stores `spatialFilter`
/// as `JSON.stringify(sf)` (and `null` for absent). This reproduces that storage-shape contract so
/// the value round-trips through the existing read decoder unchanged.
fn encode_serialized_spatial_filter(value: Option<&Value>) -> Value {
    match value {
        Some(value) => match serde_json::to_string(value) {
            Ok(serialized) => encode_string(&serialized),
            Err(_) => encode_null(),
        },
        None => encode_null(),
    }
}

/// Encode a decoded JSON value back into Firestore REST typed value form. This is the inverse of
/// `decode_value`: booleans, integers, finite doubles, strings, null, arrays and nested maps.
fn encode_value(value: &Value) -> Value {
    match value {
        Value::Null => encode_null(),
        Value::Bool(inner) => encode_bool(*inner),
        Value::Number(number) => {
            if let Some(integer) = number.as_i64() {
                serde_json::json!({ "integerValue": integer.to_string() })
            } else if let Some(float) = number.as_f64() {
                serde_json::json!({ "doubleValue": float })
            } else {
                encode_null()
            }
        }
        Value::String(inner) => encode_string(inner),
        Value::Array(items) => {
            let encoded: Vec<Value> = items.iter().map(encode_value).collect();
            serde_json::json!({ "arrayValue": { "values": encoded } })
        }
        Value::Object(map) => {
            let mut encoded = Map::with_capacity(map.len());
            for (name, inner) in map {
                encoded.insert(name.clone(), encode_value(inner));
            }
            serde_json::json!({ "mapValue": { "fields": Value::Object(encoded) } })
        }
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

    fn full_input() -> JobWriteInput {
        JobWriteInput {
            enabled: true,
            name: Some("Berlin".to_owned()),
            blacklist: vec![json!("bad-word")],
            provider: vec![json!({ "id": "immoscout", "url": "https://immoscout.de/mieten" })],
            notification_adapter: vec![json!({ "configuredAdapterId": "chan-1" })],
            shared_with_user: vec!["u2".to_owned(), "u3".to_owned()],
            spatial_filter: Some(json!({
                "type": "Polygon",
                "coordinates": [[[13.404, 52.52], [13.41, 52.52], [13.41, 52.53]]]
            })),
            spec_filter: Some(json!({ "maxPrice": 1200 })),
            commute_filter: Some(json!({ "action": "notify" })),
            auto_send_inquiry: None,
            deal_type: None,
        }
    }

    #[test]
    fn job_write_input_defaults_match_node_upsert_defaults() {
        let input = JobWriteInput::default();
        assert!(input.enabled);
        assert!(input.blacklist.is_empty());
        assert!(input.provider.is_empty());
        assert!(input.notification_adapter.is_empty());
        assert!(input.shared_with_user.is_empty());
        assert_eq!(input.auto_send_inquiry, None);
        assert_eq!(input.deal_type, None);
        let fields = mutable_write_fields(&input, WriteMode::Create);
        assert_eq!(fields["enabled"], json!({ "booleanValue": true }));
    }

    #[test]
    fn mutation_is_owner_only_without_admin_or_share_bypass() {
        // Read access grants a share/owner; mutation is strictly the owner.
        assert!(job(Some("owner"), &[]).is_modifiable_by("owner"));
        assert!(!job(Some("owner"), &["shared"]).is_modifiable_by("shared"));
        assert!(!job(Some("owner"), &["admin"]).is_modifiable_by("admin"));
        assert!(!job(Some("owner"), &[]).is_modifiable_by("admin"));
    }

    #[test]
    fn mutation_fails_closed_on_missing_or_empty_identity() {
        assert!(!job(None, &[]).is_modifiable_by(""));
        assert!(!job(None, &[]).is_modifiable_by("user"));
        assert!(!job(Some("owner"), &[]).is_modifiable_by(""));
    }

    #[test]
    fn create_field_set_assigns_no_owner_and_defaults_conditionals() {
        // The caller adds userId + lastRunAt on create; the whitelist builder must never emit them.
        let fields = mutable_write_fields(&full_input(), WriteMode::Create);
        assert!(
            !fields.contains_key("userId"),
            "owner is never a mutable field"
        );
        assert!(
            !fields.contains_key("lastRunAt"),
            "lastRunAt is never mutable"
        );
        // Create writes both conditionals with their defaults.
        assert_eq!(fields["autoSendInquiry"], json!({ "booleanValue": false }));
        assert_eq!(fields["dealType"], json!({ "stringValue": "rent" }));
        // Whitelisted fields are all present and typed.
        for key in [
            "enabled",
            "name",
            "blacklist",
            "provider",
            "notificationAdapter",
            "sharedWithUser",
            "spatialFilter",
            "specFilter",
            "commuteFilter",
        ] {
            assert!(fields.contains_key(key), "missing whitelisted field {key}");
        }
    }

    #[test]
    fn create_defaults_yield_to_explicit_conditional_values() {
        let input = JobWriteInput {
            auto_send_inquiry: Some(true),
            deal_type: Some("buy".to_owned()),
            ..full_input()
        };
        let fields = mutable_write_fields(&input, WriteMode::Create);
        assert_eq!(fields["autoSendInquiry"], json!({ "booleanValue": true }));
        assert_eq!(fields["dealType"], json!({ "stringValue": "buy" }));
    }

    #[test]
    fn update_omits_conditionals_and_never_touches_owner_or_last_run() {
        let fields = mutable_write_fields(&full_input(), WriteMode::Update);
        // Owner and lastRunAt are excluded so an update preserves them via the update mask.
        assert!(!fields.contains_key("userId"));
        assert!(!fields.contains_key("lastRunAt"));
        // Omitted conditionals are absent so the stored values survive.
        assert!(!fields.contains_key("autoSendInquiry"));
        assert!(!fields.contains_key("dealType"));
    }

    #[test]
    fn update_writes_conditionals_only_when_supplied() {
        let input = JobWriteInput {
            auto_send_inquiry: Some(false),
            deal_type: Some("buy".to_owned()),
            ..full_input()
        };
        let fields = mutable_write_fields(&input, WriteMode::Update);
        assert_eq!(fields["autoSendInquiry"], json!({ "booleanValue": false }));
        assert_eq!(fields["dealType"], json!({ "stringValue": "buy" }));
    }

    #[test]
    fn name_null_is_encoded_as_firestore_null() {
        let input = JobWriteInput {
            name: None,
            ..full_input()
        };
        let fields = mutable_write_fields(&input, WriteMode::Create);
        assert_eq!(fields["name"], json!({ "nullValue": null }));
    }

    #[test]
    fn spatial_filter_is_stored_as_a_json_string_and_round_trips() {
        let input = full_input();
        let fields = mutable_write_fields(&input, WriteMode::Create);
        // Stored as a stringValue (never a nested array).
        let serialized = fields["spatialFilter"]["stringValue"]
            .as_str()
            .expect("spatialFilter is a JSON string");
        let reparsed: Value = serde_json::from_str(serialized).unwrap();
        assert_eq!(reparsed, input.spatial_filter.unwrap());
    }

    #[test]
    fn absent_optional_filters_are_encoded_as_null() {
        let input = JobWriteInput {
            spatial_filter: None,
            spec_filter: None,
            commute_filter: None,
            ..full_input()
        };
        let fields = mutable_write_fields(&input, WriteMode::Create);
        assert_eq!(fields["spatialFilter"], json!({ "nullValue": null }));
        assert_eq!(fields["specFilter"], json!({ "nullValue": null }));
        assert_eq!(fields["commuteFilter"], json!({ "nullValue": null }));
    }

    #[test]
    fn encode_value_is_the_inverse_of_decode_value() {
        let original = json!({
            "id": "immoscout",
            "enabled": true,
            "count": 42,
            "ratio": 1.5,
            "tags": ["a", "b"],
            "nested": { "url": "https://immoscout.de", "flag": false },
            "missing": null
        });
        let encoded = encode_value(&original);
        let decoded = decode_value(&encoded).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn shared_with_user_encodes_as_a_string_array() {
        let fields = mutable_write_fields(&full_input(), WriteMode::Create);
        assert_eq!(
            fields["sharedWithUser"],
            json!({ "arrayValue": { "values": [
                { "stringValue": "u2" },
                { "stringValue": "u3" }
            ] } })
        );
    }

    #[test]
    fn job_write_outcome_exposes_its_record() {
        let record = job(Some("owner"), &[]);
        assert_eq!(JobWriteOutcome::Created(record.clone()).record(), &record);
        assert_eq!(JobWriteOutcome::Updated(record.clone()).record(), &record);
    }
}
