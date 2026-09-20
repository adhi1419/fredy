use std::env;

use fredy_health_route::persistence::{
    FirestorePersistenceAdapter, JobWriteAdapter, JobWriteError, JobWriteInput, JobWriteOutcome,
    PersistenceAdapter,
};
use reqwest::blocking::Client;
use serde_json::{json, Value};

fn emulator_host() -> Option<String> {
    env::var("FIRESTORE_EMULATOR_HOST").ok()
}

fn document_url(host: &str, project: &str, collection: &str, id: &str) -> String {
    format!("http://{host}/v1/projects/{project}/databases/(default)/documents/{collection}/{id}")
}

fn write_document(client: &Client, url: &str, fields: Value) {
    let response = client
        .patch(url)
        .json(&json!({ "fields": fields }))
        .send()
        .unwrap();
    assert!(
        response.status().is_success(),
        "{}",
        response.text().unwrap()
    );
}

fn update_document_fields(client: &Client, url: &str, fields: Value, field_paths: &[&str]) {
    let response = client
        .patch(url)
        .query(
            &field_paths
                .iter()
                .map(|field| ("updateMask.fieldPaths", *field))
                .collect::<Vec<_>>(),
        )
        .json(&json!({ "fields": fields }))
        .send()
        .unwrap();
    assert!(
        response.status().is_success(),
        "{}",
        response.text().unwrap()
    );
}

fn string(value: &str) -> Value {
    json!({ "stringValue": value })
}

fn strings(values: &[&str]) -> Value {
    json!({
        "arrayValue": {
            "values": values.iter().map(|value| string(value)).collect::<Vec<_>>()
        }
    })
}

fn seed_job(
    client: &Client,
    host: &str,
    project: &str,
    id: &str,
    owner: Option<&str>,
    shared_with_user: &[&str],
) {
    let mut fields = json!({
        "enabled": { "booleanValue": true },
        "name": string(id),
        "sharedWithUser": strings(shared_with_user),
        "provider": { "arrayValue": {} },
        "notificationAdapter": { "arrayValue": {} },
        "dealType": string("rent"),
        "lastRunAt": { "nullValue": null }
    });
    if let Some(owner) = owner {
        fields["userId"] = string(owner);
    }
    write_document(client, &document_url(host, project, "jobs", id), fields);
}

fn seed_listing(
    client: &Client,
    host: &str,
    project: &str,
    id: &str,
    job_id: &str,
    manually_deleted: bool,
) {
    write_document(
        client,
        &document_url(host, project, "listings", id),
        json!({
            "jobId": string(job_id),
            "hash": string(id),
            "provider": string("immoscout"),
            "title": string(id),
            "createdAt": { "integerValue": "1000" },
            "isActive": { "booleanValue": true },
            "manuallyDeleted": { "booleanValue": manually_deleted }
        }),
    );
}

