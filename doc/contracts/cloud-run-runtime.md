# Cloud Run runtime contract for the Rust strangler

This document freezes the deployment and runtime boundary that a future Rust route group must preserve. It describes the current Node/CloakBrowser service as implemented; it is not a Rust implementation plan. The executable authority is [`test/cloudRunRuntimeContract.test.js`](../../test/cloudRunRuntimeContract.test.js), driven by [`test/contract/fixtures/cloud-run-runtime.json`](../../test/contract/fixtures/cloud-run-runtime.json).

## Current invariants

### First dormant Rust executable (no production cutover)

- `rust/health-route` is a separately executable, dependency-free Rust implementation of only `GET /health` and the API-only `404` fallback.
- It binds `0.0.0.0`, uses `PORT` when it is a valid non-zero port, and falls back to `9998`.
- Its `GET /health` response is `200`, `application/json; charset=utf-8`, and the exact bytes `{"status":"ok"}`. Unrelated paths and non-GET methods return `404` with `{"error":"Not found"}`.
- The executable is compiled and parity-tested in conditional pull-request validation only. Node remains authoritative: the Rust binary is not copied into the production image, is not started by `index.js`, and is not included in production Cloud Run workflow inputs or traffic.

### Container and process boundary

- The backend image starts from `node:22-trixie-slim`, installs the CloakBrowser system/runtime dependencies and `tini`, and runs `node index.js` through `tini` as the init process.
- The container listens on `0.0.0.0`. Its effective port is exactly `Number(process.env.PORT) || settings.port || 9998`; Cloud Run's `PORT` therefore wins over the persisted setting and the default.
- `/conf` is the image's configuration path and Docker-declared volume for self-hosted containers. The steady-state Cloud Run deployment does not mount persistent storage there, so a Rust cutover must not rely on `/conf` durability; Firestore remains the sole persistent application store. The image exposes port `9998`, carries a Docker healthcheck for `GET /health`, and copies backend `lib/` plus `index.js` without copying the SPA.
- CloakBrowser remains in this runtime. Provider and browser-heavy paths stay in Node during incremental migration; a Rust route cutover must not silently remove or replace that dependency.

### Boot, configuration, and scheduling

- In production, startup requires `FIREBASE_WEB_CONFIG` to be valid JSON containing string `projectId`, `appId`, and `apiKey`, requires `FRONTEND_ORIGIN`, and rejects `FIRESTORE_EMULATOR_HOST`.
- Firestore and Firebase Admin use Application Default Credentials. `FIREBASE_PROJECT_ID` and `GOOGLE_CLOUD_PROJECT` are project-selection hints, not credential substitutes. No service-account key path is part of the Cloud Run contract.
- Job execution is initialized before the API begins listening. With `EXTERNAL_SCHEDULER=true`, the internal timer and startup scrape are skipped; Cloud Scheduler calls `POST /api/trigger` with `X-Trigger-Token`, and the route waits for the run to finish. The trigger is machine authentication, not Firebase browser authentication.

### HTTP and browser wire

Cloud Run is API-only: `GET /health` and `/api/**` are served by the backend, while GitHub Pages serves the hash-routed SPA. Unknown paths return JSON `404 {"error":"Not found"}` and never fall back to frontend HTML.

The route, bearer, CORS, and SSE bytes are frozen by the existing [first Rust wire contract](first-rust-wire.md) and [`test/wireContracts.json`](../../test/wireContracts.json): direct Firebase `Authorization: Bearer <token>` transport, no Fredy cookie or server session, exact Pages-origin CORS, public Firebase bootstrap, allowlist-backed identity, and fetch-based SSE with its handshake, events, and heartbeat. A Rust route group must pass that wire contract rather than reproduce Fastify internals.

### Readiness and termination as actually implemented

- `/health` returns JSON `{ "status": "ok" }` and is the repository's health/readiness signal. The API does not listen until the startup work preceding `fastify.listen` has completed.
- There is no separate readiness endpoint, startup probe, or application-level `SIGTERM`/`SIGINT` drain handler in the current service. `tini` is the implemented process-level mechanism: it reaps child processes and forwards signals to the process group. Do not claim graceful application draining during the migration; add and test it separately if that becomes a requirement.

### Image promotion and environment behavior

- Pull requests build the real backend image and publish a candidate tagged by the deterministic backend-context hash. A push to `main` promotes the exact matching candidate to the immutable Artifact Registry `github.sha` tag; when no exact candidate exists, the workflow uses the shared registry cache to build the fallback image.
- The Cloud Run workflow deploys the immutable image through `deploy-cloudrun@v3` and verifies `$SERVICE_URL/health`. It supplies an image, not a replacement environment/secrets set; the existing Cloud Run environment and secrets remain the deployment boundary for route replacement.
- The one-time bootstrap helper, which is not invoked by the steady-state workflow, establishes `EXTERNAL_SCHEDULER`, `TRIGGER_TOKEN`, `FIREBASE_WEB_CONFIG`, `FRONTEND_ORIGIN`, and `FRONTEND_URL`, and optionally attaches `GEMINI_API_KEY` as a secret. It also creates or updates the `/api/trigger` Cloud Scheduler job.
- Documentation and test paths are intentionally absent from the production-input filters. This contract change must not trigger a production deployment.

## Future route-cutover procedure (not current behavior)

1. Select one API route group and keep the existing Node service authoritative for all other routes, including browser-heavy providers.
2. Implement the selected Rust handler against the HTTP/auth/CORS/SSE contract above and run the same fixture-driven parity cases against both implementations.
3. Build and promote one immutable, fully runnable image; preserve the existing Cloud Run environment, secrets, `PORT` handling, scheduler mode, and `/health` verification.
4. Cut traffic only after route-level parity is demonstrated. Roll back by promoting the prior immutable image; do not change Firebase, Firestore, scheduler, or Pages configuration as part of a route-only cutover.

## Deliberate gaps

This seam does not implement Rust, application-level graceful shutdown, a dedicated readiness probe, live Cloud Run smoke tests, Firebase browser persistence tests, or provider/browser parity tests. Those require separate route, infrastructure, or environment work and must not be inferred from this document.
