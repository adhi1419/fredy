# Firestore migrations

The runner uses the existing `FirestoreConnection`: ADC in deployed environments and `FIRESTORE_EMULATOR_HOST` for emulator tests. A normal invocation is a read-only dry run. It prints one JSON summary per migration with per-collection counts and up to five sample document IDs per change, and records the full plan under the ignored `scripts/migrations/.state/dry-runs.json`.

Run a dry run for one migration:

```sh
node scripts/migrations/run.js --only 001-inquiry-rejected
```

Copy the returned `planHash`, then apply that exact plan within 24 hours:

```sh
node scripts/migrations/run.js --only 001-inquiry-rejected --apply --plan-hash <planHash>
```

Repeat the two commands for `002-lifecycle-backfill`, `003-application-policy`, `004-dead-data`, and `005-explicit-nulls` in order. Applied migrations are recorded in the Firestore `_migrations` collection and are skipped on later runs. Writes are committed in batches of 400. A dry run never writes Firestore data; its only local write is the ignored plan record required to authorize a later apply.