#[test]
#[ignore = "requires FIRESTORE_EMULATOR_HOST and the repository emulator"]
fn firestore_persistence_reads_only_owned_or_explicitly_shared_jobs_and_listings() {
    let Some(host) = emulator_host() else {
        return;
    };
    let project = env::var("FIRESTORE_PROJECT_ID").unwrap_or_else(|_| "fredy-compose".to_owned());
    let client = Client::new();
    let purge =
        format!("http://{host}/emulator/v1/projects/{project}/databases/(default)/documents");
    let purge_response = client.delete(purge).send().unwrap();
    assert!(purge_response.status().is_success());

    seed_job(&client, &host, &project, "private", Some("owner"), &[]);
    seed_job(&client, &host, &project, "admin-owned", Some("admin"), &[]);
    seed_job(
        &client,
        &host,
        &project,
        "admin-shared",
        Some("owner"),
        &["admin"],
    );
    seed_job(&client, &host, &project, "missing-owner", None, &[]);

    seed_listing(
        &client,
        &host,
        &project,
        "private-listing",
        "private",
        false,
    );
    seed_listing(
        &client,
        &host,
        &project,
        "admin-owned-listing",
        "admin-owned",
        false,
    );
    seed_listing(
        &client,
        &host,
        &project,
        "admin-shared-listing",
        "admin-shared",
        false,
    );
    seed_listing(
        &client,
        &host,
        &project,
        "hidden-listing",
        "admin-owned",
        true,
    );

    let adapter = FirestorePersistenceAdapter::from_environment().unwrap();

    let admin_job_ids: Vec<_> = adapter
        .get_jobs("admin")
        .unwrap()
        .into_iter()
        .map(|job| job.id)
        .collect();
    assert_eq!(admin_job_ids, ["admin-owned", "admin-shared"]);
    assert!(adapter.get_job("private", "admin").unwrap().is_none());
    assert!(adapter.get_job("private", "owner").unwrap().is_some());

    let mut admin_listing_ids: Vec<_> = adapter
        .get_visible_listings("admin")
        .unwrap()
        .into_iter()
        .map(|listing| listing.id)
        .collect();
    admin_listing_ids.sort();
    assert_eq!(
        admin_listing_ids,
        ["admin-owned-listing", "admin-shared-listing"]
    );
    assert!(adapter
        .get_listing_by_id("private-listing", "admin")
        .unwrap()
        .is_none());
    assert!(adapter
        .get_listing_by_id("private-listing", "owner")
        .unwrap()
        .is_some());
    assert!(adapter
        .get_listing_by_id("hidden-listing", "admin")
        .unwrap()
        .is_none());
}

/* ── owner-preserving write seam ──────────────────────────────────── */

fn purge(client: &Client, host: &str, project: &str) {
    let url = format!("http://{host}/emulator/v1/projects/{project}/databases/(default)/documents");
    let response = client.delete(url).send().unwrap();
    assert!(response.status().is_success());
}

/// A minimal but complete write input. Note there is no owner field to supply: ownership is the
/// adapter's to assign and preserve.
fn write_input(name: &str) -> JobWriteInput {
    JobWriteInput {
        enabled: true,
        name: Some(name.to_owned()),
        blacklist: vec![json!("bad-word")],
        provider: vec![json!({ "id": "immoscout", "url": "https://immoscout.de/mieten" })],
        notification_adapter: Vec::new(),
        shared_with_user: vec!["viewer".to_owned()],
        spatial_filter: None,
        spec_filter: Some(json!({ "maxPrice": 1200 })),
        commute_filter: None,
        auto_send_inquiry: None,
        deal_type: None,
    }
}

/// Read the raw stored `userId` straight from the emulator, bypassing the adapter, so a test can
/// assert on the true persisted owner independently of any read-side access filtering.
fn raw_owner(client: &Client, host: &str, project: &str, id: &str) -> Option<String> {
    let url = document_url(host, project, "jobs", id);
    let response = client.get(url).send().unwrap();
    if !response.status().is_success() {
        return None;
    }
    let document = response.json::<Value>().unwrap();
    document["fields"]["userId"]["stringValue"]
        .as_str()
        .map(str::to_owned)
}

