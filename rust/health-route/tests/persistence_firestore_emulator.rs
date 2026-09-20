use std::env;

use fredy_health_route::persistence::{FirestorePersistenceAdapter, PersistenceAdapter};
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
