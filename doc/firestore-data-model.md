# Firestore Data Model (SQLite migration)

Design decisions for the Firestore storage backend. The behavioral source of
truth is the contract suite (`test/contract/`) — every decision here exists to
pass it unchanged.

## Collections

| Collection | Doc ID | Notes |
|---|---|---|
| `settings` | `${userId ?? '__global__'}__${encodeURIComponent(name)}` | value kept as JSON string for exact round-trip |
| `sessions` | sid | `{ data, expiresAt }` |
| `users` | user id (nanoid) | `{ username, password, lastLogin, isAdmin, mcpToken }` |
| `jobs` | job id (nanoid) | arrays/maps stored natively (not JSON strings) |
| `configured_adapters` | channel id (nanoid) | `{ userId, adapterId, name, fields, visibility, createdAt, updatedAt }` |
| `listings` | sha1(jobId + NUL + hash) | see "Dedup" below |
| `listings/{id}/travel_times` | address key | replace-semantics per listing |
| `listings/{id}/price_history` | auto id | insert-only log |
| `watch_list` | `${listingId}__${userId}` | idempotent create for free |

## Dedup (replaces UNIQUE(job_id, hash) + ON CONFLICT DO NOTHING)

Firestore has no unique constraints. The listing doc ID is derived
deterministically: `sha1(jobId + '\0' + hash)` where `hash` is the provider's
listing id (`item.id` at store time). `create()` fails when the doc exists —
exactly ON CONFLICT DO NOTHING. Because the ID is deterministic, the
"propagate the existing row's id on conflict" contract of `storeListings`
is automatic: new and existing resolve to the same id.

## Semantics carried over from SQLite (encoded in the contract suite)

- `getKnownListingHashesForJobAndProvider` returns hashes of ALL rows,
  including soft-deleted (`manually_deleted`) tombstones — the tombstone is
  what prevents re-notification.
- Soft delete = `manuallyDeleted: true` flag; hard delete = doc removal
  (+ subcollections).
- `storeListings` mutates its input: `item.id` is overwritten with the doc id.
- Price coercion mirrors SQLite column affinity: numeric-looking strings are
  stored as numbers, everything else verbatim.
- Booleans (`enabled`, `isAdmin`, `isActive`) are stored natively and returned
  as booleans (the sqlite layer coerces `0/1 -> boolean` at the API edge; the
  API shape is identical).

## Cascades (no FK support in Firestore — explicit helpers)

- `removeJob` -> delete job doc, all listings where `jobId ==`, their
  subcollections, and their watch_list entries.
- `removeUser` -> delete user doc + cascade every owned job as above.
- All bulk deletes are chunked into batches of <= 500 ops (Firestore batch
  limit — same 500 chunk size the sqlite layer uses for bound params).

## Queries

- Equality predicates (jobId, provider, userId scoping) go to Firestore.
- Everything else — free-text filter, sorting matrix, pagination, median/KPI
  aggregation — is computed in memory after the scoped fetch. A personal Fredy
  instance holds thousands of listings, not millions; correctness beats index
  gymnastics. Composite indexes can be added later without code changes if a
  deployment outgrows this (declare in `firestore.indexes.json`).
- Counts (`numberOfFoundListings`, `jobsCount`) use Firestore `count()`
  aggregate queries where a plain count suffices.

## Emulator

Dev/test run against the official emulator (Docker):

    docker run -d --name fredy-firestore-emulator -p 127.0.0.1:8144:8144 \
      gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators \
      gcloud emulators firestore start --host-port=0.0.0.0:8144

    STORAGE_BACKEND=firestore FIRESTORE_EMULATOR_HOST=127.0.0.1:8144 yarn test:contract

`FirestoreConnection.clearAllData()` refuses to run when
`FIRESTORE_EMULATOR_HOST` is unset, so a misconfigured test run can never wipe
a real project.
