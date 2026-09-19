# Firestore Data Model

Fredy uses Firestore for all persistence. Firebase Authentication owns browser
identity; Fredy stores the verified Firebase UID as the owner of tenant data.
There is no `sessions` collection and no cookie/session document to expire.

## Collections

| Collection | Doc ID | Notes |
|---|---|---|
| `settings` | `${userId ?? '__global__'}__${encodeURIComponent(name)}` | value kept as JSON string for exact round-trip |
| `allowed_users` | lowercase email | `{ email, isAdmin, addedAt }`; checked on every bearer-authenticated request |
| `users` | Firebase UID | server-derived user identity and Fredy admin projection |
| `jobs` | job id (nanoid) | arrays/maps stored natively (not JSON strings) |
| `configured_adapters` | channel id (nanoid) | `{ userId, adapterId, name, fields, visibility, createdAt, updatedAt }` |
| `listings` | sha1(jobId + NUL + hash) | see "Dedup" below |
| `listings/{id}/travel_times` | address key | replace-semantics per listing |
| `listings/{id}/price_history` | auto id | insert-only log |
| `watch_list` | `${listingId}__${userId}` | idempotent create for free |

## Authentication and ownership

The browser sends a Firebase ID token as `Authorization: Bearer <token>`.
Firebase Admin verifies it; the server derives the UID/email and checks
`allowed_users`. Routes use that verified UID for all ownership queries. A
request body, query parameter, or stale client-side identity cannot select a
different tenant.

## Dedup

Firestore has no unique constraints. The listing doc ID is derived
deterministically: `sha1(jobId + '\0' + hash)` where `hash` is the provider's
listing id (`item.id` at store time). `create()` fails when the doc exists —
exactly ON CONFLICT DO NOTHING. Because the ID is deterministic, new and
existing resolve to the same id.

## Compatibility semantics

- `getKnownListingHashesForJobAndProvider` returns hashes of all rows,
  including soft-deleted tombstones.
- Soft delete = `manuallyDeleted: true`; hard delete = document removal plus
  subcollections.
- `storeListings` mutates its input: `item.id` is overwritten with the doc id.
- Numeric-looking price strings are stored as numbers; everything else is stored
  verbatim.
- Booleans (`enabled`, `isAdmin`, `isActive`) are stored natively and returned
  as booleans.

## Cascades

- `removeJob` deletes the job, owned listings, subcollections, and watch-list
  entries.
- `removeUser` deletes the user and cascades every owned job as above.
- Bulk deletes are chunked into batches of at most 500 operations.

## Emulator

Development and contract tests run against the official emulator:

```bash
docker run -d --name fredy-firestore-emulator -p 127.0.0.1:8144:8144 \
  gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators \
  gcloud emulators firestore start --host-port=0.0.0.0:8144

FIRESTORE_EMULATOR_HOST=127.0.0.1:8144 yarn test:contract
```

`FirestoreConnection.clearAllData()` refuses to run when
`FIRESTORE_EMULATOR_HOST` is unset, so a misconfigured test cannot wipe a real
project. The emulator validates Firestore contracts only; it does not validate
Firebase popup login, token refresh, or browser storage persistence.
