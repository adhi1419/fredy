# Roadmap: GCP cost and Firestore schema health

Status file for this workstream. Each task records whether it is done, so work can resume after
context compaction. Update the `Status` line of a task when its state changes.

Branch base: `main` tracking `fork/main` (adhi1419/fredy). Project `fredy-adhi`, region
`europe-west1`. Agent gcloud: `CLOUDSDK_CONFIG=/local/home/adhitr/.config/gcloud-kiro`.

## Why

September cost was about EUR 7 (estimate; the billing export was not used):

| Driver            | Sep usage    | Free tier | Est. cost                    |
| ----------------- | ------------ | --------- | ---------------------------- |
| Cloud Run vCPU    | ~366k vCPU-s | 180k      | ~$4.5                        |
| Firestore reads   | 3.43M        | 50k/day   | ~$0.8 (now ~$2.3/mo, rising) |
| Artifact Registry | 1.16 GB      | 0.5 GB    | ~$0.07                       |

Baseline as of 2026-10-04:

- 96 triggers/day, every 15 min all day (`fredy-scrape`, Cloud Scheduler). Keep this cadence; the
  owner decided against reducing it.
- Each run takes 65–85 s and runs 2 jobs. The providers are immoscout (API),
  deutscheWohnen (API search, browser for details), inberlinwohnen and kleinanzeigen (browser).
- About 6.4k billable instance-seconds/day.
- About 260k Firestore reads/day (~2.7k per run) for 877 listings; about 19k writes/day against a
  20k free tier.
- 72 inquiries have retried on every run since 2026-09-20. They fail with permanent errors: no
  ImmoScout exposé id, or the Deutsche Wohnen listing id is missing.

Where the reads per run come from (code on `main`):

1. `getKnownListingHashesForJobAndProvider` (`lib/services/storage/firestore/listingsShared.js:187`)
   reads every listing of the job and provider, per provider, per run.
2. `reconcile()` → `getKnownListingsForRepair` (`lib/FredyPipelineExecutioner.js:211`) reads the
   same set again, per provider, per run.
3. The similarity cache reloads all non-deleted listings on every cold start and hourly
   (`similarityCache.js`, `index.js:101`).
4. `getUserSettings` (uncached query) and `getJob` are called about 6 times per provider per run.
5. node-cron tasks (alive check, geocoding, retention, travel time) run while the instance is awake.

Connectivity is disabled on this instance (`connectivityEnabled` unset), so its sweep reads nothing.

## Targets

- Firestore reads: under 50k/day (free) at the current 15-minute cadence.
- Writes stay under 20k/day.
- Cloud Run: under 180k vCPU-s/month with no testing spikes.
- No compatibility shims for data shapes that no longer exist in Firestore.
- A guard stops new schema drift.

## Plan

| Phase           | PR   | Tasks                                                  |
| --------------- | ---- | ------------------------------------------------------ |
| 0 Foundations   | PR 1 | T0.1 backup, T0.2 read metering, T0.3 migration runner |
| 1 Cost          | PR 1 | T1.1 – T1.5                                            |
| 2 Schema parity | PR 2 | T2.1 – T2.6                                            |
| 3 Verify        | —    | T3.1                                                   |

Delivery follows the repo's standing flow: feature branch, PR, `gh pr merge --auto --rebase`, and
deploy on merge. Run `yarn lint`, `yarn format:check`, `yarn test:offline` and, when storage
changes, `yarn test:contract` against the emulator. Anything that writes to production data
(a migration live run, Cloud Scheduler) needs the owner's explicit OK.

---

## Phase 0: Foundations

### T0.1 Back up Firestore before any data change