#[test]
#[ignore = "requires FIRESTORE_EMULATOR_HOST and the repository emulator"]
fn firestore_job_writes_are_owner_preserving_and_authorized() {
    let Some(host) = emulator_host() else {
        return;
    };
    let project = env::var("FIRESTORE_PROJECT_ID").unwrap_or_else(|_| "fredy-compose".to_owned());
    let client = Client::new();
    purge(&client, &host, &project);

    let adapter = FirestorePersistenceAdapter::from_environment().unwrap();

    // 1. Create: a new job is owned by the authenticated actor and defaults are applied.
    let created = adapter
        .create_job("j-create", "owner", &write_input("Created"))
        .unwrap();
    let record = match created {
        JobWriteOutcome::Created(record) => record,
        other => panic!("expected Created, got {other:?}"),
    };
    assert_eq!(record.owner_user_id.as_deref(), Some("owner"));
    assert_eq!(record.name.as_deref(), Some("Created"));
    assert_eq!(record.deal_type.as_deref(), Some("rent"));
    assert_eq!(record.last_run_at, None);
    assert_eq!(record.shared_with_user, ["viewer"]);
    assert_eq!(
        raw_owner(&client, &host, &project, "j-create").as_deref(),
        Some("owner")
    );

    // 2. Owner update: the owner mutates a whitelisted field successfully.
    let updated = adapter
        .update_job("j-create", "owner", &write_input("Renamed"))
        .unwrap();
    let record = match updated {
        JobWriteOutcome::Updated(record) => record,
        other => panic!("expected Updated, got {other:?}"),
    };
    assert_eq!(record.name.as_deref(), Some("Renamed"));
    assert_eq!(record.owner_user_id.as_deref(), Some("owner"));

    // 3. Attempted owner override: no input can move ownership. A stranger's create at an existing
    //    id is routed through update and rejected; the owner is never reassigned.
    let override_attempt = adapter.create_job("j-create", "attacker", &write_input("Hijacked"));
    assert_eq!(override_attempt, Err(JobWriteError::NotOwner));
    assert_eq!(
        raw_owner(&client, &host, &project, "j-create").as_deref(),
        Some("owner")
    );

    // 4. Shared-user denial: an explicit share grants reads, never mutation.
    assert_eq!(
        adapter.update_job("j-create", "viewer", &write_input("Shared edit")),
        Err(JobWriteError::NotOwner)
    );

    // 5. Stranger denial: an unrelated user cannot update.
    assert_eq!(
        adapter.update_job("j-create", "stranger", &write_input("Stranger edit")),
        Err(JobWriteError::NotOwner)
    );

    // 6. Unshared-admin denial: administrator status carries no mutation bypass in this contract.
    assert_eq!(
        adapter.update_job("j-create", "admin", &write_input("Admin edit")),
        Err(JobWriteError::NotOwner)
    );

    // 7. Admin-owned success: an admin may mutate a job they actually own, like any other owner.
    adapter
        .create_job("j-admin", "admin", &write_input("Admin Job"))
        .unwrap();
    let admin_updated = adapter
        .update_job("j-admin", "admin", &write_input("Admin Job Renamed"))
        .unwrap();
    assert_eq!(
        admin_updated.record().name.as_deref(),
        Some("Admin Job Renamed")
    );
    assert_eq!(
        admin_updated.record().owner_user_id.as_deref(),
        Some("admin")
    );

    // 8. Immutable owner preservation: many updates never change the stored owner, and lastRunAt
    //    (set out-of-band, as the scheduler would) survives an update untouched.
    let last_run_url = document_url(&host, &project, "jobs", "j-create");
    update_document_fields(
        &client,
        &last_run_url,
        json!({ "lastRunAt": { "integerValue": "1717000000000" } }),
        &["lastRunAt"],
    );
    adapter
        .update_job("j-create", "owner", &write_input("Owner again"))
        .unwrap();
    let after = adapter.get_job("j-create", "owner").unwrap().unwrap();
    assert_eq!(after.owner_user_id.as_deref(), Some("owner"));
    assert_eq!(after.last_run_at, Some(1_717_000_000_000));

    // Fail-closed guards: empty identity and empty id are rejected before any write.
    assert_eq!(
        adapter.create_job("j-x", "", &write_input("No actor")),
        Err(JobWriteError::MissingIdentity)
    );
    assert_eq!(
        adapter.create_job("", "owner", &write_input("No id")),
        Err(JobWriteError::InvalidJobId)
    );
    assert_eq!(
        adapter.update_job("ghost", "owner", &write_input("Missing")),
        Err(JobWriteError::InvalidJobId)
    );
}
