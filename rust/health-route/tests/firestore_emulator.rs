use std::env;
use std::sync::Arc;

use fredy_health_route::auth::{
    AccessTokenProvider, AllowedUser, DependencyError, FirestoreIdentityStore, IdentityStore,
    UserIdentity,
};
use reqwest::blocking::Client;
use serde_json::{json, Value};

struct MustNotUseOAuth;
impl AccessTokenProvider for MustNotUseOAuth {
    fn access_token(&self) -> Result<String, DependencyError> {
        panic!("emulator Firestore calls must not request OAuth");
    }
}

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

fn read_document(client: &Client, url: &str) -> Value {
    let response = client.get(url).send().unwrap();
    assert!(
        response.status().is_success(),
        "{}",
        response.text().unwrap()
    );
    response.json().unwrap()
}

#[test]
#[ignore = "requires FIRESTORE_EMULATOR_HOST and the repository emulator"]
fn firestore_identity_store_reads_and_writes_real_emulator_documents() {
    let Some(host) = emulator_host() else {
        return;
    };
    let project = env::var("FIRESTORE_PROJECT_ID").unwrap_or_else(|_| "fredy-compose".to_owned());
    let client = Client::new();
    let purge =
        format!("http://{host}/emulator/v1/projects/{project}/databases/(default)/documents");
    let purge_response = client.delete(purge).send().unwrap();
    assert!(purge_response.status().is_success());

    let store = FirestoreIdentityStore::from_environment(
        project.clone(),
        client.clone(),
        Arc::new(MustNotUseOAuth),
    )
    .unwrap();

    assert_eq!(store.allowed_user("missing@example.com").unwrap(), None);

    let allowed_url = document_url(&host, &project, "allowed_users", "alice@example.com");
    write_document(
        &client,
        &allowed_url,
        json!({
            "email": { "stringValue": "alice@example.com" },
            "isAdmin": { "booleanValue": true }
        }),
    );
    assert_eq!(
        store.allowed_user("alice@example.com").unwrap(),
        Some(AllowedUser { is_admin: true })
    );

    let user_url = document_url(&host, &project, "users", "uid-alice");
    assert_eq!(store.user_identity("uid-alice").unwrap(), None);
    store
        .upsert_user("uid-alice", "alice@example.com", true, None)
        .unwrap();
    assert_eq!(
        store.user_identity("uid-alice").unwrap(),
        Some(UserIdentity {
            username: "alice@example.com".to_owned(),
            is_admin: true,
        })
    );
    let created = read_document(&client, &user_url);
    assert_eq!(created["fields"]["lastLogin"]["nullValue"], Value::Null);

    write_document(
        &client,
        &user_url,
        json!({
            "username": { "stringValue": "old@example.com" },
            "isAdmin": { "booleanValue": false },
            "lastLogin": { "integerValue": "123456789" }
        }),
    );
    let existing = store.user_identity("uid-alice").unwrap().unwrap();
    store
        .upsert_user("uid-alice", "new@example.com", true, Some(&existing))
        .unwrap();
    assert_eq!(
        store.user_identity("uid-alice").unwrap(),
        Some(UserIdentity {
            username: "new@example.com".to_owned(),
            is_admin: true,
        })
    );
    let updated = read_document(&client, &user_url);
    assert_eq!(updated["fields"]["lastLogin"]["integerValue"], "123456789");
}