Status: DONE (gs://fredy-adhi-backups/2026-10-04-pre-migration)

- Goal: a restorable snapshot taken before any migration.
- Steps: run the existing `backupRestoreService` zip export, or
  `gcloud firestore export gs://fredy-adhi-backups/<date>` (create the bucket in `europe-west1`
  with a 30-day lifecycle delete rule).
- Owner prerequisite, needed for the Admin SDK scripts:
  `CLOUDSDK_CONFIG=/local/home/adhitr/.config/gcloud-kiro gcloud auth application-default login`.
- Acceptance: the backup exists, and its per-collection document counts match a live count.

### T0.2 Per-run Firestore read and write metering

Status: DONE (PR #91, "Firestore usage for run" log line)

- Goal: prove where reads go instead of inferring it, and keep proving it.
- Change: add a thin counter in `FirestoreConnection` (wrap `get()` on queries and doc refs to add
  `snapshot.size` or 1; count writes in batches and `set`/`update`). Use an AsyncLocalStorage
  scope per trigger run and per cron task. Log one line at the end of each run:
  `Firestore usage run=<id> reads=<n> writes=<n> byPhase={findNew:…, reconcile:…, …}`.
- Files: `lib/services/storage/firestore/FirestoreConnection.js`, `jobExecutionService.js`,
  `lib/services/crons/*.js`.
- Acceptance: a unit test shows the counter attributes reads to the active scope. One live run's
  log line accounts for roughly 2.7k reads before PR 1 lands.

### T0.3 Migration runner

Status: DONE (PR #91)

- Goal: one-shot, idempotent data migrations that run exactly once.
- Change: add `scripts/migrations/run.js` and `scripts/migrations/NNN-name.js`, where each module
  exports `{ id, description, async plan(db), async apply(db, plan) }`.
  - `--dry-run` (the default) prints per-collection counts and 5 sample doc ids per change.
  - `--apply` requires a dry run with the same plan hash in the last 24 h.
  - Applied ids are recorded in `_migrations/<id>` with `{ appliedAt, counts, planHash }`, and an
    applied migration is skipped.
  - Writes are batched at 400 per batch.
- Acceptance: emulator tests show that a second run is a no-op, that dry-run writes nothing, and
  that a half-applied run resumes cleanly.

## Phase 1: Cost (PR 1)

### T1.1 Known-hash lookup scales with scraped rows, not stored rows

Status: DONE (PR #91)

- Change: replace `getKnownListingHashesForJobAndProvider(jobId, providerId)` with
  `findKnownHashes(jobId, providerId, hashes)`. It queries
  `where('jobId','==',jobId).where('hash','in',batch)` in batches of 30 and runs batches in
  parallel. Update `_findNew` (`FredyPipelineExecutioner.js:550`).
- Check: whether this needs a composite index (`jobId` + `hash`). If it does, add it to
  `firestore.indexes.json` and deploy it.
- Acceptance: unit test plus emulator contract test (same result set as before). A metered run
  shows reads for this phase of about the number of scraped listings, not about 876.

### T1.2 Targeted reconcile query (replaces the hourly-throttle idea)

Status: DONE (PR #91)

- Problem: `reconcile()` re-reads every listing per provider on every run, just to find a handful
  of repairable rows.
- Change: replace `getKnownListingsForRepair` with `getListingsNeedingRepair(jobId, providerId)`.
  It runs a union of equality queries scoped to `jobId` + `provider` + `manuallyDeleted == false`,
  deduped by id:
  - `notificationComplete == false`
  - `inquirySendStatus == null` / `== 'failed'`
  - `inquiryMessage == null`
  - `latitude == null` / `== -1`

  It returns the same row shape as before. This relies on M005, which makes these fields always
  present.

- Owner decision 2026-10-04: go straight to this; no hourly throttle.
- Acceptance: emulator test showing that healthy rows are not returned, and that every repair
  category is returned. Metered reconcile reads equal the broken-row count.

### T1.3 Permanent inquiry failures are terminal

Status: DONE (PR #91; migration 001 applied, 74 rows)

- Problem: 72 rows retry on every run. `isInquiryActionMissed` (`lib/services/jobs/searchRepair.js:107`)
  treats every `failed` as retryable, including validation failures that can never succeed.
- Change: give `InquiryDeliveryError` (`lib/services/inquiries/errors.js`) a `permanent` flag. Set
  it at the validation throw sites (missing exposé id, missing listing id, ineligible listing), and
  audit all 41 `new InquiryDeliveryError(` sites. Persist `inquirySendStatus: 'rejected'` with the
  error message. The planner treats `rejected` as closed; the UI shows it as "Can't apply
  automatically".
- Data fix: migration `001-inquiry-rejected` moves the existing 72 rows, matched on the known
  permanent error strings, to `rejected`.
- Acceptance: unit tests per error class. After deploy, no "Repair: could not retry inquiry"
  lines in a 24 h log window.

### T1.4 Per-run memo for job, user and settings reads

Status: DONE (PR #91)

- Change: `FredyPipelineExecutioner` loads `job`, `user` and `userSettings` once in the
  constructor or `execute()`, and passes them to the steps. That removes about 6 `getJob` and
  `getUserSettings` calls per provider. Do not add a global cache: settings edits must still take
  effect on the next run.
- Acceptance: a test asserts one `getUserSettings` and one `getJob` call per provider run.

### T1.5 One browser per trigger, launched lazily

Status: DONE (PR #91, lazy getBrowser thunk); since superseded -- every provider is fetched over plain
HTTP and the detail-page stage (`fetchDetails`) was removed, so no browser exists to launch.

- Change: `runAll` owns the browser. It launches on the first provider that needs one and closes
  in `finally` after all jobs. API-only providers never launch it. A provider declares the need
  through `metaInformation.needsBrowser` (true for crawler-based providers, those without
  `getListings`) or by asking lazily through a `getBrowser()` thunk passed in place of `browser`.
  The thunk is preferred because `fetchDetails` needs a browser only for new listings.
- Acceptance: test that two jobs launch the browser once, and that an API-only run with no new
  listings launches none. Live median run duration drops (target under 55 s).

## Phase 2: Schema parity (PR 2)

Order: write each migration, dry-run it, get the owner's OK, apply it, then remove the shim it
made obsolete in the same PR. The deploy happens after the live apply.

Current drift, from a full scan of every document on 2026-10-04:

| Collection | Drift                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| listings   | 487/877 have `lifecycle`; 42 still have only the legacy `status`; inquiry fields on 173/877 mix `null` and missing |
| jobs       | both still carry the job-level `autoSendInquiry` alongside per-provider `applicationPolicy`                        |
| sessions   | 5 docs; no code reads them (auth is Firebase bearer)                                                               |
| users      | `password` and `mcpToken` on both docs; unused in code                                                             |
| settings   | JSON-string values in an optional `{value}` envelope; snake_case `create_date`                                     |

### T2.1 M002 lifecycle backfill

Status: DONE (migration 002 applied; legacy status reading removed; listing view that used it deleted)

- Apply: every listing without `lifecycle` gets one derived by `lifecycleFromData` (this maps the
  legacy `status`; otherwise `{state:'new', source:null, changedAt:createdAt, …}`). Then delete
  `status` from all listings.
- Shim removal: drop `readLegacyStatus`, `LEGACY_STATUS_TO_LIFECYCLE`, `legacyStatusPayload` and
  the dual-writes in `listingsLifecycle.impl.js` (around lines 524, 565, 569, 620). Drop the API
  `status` payload in `listingsRouter.js:480` if the UI no longer sends it (check `ui/src`).
- Acceptance: 877/877 have `lifecycle` and 0 have `status`. Lifecycle tests still pass.

### T2.2 M003 application policy: drop job-level `autoSendInquiry`

Status: DONE (migration 003 applied; UI draft/summary use per-source policy)

- Apply: for each job, write the resolved per-provider `applicationPolicy` using the current
  `normalizeJobProviders(sources, autoSendInquiry, {legacyPrecedence:true})` result, then delete
  `autoSendInquiry`.
- Shim removal: drop the `legacyAutoSendInquiry` and `legacyPrecedence` parameters in
  `applicationPolicy.js`, `applicationPolicyExecution.js`, `jobStorage.js:122`, `jobRouter.js:224`
  and `FredyPipelineExecutioner.js:125/277/633`.
- Acceptance: the effective policy per provider is identical before and after (dry run asserts
  it). The job API rejects or ignores `autoSendInquiry`.

### T2.3 M004 remove dead data

Status: DONE (migration 004 applied)

- Apply: delete the `sessions` collection, and remove `users.password` and `users.mcpToken`.
- First, confirm that nothing under `lib/` or `ui/` reads them (already checked on 2026-10-04:
  0 references), and that `hash.js` legacy-password code is unused. If it is, delete it too.
- Code: remove `COLLECTIONS.SESSIONS`.
- Acceptance: grep is clean and the collections and fields are gone. Login still works through
  Firebase.

### T2.4 M005 optional-field convention

Status: DONE (migration 005 applied; snake_case fallbacks removed)

- Decision: optional listing fields are always present, set to explicit `null` when unset. This is
  what makes `where(field,'==',null)` queries possible.
- Fields: `inquiryMessage`, `inquirySendStatus`, `inquirySendStartedAt`, `inquirySentAt`,
  `inquirySendError`, `inquiryRequestId`, `notificationComplete`, `notifiedAt`, `inactiveSince`,
  `activeCheckFailures`, `lastCheckedAt`, `travelTimeFailures`, `travelTimesAt`,
  `connectivityCheckedAt`.
- Apply: backfill missing fields to `null` (counters to `0`). Change `storeListings` to write the
  full shape on insert.
- Shim removal: drop the snake_case fallbacks (`notified_at`, `inquiry_message`,
  `notification_complete`, `inquiry_send_status`) in `searchRepair.js` and
  `FredyPipelineExecutioner.js:268`. The data has no snake_case fields.
- Acceptance: every listing has every listed field, and the shim grep is clean.

### T2.5 Settings storage shape

Status: DONE (option A, PR #92 + migration 006 applied)

- Option A: keep JSON-string values, normalise to one envelope (no `{value}` wrapper), rename
  `create_date` to `createdAt`, and remove the dual-shape unwrap in `compileSettings`.
- Option B: native Firestore types per setting. More churn, little gain at 18 docs.
- Recommendation: A.

### T2.6 Schema guard

Status: DONE (schemaGuard contract test, scripts/schema-audit.js)

- Change:
  - Canonical JSDoc typedefs per collection in `lib/types/` (extend `listing.js` and `job.js`; add
    `user.js` and `setting.js`).
  - One `toFirestoreListing()` / `toFirestoreJob()` writer per collection, used by every write path.
  - An emulator contract test that writes through each writer and asserts the exact key set, with
    no unknown or legacy keys.
  - A read-only `scripts/schema-audit.js` that prints field presence per collection (the scan used
    to produce the drift table) for future checks.
- Acceptance: the contract test fails when a legacy key is reintroduced.

## Phase 2b: Remaining read and run-time hot paths

Found from the per-run usage line (1,300 reads per run after PR #94) and Cloud Monitoring.

| Source                                                          | Reads per run before                             | Fix                                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `archiveStaleListingsForJob` read every listing of the job      | 887                                              | Query only live, not-archived rows created before the cutoff (index `jobId, manuallyDeleted, lifecycle.state, createdAt`) |
| `findKnownHashes`: one read per already-stored scrape result    | ~385                                             | In-memory known-listing index (`knownListingIndex.js`); only misses are queried                                           |
| Retention purge read every inactive listing on every cold start | every inactive listing, per cold start and daily | Range on `inactiveSince` (index `isActive, inactiveSince`)                                                                |

Run time: 15 live ImmoScout listings stored the -1 "found nothing" marker because the address ends
in a district label (`..., 10551 Berlin, Tiergarten`) that Nominatim cannot match. Reconcile retried
them on every run at 1 request/s. The geocoder now retries without the trailing district, -1 is
final for reconcile, and migration 007 resets the existing -1 rows to null for one more try.

## Phase 3: Verify

### T3.1 Post-deploy measurement

Status: TODO (measure 48 h after deploy, ~2026-10-06 21:00 UTC)

- 48 h after each PR deploys, compare against the baseline: Firestore reads and writes per day
  (Cloud Monitoring `firestore.googleapis.com/document/read_count`), Cloud Run
  `container/billable_instance_time`, run duration from "Triggered job run finished", and the
  count of "Repair: could not retry inquiry" lines.
- Record the numbers in this file.

## Log

- 2026-10-04 20:52: PR #91 merged and deployed (revision fredy-00050-jf7); migrations 001-005 applied (74 / 885 / 2 / 5 sessions + 2 users / 885).
- 2026-10-04 20:59: PR #92 merged and deployed; migration 006 applied (18 settings docs; 3 retired settings deleted).
- 2026-10-04: follow-up PR removes the unrouted /listings view (last reader of the legacy status), the API-derived `status`, the job-level `autoSendInquiry` from the UI, and adds the schema guard.

- 2026-10-04: baseline measured; roadmap written; owner approved all of phases 1–2. The scheduler
  cadence stays at 15 min all day. The local branch `fix/telegram-gemini-pacing` WIP (4 files) is
  stashed as `stash@{0}` "wip on fix/telegram-gemini-pacing before main checkout 2026-10-04".
