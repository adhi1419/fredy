# Fredy Developer and Operator Guide

**Audience:** developers and operators of this fork
**Repository base reviewed:** `2c3915c` (main through PR #50)
**Customer application:** [https://adhi1419.github.io/fredy/](https://adhi1419.github.io/fredy/)
**Hosted API:** [https://fredy-vh63vbsl2q-ew.a.run.app](https://fredy-vh63vbsl2q-ew.a.run.app)
**Support:** [GitHub Issues](https://github.com/adhi1419/fredy/issues)

This guide describes the implementation in this repository. The customer README remains customer-facing. This file is the developer and operator reference for the split GitHub Pages and Cloud Run deployment.

## 1. Operating model

Fredy has two hosted surfaces:

* GitHub Pages serves the hash-routed React SPA at `https://adhi1419.github.io/fredy/`.
* Cloud Run serves the API at `https://fredy-vh63vbsl2q-ew.a.run.app`. The API exposes `/api/**` and `/health`; it does not serve the SPA or return frontend HTML for unknown paths.
* Firestore is the only persistent application store. The container's `/conf` path is a Docker configuration volume for self-hosted containers, not the hosted application's data store.
* Firebase Authentication owns the browser session. The browser sends a refreshed Firebase ID token in `Authorization: Bearer <token>`. Fredy does not use a Fredy cookie or a server-side browser session.

The hosted API's machine scheduler is separate from browser authentication. When `EXTERNAL_SCHEDULER=true`, Cloud Scheduler calls `POST /api/trigger` with `X-Trigger-Token`. The request stays open until the run finishes so scale-to-zero Cloud Run retains request CPU while the scrape executes.

The repository also contains release-tag workflows and a Compose default that reference the legacy `ghcr.io/orangecoding/fredy` image. Those paths support the project's self-hosted release workflow. They are not evidence that the legacy image is the hosted Cloud Run production image. Hosted production is defined by `.github/workflows/deploy.yml` and the Cloud Run service configuration it preserves.

## 2. Architecture and authority boundaries

### Startup and request flow

`index.js` performs the startup sequence before `lib/api/api.js` begins listening:

1. In production, validate `FIREBASE_WEB_CONFIG`, `FRONTEND_ORIGIN`, and the absence of `FIRESTORE_EMULATOR_HOST`.
2. Validate or download the CloakBrowser binary.
3. Ensure `conf/config.json` exists and is readable, then load it.
4. Initialize the Firestore client and load global settings.
5. Load providers, remove provider records that no longer have a module, and initialize the similarity cache.
6. Initialize `jobExecutionService`, including the trigger runner and event-bus listeners.
7. Register the Fastify API and listen on `0.0.0.0`.
8. Seed demo state when demo mode is enabled, then start background sweeps.

The ordering of job-service initialization before the API listener is intentional. A cold Cloud Run instance can receive `/api/trigger` immediately after it accepts connections.

The normal job path is:

```text
scheduler or manual trigger
  -> jobExecutionService
  -> FredyPipelineExecutioner
  -> provider createConfig(source, blocklist)
  -> scrape and normalize listings
  -> filter and deduplicate
  -> optional details and geocoding
  -> Firestore persistence
  -> notification adapter fan-out
```

Provider modules are dynamically loaded from `lib/provider/`. Notification adapters are dynamically loaded from `lib/notification/adapter/`. Both loaders resolve paths from the module location, not the process working directory.

### Authentication and authorization

The authority chain is:

1. Firebase issues the browser ID token after Google sign-in.
2. The backend verifies the token with Firebase Admin using Application Default Credentials.
3. The backend requires a non-empty UID, a normalized email, and `email_verified === true`.
4. The backend reads `allowed_users/<lowercase-email>` from Firestore on every protected request.
5. The allowlist entry supplies `isAdmin`; the backend synchronizes the Fredy user projection only when the UID, email, or admin value changes.
6. Route hooks apply the resulting identity and admin policy.

A verified token that is absent from `allowed_users` receives `403` with `{ "reason": "not allowed" }`. Token and claim failures receive `401`. Allowlist revocation and admin changes therefore take effect on the next request. Do not add a session cache, cookie fallback, or password login without changing the authentication contract and its tests.

`GET /api/auth/config` is public. It returns the public web configuration from `FIREBASE_WEB_CONFIG`; it does not establish authorization. `GET /api/auth/me` and the user routes require the bearer hook. Backup, debug, and price-tracking administration routes require the bearer hook and the admin hook.

The browser uses `browserLocalPersistence` and waits for `authStateReady()` before login actions. HTTP requests omit cookies and attach a current or refreshed Firebase token. SSE uses authenticated `fetch`, refreshes the token on reconnect, and dispatches an unauthorized event when its response is `401` or `403`.

### Firestore authority

Firestore implementations live under `lib/services/storage/firestore/`. The top-level collections defined by the repository are:

* `settings`
* `users`
* `jobs`
* `configured_adapters`
* `listings`
* `watch_list`
* `allowed_users` for the authentication allowlist

Firestore operations are asynchronous. Await storage calls, and use the contract suite when changing storage behavior. The emulator is safe for disposable local data. The real project is not.

### HTTP and CORS contract

Production cross-origin requests must use the exact origin `https://adhi1419.github.io`. The `/fredy/` path belongs to the Pages URL and must not be included in `FRONTEND_ORIGIN`.

The API allows these methods and request headers for the configured origin:

```text
Methods: GET,POST,PUT,DELETE,OPTIONS
Headers: Authorization,Content-Type
Max-Age: 86400
Vary: Origin
```

An approved preflight returns `204` with no body. A different origin is rejected without reflecting that origin. An unknown API path returns JSON `404 {"error":"Not found"}`. The SSE route copies the approved CORS headers to its raw response before hijacking the connection.

The wire contract is frozen by [`doc/contracts/first-rust-wire.md`](../doc/contracts/first-rust-wire.md), [`test/wireContracts.json`](../test/wireContracts.json), and the API tests. Preserve the observable contract rather than coupling a future implementation to Fastify internals.

## 3. Prerequisites and repository setup

Install and use:

* Node.js `>=22.22.0`, as required by `package.json` and `.nvmrc`.
* The Bun version pinned in `.bun-version` for frontend tooling.
* Docker and Docker Compose for the Firestore emulator and Docker smoke test.
* Rust toolchain `1.85.1` with `rustfmt` and `clippy` only when changing `rust/health-route`.
* Google Cloud and Firebase access only for real Firebase tests, bootstrap, or deployment. The repository does not contain a project ID, service account, secret, or Firebase OAuth client value.

Check the pinned versions before installing dependencies:

```bash
node --version
bun --version
```

The repository intentionally keeps both lockfiles. Use the package-manager path that owns the surface you are changing:

```bash
# Frontend and shared lock-policy checks
bun install --frozen-lockfile --ignore-scripts
bun run check:lockfiles

# Backend and Node test dependencies
yarn install --frozen-lockfile --ignore-scripts
```

Do not commit `firebase-web-config.json`, release credentials, provider credentials, or generated `ui/public/` output. `firebase-web-config.json` and `tools/release/config.json` are ignored by Git.

## 4. Local development

### Host-process development with the Firestore emulator

This is the fastest local path for backend and frontend work. It uses disposable Firestore data and does not provide Google popup sign-in or a production Firebase identity.

Start only the emulator from Compose:

```bash
docker compose up -d firestore-emulator
```

Start the backend in one terminal. The emulator's Compose port is `127.0.0.1:8144`:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8144 \
FIRESTORE_PROJECT_ID=fredy-local \
yarn run start:backend:dev
```

Start Vite in another terminal:

```bash
bun run start:frontend:dev
```

Vite serves the SPA at its local root and proxies `/api` to `http://0.0.0.0:9998`. Leave `VITE_API_BASE_URL` empty for this mode. Do not run the host backend and the Compose `fredy` service on port `9998` at the same time.

The backend creates `conf/config.json` when it is absent. If the file exists but is unreadable, malformed, or not a JSON object, startup fails rather than replacing operator data. Keep local runtime settings in this file and keep credentials out of it unless the setting is explicitly designed for a local secret and is protected by the application.

### Full local Compose path

Compose builds the current Dockerfile, starts the Firestore emulator, mounts `./conf` at `/conf`, and starts the API with `FIRESTORE_EMULATOR_HOST=firestore-emulator:8080` and `FIRESTORE_PROJECT_ID=fredy-compose`:

```bash
docker compose up --build
```

The API health check is available at `http://localhost:9998/health`. Remove the Compose containers to discard emulator data. The Compose file is local development support; it does not describe hosted Cloud Run production.

### Real Firebase versus the emulator

The Firestore emulator covers storage behavior. It does not validate:

* Google popup sign-in.
* Firebase ID-token issuance and refresh.
* Firebase Authentication Authorized Domains.
* Cross-origin browser persistence between GitHub Pages and the Firebase auth domain.
* Production ADC, Cloud Run service identity, or production CORS.

For an end-to-end Firebase check, use a real Firebase web configuration and a real allowlisted Google account in a non-production project. `FIREBASE_AUTH_EMULATOR_HOST` is recognized by the Firebase Admin SDK, but Compose and the repository's standard test workflows start only the Firestore emulator. Do not describe emulator tests as proof of hosted authentication.

## 5. Configuration and secret handling

### Runtime variables

The following variables are read by the current code or deployment workflows. Values marked as placeholders are intentionally not present in this repository.

| Variable | Required when | Meaning and safe handling |
| --- | --- | --- |
| `NODE_ENV` | Production runtime | `production` enables strict startup checks. Other values use development behavior. |
| `PORT` | Cloud Run supplies it | Effective API port is `Number(PORT) || settings.port || 9998`. Cloud Run's value wins. |
| `FIREBASE_WEB_CONFIG` | Production runtime | Valid JSON containing string `projectId`, `appId`, and `apiKey`. This is public Firebase web-client configuration, not a service-account key. Supply it through the deployment environment, not source control. |
| `FRONTEND_ORIGIN` | Production runtime | Exact browser origin, currently `https://adhi1419.github.io`, without `/fredy/`. It is the CORS allowlist value. |
| `FRONTEND_URL` | Hosted notification links | Full Pages URL used when notifications link back to Fredy, currently `https://adhi1419.github.io/fredy/`. |
| `FIRESTORE_EMULATOR_HOST` | Local emulator only | Emulator host and port, for example `127.0.0.1:8144`. Production startup rejects it. |
| `FIRESTORE_PROJECT_ID` | Local emulator or explicit Firestore selection | Project label used by the Firestore client. Local tests use a disposable value. It is not a credential. |
| `FIREBASE_PROJECT_ID` or `GOOGLE_CLOUD_PROJECT` | Firebase Admin project selection | Optional project-selection hints for Firebase Admin. They do not replace ADC. |
| `FIREBASE_AUTH_EMULATOR_HOST` | Optional local Firebase Auth emulator | Native Firebase Admin emulator endpoint. The standard Compose and CI paths do not start this emulator. |
| `EXTERNAL_SCHEDULER` | Hosted scheduler mode | Set to the exact string `true` to disable the internal timer and scrape-on-boot. |
| `TRIGGER_TOKEN` | Hosted scheduler mode | Secret shared with Cloud Scheduler through `X-Trigger-Token`. Never put it in a repository variable, source file, provider source, or job document. |
| `GEMINI_API_KEY` | Optional inquiry-message drafting | Secret. The current Cloud Run bootstrap attaches it from Secret Manager only when that secret exists. Without it, the feature stays disabled. |
| `GEMINI_MODEL` | Optional message-generator override | Model name override. The source default is `gemini-3.5-flash-lite`. |
| `GEMINI_TIMEOUT_MS` | Optional message-generator override | Timeout in milliseconds. The source default is `120000`. |
| `VITE_API_BASE_URL` | Pages frontend build | Build-time API origin. The deploy workflow passes `CLOUD_RUN_API_ORIGIN`; local Vite leaves it empty and uses its `/api` proxy. |
| `VITE_PAGES` | Pages frontend build | Set to `true` to build with the `/fredy/` base path. |
| `CLOUD_RUN_API_ORIGIN` | GitHub Actions Pages deployment | Repository variable containing the Cloud Run origin without an API path. The workflow maps it to `VITE_API_BASE_URL`. |

The stored `settings` collection contains application settings such as `interval`, `port`, `workingHours`, and `demoMode`. Settings are JSON values stored in Firestore. The public settings route removes non-serializable secret settings before returning data to clients. Do not treat a browser-visible settings response as a secret store.

### Authentication onboarding

The repository supplies a one-shot bootstrap helper with placeholders:

```bash
./scripts/setup-firebase-project.sh <project-id> <admin-email> [region] [billing-account-id]
```

The helper creates or finds the project, enables Firebase and deployment APIs, creates or finds a Firebase web app, writes `firebase-web-config.json`, creates Firestore, and seeds the lowercased admin email in `allowed_users` with `isAdmin: true`. It cannot enable Google sign-in. Enable Google sign-in in the Firebase console, then add the bare host `adhi1419.github.io` to Firebase Authentication Authorized Domains. Do not add a scheme, path, or trailing slash.

The allowlist document shape is:

```text
allowed_users/<lowercase-email>
{ email, isAdmin, addedAt }
```

Manage allowlist entries through an operator-controlled Firestore procedure or script. There is deliberately no admin UI for managing the allowlist. Removing an entry blocks the identity on its next protected request. Changing `isAdmin` takes effect on the next protected request as well.

## 6. Tests and validation matrix

Run the smallest applicable check first, then the full surface checks before review.

| Change | Required checks |
| --- | --- |
| Frontend TypeScript or UI behavior | `bun run typecheck:frontend`, `bun run test:frontend`, `bun run format:check`, `bun run lint`, and `bun run build:frontend` |
| Backend behavior | `TEST_MODE=offline yarn test:offline` or the focused Vitest file, followed by `yarn lint` and `yarn format:check` |
| Firestore storage contract | Start the emulator, then `FIRESTORE_EMULATOR_HOST=127.0.0.1:8144 yarn test:contract` |
| Dockerfile, Compose, browser binary, or image behavior | `./docker-test.sh` |
| Deployment workflow or toolchain | `bun run test:foundation` |
| Rust health route | `cargo fmt --check`, `cargo check --locked`, `cargo test --locked`, and `cargo clippy --locked --all-targets -- -D warnings` in `rust/health-route` |
| Provider parser | Provider test under `test/provider/`, preferably with `TEST_MODE=offline` |
| Notification adapter | Adapter test under `test/notification/` and the shipped-adapter contract test |

### Backend test modes

`yarn test:offline` sets `TEST_MODE=offline`. The test setup replaces browser extraction and provider network inputs with checked-in fixtures. It is the preferred fast regression suite and does not prove that a live portal still responds.

`yarn test` uses live provider behavior. Run it only when live provider traffic is appropriate and the required browser/runtime dependencies are available. It can contact external providers and is not a substitute for fixture tests.

For one backend test file, use the repository's documented command shape:

```bash
TEST_MODE=offline npx vitest run test/provider/immoscout.test.js
```

### Firestore contract tests

Contract tests import the production Firestore implementations and run against the official emulator. The harness clears emulator data between tests and refuses to use the purge path unless `FIRESTORE_EMULATOR_HOST` is set. Never point contract tests at a real project.

```bash
# In one terminal
docker compose up -d firestore-emulator

# In another terminal
FIRESTORE_EMULATOR_HOST=127.0.0.1:8144 yarn test:contract
```

### Rust validation

The Rust package is pinned to toolchain `1.85.1` and exact `serde_json` `1.0.140`:

```bash
cd rust/health-route
rustup toolchain install 1.85.1 --profile minimal --component rustfmt --component clippy --no-self-update
cargo fmt --check
cargo check --locked
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
```

## 7. Hosted deployment topology

### Steady-state GitHub Actions deployment

`.github/workflows/deploy.yml` is the hosted deployment workflow. A change-detection job starts the applicable surfaces in parallel:

* Backend changes build or promote the Cloud Run API image.
* Frontend changes build and publish the GitHub Pages artifact.
* A manual workflow dispatch enables both surfaces.
* Test-only and documentation-only changes do not match the production deployment filters.

The pull-request workflow builds the real backend image and, for same-repository pull requests, publishes it to GHCR as `candidate-<backend-context-hash>`. The hash is computed by [`scripts/backend-image-key.sh`](../scripts/backend-image-key.sh) from the Docker inputs. A push to `main` recomputes the hash, promotes the exact matching candidate to the immutable Artifact Registry tag `<github.sha>`, and falls back to a Buildx build using the shared GHCR cache when no exact candidate exists.

The Cloud Run job then:

1. Authenticates with Google Workload Identity Federation.
2. Logs in to Artifact Registry and GHCR with short-lived workflow credentials.
3. Deploys only the image through `google-github-actions/deploy-cloudrun@v3`.
4. Preserves the existing Cloud Run environment and secrets.
5. Verifies the resulting service's `/health` endpoint.

The Pages job validates `CLOUD_RUN_API_ORIGIN`, installs with Bun and the frozen Bun lockfile, builds with `VITE_PAGES=true` and `VITE_API_BASE_URL`, and publishes `ui/public` to GitHub Pages.

Routine mainline deployment does not run `gcloud builds submit`, does not invoke `scripts/deploy-cloud-run.sh`, and does not rewrite scheduler, environment, secret, or cleanup-policy configuration. The script is for initial bootstrap and intentional infrastructure reconciliation.

### One-time infrastructure bootstrap

The human-operated deployment helper accepts placeholders:

```bash
./scripts/deploy-cloud-run.sh <project-id> [region]
```

It builds with `cloudbuild.yaml`, creates or reconciles the Artifact Registry repository, generates or reuses `TRIGGER_TOKEN`, deploys the API-only Cloud Run service, and creates or updates the `fredy-scrape` Cloud Scheduler job at `*/15 * * * *`. It sets the hosted scheduler variables described in this guide and optionally attaches the `gemini-api-key` Secret Manager secret.

Do not run this helper as a routine replacement for the steady-state GitHub workflow. Before running it, confirm the target project, region, service, runtime identity, Firestore database, Firebase web configuration, scheduler destination, and secret attachments. The repository intentionally does not prove those account-specific values.

The separate GitHub deployment bootstrap is:

```bash
./scripts/setup-github-deploy.sh <project-id> <owner/repository>
```

It creates or finds the GitHub deployer identity and Workload Identity Federation objects, grants the roles used by the steady-state workflow, and prints `WIF_PROVIDER` and `GCP_SA_EMAIL` identifiers. Store those as GitHub Actions variables, not long-lived keys. The workflow also requires `GCP_PROJECT_ID`, `GCP_REGION`, and `CLOUD_RUN_API_ORIGIN` repository variables. The values are deployment-specific and are not present in this repository.

### Image and process contract

The production image:

* Starts from `node:22-trixie-slim`.
* Installs the CloakBrowser runtime and `tini`.
* Installs backend production dependencies from `package.json` and `yarn.lock`.
* Includes `lib/` and `index.js`, not the SPA source.
* Listens on `0.0.0.0` and uses Cloud Run's `PORT` when supplied.
* Runs `node index.js` through `tini`.
* Exposes `/health` as the health signal.

CloakBrowser remains part of the API runtime because browser-based providers depend on it. A generic Chromium image is not an equivalent replacement.

## 8. Scheduler and working-hours behavior

With `EXTERNAL_SCHEDULER=true`:

* Fredy does not start its internal timer.
* Fredy does not perform the startup scrape.
* `POST /api/trigger` is the scrape entry point.
* The trigger requires `X-Trigger-Token` and uses constant-time comparison.
* Missing configuration returns `404`, a wrong token returns `403`, and a failed run returns `500`.
* A valid request outside working hours returns success after skipping job execution.

Without external-scheduler mode, the internal scheduler starts when the configured interval is positive and performs an initial run that respects working hours. The interval is read again for later ticks, so an interval change takes effect without a restart.

Working hours are stored in global settings as `workingHours.from`, `workingHours.to`, and an optional IANA `timeZone`. Both edges must be set or neither edge is set. The accepted time format is `HH:mm`. Same-day and midnight-crossing windows are supported. The route validates malformed values, while the scheduler's defensive helper treats malformed or incomplete values as no configured window so a typo does not stop every job.

The Scheduler request is held open until the run completes. Do not change the trigger route to fire-and-forget on Cloud Run. Doing so removes the request-time CPU guarantee while scraping continues.

## 9. Operational verification and troubleshooting

### Basic hosted checks

Use the documented hosted API origin and verify the exact API-only contract:

```bash
API_ORIGIN=https://fredy-vh63vbsl2q-ew.a.run.app

curl --fail --silent --show-error "$API_ORIGIN/health"
curl --fail --silent --show-error \
  -H 'Origin: https://adhi1419.github.io' \
  "$API_ORIGIN/health"
curl --include "$API_ORIGIN/api/auth/config"
curl --include "$API_ORIGIN/api/auth/me"
curl --include "$API_ORIGIN/not-a-route"
```

Expected checks:

* `/health` returns `200` and `{"status":"ok"}`.
* The approved Pages origin receives `Access-Control-Allow-Origin: https://adhi1419.github.io` on an origin-bearing request.
* `/api/auth/config` is public and reports whether the web config is enabled. Its web config is not authorization.
* `/api/auth/me` without a bearer token returns `401`.
* An unknown path returns JSON `404`, not the SPA.

For a preflight check:

```bash
curl --include --request OPTIONS "$API_ORIGIN/api/auth/me" \
  -H 'Origin: https://adhi1419.github.io' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: Authorization, Content-Type'
```

The expected response is `204` with the exact allowed-method and allowed-header values from the CORS contract. A Cloud Run URL that works in a browser but fails only from Pages usually indicates an origin mismatch. Check that `FRONTEND_ORIGIN` has no path and that `CLOUD_RUN_API_ORIGIN` has no `/api` suffix.

### Common failure classes

**The service fails before listening.** Check production `FIREBASE_WEB_CONFIG` JSON for string `projectId`, `appId`, and `apiKey`; check that `FRONTEND_ORIGIN` is present; and check that `FIRESTORE_EMULATOR_HOST` is not set in production. Check the mounted or image-provided `conf/config.json` for permissions and valid JSON.

**The browser appears logged out after reopening Pages.** The browser client must call `setPersistence(auth, browserLocalPersistence)` before `authStateReady()`. Confirm `adhi1419.github.io` is a Firebase Authorized Domain. Do not add `/fredy/` to Authorized Domains. Local emulator tests do not prove this cross-origin browser behavior.

**Protected requests return `401`.** Inspect the browser request for exactly one `Authorization: Bearer <token>` header. Check Firebase token refresh and the Firebase Admin ADC boundary. A malformed or repeated authorization header is rejected.

**Protected requests return `403` with `not allowed`.** The verified email is not in `allowed_users`, or the allowlist entry was removed. Check the lowercased email document ID and the `isAdmin` field. Ordinary route authorization failures are separate from allowlist revocation.

**CORS returns `403`.** Compare the request `Origin` with `FRONTEND_ORIGIN` byte for byte. The production value is `https://adhi1419.github.io`. Do not use the full Pages URL, a trailing slash, the Cloud Run origin, or an arbitrary reflected origin.

**The scheduler receives `404` or `403`.** `404` means `TRIGGER_TOKEN` is absent from the API environment. `403` means the `X-Trigger-Token` value does not match. Verify the Cloud Scheduler job's target URL and header without printing the token. The trigger uses machine authentication, not Firebase browser auth.

**The scheduler returns success but no listings appear.** Check the saved `workingHours` window and IANA time zone, whether jobs are enabled, provider logs, and whether `EXTERNAL_SCHEDULER` is set as intended. A valid trigger outside the window deliberately skips execution.

**A provider or browser run fails.** Confirm the CloakBrowser binary is present and valid, inspect the provider-specific error, and check external portal reachability and bot prevention. The pipeline isolates provider errors so one failing provider does not abort the remaining providers. A German residential proxy can be required by portal IP reputation, but its credentials must remain in the supported operator configuration path and not in provider source documents.

**A notification channel exposes an empty credential field.** This is expected for a user who may use a shared channel but may not edit it. Channel list responses omit fields, and non-editors receive secret fields as empty values. Mark every token, password, API key, or webhook URL with `secret: true` in an adapter's declarative field definition.

### Backup and restore

The admin-only `/api/admin/backup` route exports Firestore data as a ZIP containing top-level collection JSON, listing subcollections, and a manifest. `POST /api/admin/backup/restore?dryRun=true` prechecks an uploaded ZIP. A real restore wipes current Firestore data before import. Treat restore as destructive:

1. Export a fresh backup first.
2. Run the dry-run precheck.
3. Confirm the manifest format and target project.
4. Restore only with an administrator identity and an intentional maintenance window.
5. Verify `/health`, authentication, allowlist access, jobs, and notifications after restore.

The restore path is not a substitute for an image rollback. It changes data; an image rollback changes executable code.

## 10. Rollback and recovery

### Application rollback

The hosted workflow deploys immutable Artifact Registry tags based on GitHub commit SHA. To roll back code, identify a known-good image tag from the Cloud Run revision history and redeploy that image while preserving the existing environment, secrets, `PORT`, scheduler mode, Firebase project, and Firestore project:

```bash
gcloud run deploy fredy \
  --image <region>-docker.pkg.dev/<project-id>/fredy/fredy:<known-good-sha> \
  --region <region>
```

Use placeholders until the operator verifies the actual project, region, service, and image repository. The repository's steady-state workflow performs image-only deployment. Do not combine a route rollback with Firebase, Firestore, scheduler, CORS, or secret changes.

After rollback, verify the revision's `/health`, the Pages-to-Cloud-Run CORS path, `/api/auth/config`, an allowlisted `/api/auth/me` request, and one controlled job or notification path. Record the revision and validation results in the operational change record.

### Data recovery

Use the admin backup/restore flow for Firestore data recovery, with the dry-run and destructive-action safeguards above. Do not purge a real Firestore project as part of local emulator testing. `clearAllData()` is explicitly emulator-only, but production restore still deletes current collections before importing the archive.

### Deployment recovery

If the Pages build fails, Cloud Run remains independently deployable because `pages-deploy` depends only on `pages-build`, and `pages-build` does not depend on `cloud-run`. If the Cloud Run rollout fails, Pages publication is not a rollback mechanism. Inspect the Cloud Run revision and `/health`, then redeploy the last known-good immutable image.

## 11. Adding providers and notification adapters

### Providers

Add a provider module under `lib/provider/` and a focused test under `test/provider/`. The module must export:

* `metaInformation` with a unique stable `id`, display `name`, and `baseUrl`. The optional `countries` field accepts lowercase ISO alpha-2 values and defaults to `['de']`; set it explicitly for non-German or multi-country providers.
* A static `config` template with `url: null`, required fields, normalization, and any provider-specific extraction hooks.
* `createConfig(sourceConfig, blocklist)`, returning a fresh run-scoped configuration with the source URL, enabled state, and blocklist filter.

Keep providers stateless. Two jobs can run concurrently, so never keep a job URL, blocklist, parser document, or other run-specific value at module scope. Use the existing provider pattern in [`CONTRIBUTING.md`](../CONTRIBUTING.md) and the contract in [`doc/contracts/plugin-contract.md`](../doc/contracts/plugin-contract.md).

Provider source data is not a credential store. A job provider source should contain provider identity, search URL, enabled state, and application policy fields accepted by `lib/services/providers/applicationPolicy.js`. Do not put provider login credentials, API keys, passwords, tokens, webhook URLs, or applicant secrets in provider source documents or provider metadata. Applicant profile values and consent data follow their existing user-settings and application contracts.

If a new provider country is added, add its map bounding box in `ui/src/components/map/countryBounds.js`. Provider metadata tests enforce stable IDs, country declarations, and normalization.

### Notification adapters

Add the adapter module under `lib/notification/adapter/`, a same-name Markdown usage description, and tests under `test/notification/`. The module must export a declarative `config` and a `send` function with this payload:

```javascript
send({ serviceName, newListings, notificationConfig, jobKey, baseUrl })
```

Export `sendPriceChange` when the adapter has a native price-change representation. The dispatcher falls back to `send` with the price-change text folded into the listing title when the optional function is absent.

The config needs a unique `id`, display `name`, `description`, adapter readme, and declarative `fields`. Mark every credential with `secret: true`. Mark one safe destination field with `target: true`. The UI and API consume these flags without adapter-specific code. Use `Promise.allSettled` for per-listing delivery so one failed notification does not swallow the rest of the batch.

A notification adapter is the integration. A notification channel is a saved Firestore configuration for that adapter. Jobs store channel references, not inline credential bags. Channel authorization separates use from edit: owners and admins can edit and read secrets, while an allowed shared user can use a channel without receiving its secret values.

Run the shipped-adapter and focused adapter tests before review:

```bash
TEST_MODE=offline npx vitest run test/notification
```

## 12. Dormant Rust route and cutover boundary

`rust/health-route` is a separately executable parity implementation. It currently covers:

* `GET /health`.
* API-only JSON `404` behavior for unrelated paths and non-GET health requests.
* Public `GET /api/auth/config` response parity, including absent and invalid web configuration.
* Exact-origin CORS behavior for the public auth-config surface.

It does not verify Firebase bearer tokens, authorize protected routes, replace provider/browser paths, or become the Cloud Run process. The Rust binary is not copied into the production Docker image, is not started by `index.js`, and is not included in production deployment filters. Node remains production-authoritative until an explicit route cutover is implemented, tested, and deployed.

Pull-request validation runs Rust checks only when `rust/**` changes. The production deployment workflow does not trigger on `rust/**`. The shared wire cases in [`test/wireContracts.json`](../test/wireContracts.json), [`doc/contracts/first-rust-wire.md`](../doc/contracts/first-rust-wire.md), and the Rust tests are the parity boundary.

A future route cutover must preserve Firebase bearer transport, exact-origin CORS, API-only fallback, Firestore authority, Cloud Run `PORT` handling, scheduler mode, image health verification, and rollback to the prior immutable image. Do not infer a live cutover from a passing Rust build or parity test.

## 13. Source of truth and unresolved operator assumptions

Use source and executable tests over older narrative material when they disagree. The primary references for this guide are:

* [`AGENTS.md`](../AGENTS.md) for repository commands and architecture conventions.
* [`package.json`](../package.json), `.bun-version`, `bunfig.toml`, `bun.lock`, and `yarn.lock` for toolchain and scripts.
* [`index.js`](../index.js), [`lib/api/api.js`](../lib/api/api.js), and [`lib/services/jobs/jobExecutionService.js`](../lib/services/jobs/jobExecutionService.js) for startup, routing, and execution authority.
* [`lib/services/security/firebaseIdentity.js`](../lib/services/security/firebaseIdentity.js), [`lib/api/security.js`](../lib/api/security.js), and Firestore storage modules for authentication and persistence.
* [`Dockerfile`](../Dockerfile), [`docker-compose.yml`](../docker-compose.yml), and [`docker-test.sh`](../docker-test.sh) for container and emulator behavior.
* [`.github/workflows/pr.yml`](../.github/workflows/pr.yml), [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), and [`scripts/backend-image-key.sh`](../scripts/backend-image-key.sh) for CI and hosted deployment behavior.
* [`doc/contracts/cloud-run-runtime.md`](../doc/contracts/cloud-run-runtime.md), [`doc/contracts/first-rust-wire.md`](../doc/contracts/first-rust-wire.md), and [`doc/contracts/plugin-contract.md`](../doc/contracts/plugin-contract.md) for frozen runtime and extension boundaries.

The following are intentionally unresolved until an operator verifies live infrastructure:

1. The Firebase/GCP project ID, Cloud Run region, Artifact Registry repository, Cloud Run runtime service identity, and Firestore database are not encoded as repository constants.
2. The current Cloud Run URL and Pages URL are documented above, but operators must verify `/health` and the deployed revision before treating them as current production state.
3. `WIF_PROVIDER`, `GCP_SA_EMAIL`, `GCP_PROJECT_ID`, `GCP_REGION`, and `CLOUD_RUN_API_ORIGIN` are GitHub configuration values. Their presence and permissions require live repository and cloud inspection.
4. The Scheduler job, trigger token, Secret Manager bindings, Firebase Authorized Domains, and Google sign-in provider require live console or API verification.
5. Local emulator validation does not prove browser Firebase persistence, real token verification, portal availability, ADC permissions, or Cloud Run rollout behavior.

When these assumptions are verified, record the account-specific values in the approved operational system. Do not add them to this repository or to provider source documents.
