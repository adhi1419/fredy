# Fredy modernization tasks

## Completed

- [x] Remove MCP integration.
- [x] Consolidate the active product line behind PR #2 to `main`.
- [x] Remove SQLite and make Firestore the sole persistence layer.
- [x] Add immutable Cloud Run image tags and reusable BuildKit caching.
- [x] Remove obsolete direct dependencies and native container build overhead.
- [x] Eliminate duplicate mainline tests/image builds with cost-optimized PR #3.
- [x] Eliminate post-merge Test/source reruns with PR #4; only Deploy runs on `main`.
- [x] Select the Paper / forest UI direction, including its near-black / sage dark variant.

## Active feature: direct Firebase bearer authentication

Architecture: Firebase Authentication is the browser session authority. The browser persists Firebase auth locally and sends a fresh ID token in `Authorization: Bearer <token>` for every API request and authenticated event stream. Fastify verifies the token, checks the Firestore email allowlist on every request, derives the Firebase UID/email server-side, and exposes the existing Fredy user shape to routes. No Fredy cookie/session or client-supplied identity remains.

- [x] Backend: replace cookie/session authentication with Firebase bearer verification and per-request allowlist enforcement.
- [x] Backend: preserve Firebase UID ownership for existing jobs, settings, channels, listings, and inquiry safety state.
- [x] Frontend: initialize Firebase once with `browserLocalPersistence`; attach refreshed bearer tokens to every API call.
- [x] Frontend: replace native `EventSource` with authenticated fetch streaming and explicit reconnect/abort handling.
- [x] Cleanup: remove password login, Firebase token exchange, session storage/cleanup, reverse-proxy auth, session TTL UI, and obsolete dependencies.
- [x] Tests: cover missing/malformed/expired tokens, allowlist revocation, admin derivation, user provisioning, token refresh, authenticated streaming, and logout.
- [x] Validate: offline suite, Firestore contracts, frontend build, lint, format, Docker smoke, and rendered Google-login flow.
- [x] Commit and push the `firebase-bearer-auth` branch; open protected-mainline PR #5.
- [x] Trigger immutable commit `21eda21` deployment to GCP through Actions run 35465344034.
- [ ] Verify deployed Google sign-in and authenticated API/SSE after the user-observed deployment finishes.

## Active feature: GitHub Pages frontend + API-only Cloud Run

Architecture: GitHub Pages serves the hash-routed SPA under `/fredy/`. A build-time API origin routes browser requests and authenticated fetch streams to Cloud Run. Cloud Run serves only `/api` plus `/health`, accepts CORS only from the exact Pages origin, and no longer installs or builds frontend dependencies. Pages performs the single frontend production build; Cloud Build performs the single backend image build.

- [x] Frontend: add one API URL resolver for requests, Firebase config, and authenticated SSE.
- [x] Frontend: build correctly under the `/fredy/` Pages base and keep asset/deep-link behavior.
- [x] Backend: add exact-origin CORS and preflight handling for Authorization/Content-Type.
- [x] Backend: replace SPA/static serving with an API health endpoint.
- [x] Deployment: add GitHub Pages workflow and inject API origin without duplicating frontend builds.
- [x] Deployment: remove frontend build layers and static dependency from the Cloud Run image.
- [x] Tests: cover API URL resolution, exact-origin CORS, preflight rejection, and API-only health.
- [x] Validate: 2,135 offline tests, 298 Firestore contracts, Pages asset path, and 49-second API image build.
- [x] Commit/push the stacked branch and open PR #6 against `firebase-bearer-auth`.
- [x] Set `CLOUD_RUN_API_ORIGIN` and enable GitHub Actions as the Pages source.
- [ ] Merge PR #5, retarget PR #6 to `main`, then merge it so API and Pages deploy together.
- [ ] Verify the live Pages URL, Google sign-in, CORS, authenticated API, and SSE.

## Next

- [ ] Add mandatory profile setup after first Firebase registration; keep Settings edit-only afterward.
- [x] Remove upstream phone-home/update integrations and the in-app donation surface.
- [ ] Map core user journeys and approve responsive UX wireframes for dashboard, listings, listing detail, job creation, and settings.
- [ ] Add Bun and strict TypeScript foundations, then migrate services, store, hooks, components, and pages by approved UX slice with cached CI under 60 seconds.
- [ ] Implement the selected Paper / forest visual system from the approved wireframes and light/dark direction.
- [ ] Rewrite the customer README with final UI screenshots and move technical setup into the developer guide.
- [ ] Rewrite the backend in Rust behind frozen API/provider/Firestore contracts.

## Completed feature: remove in-app donation surface

- [x] Remove the runtime Donate button/modal, donation-only component stylesheet, sidebar mount, locale keys, theme tokens, and obsolete locale assertion; preserve the shared heart asset used by navigation, news, and notifications.
- [x] Add a static UI regression test preventing the in-app donation surface and donation translation references from returning.
- [x] Preserve README sponsorship/attribution content, Fredy identity, LICENSE, copyright attribution, and image-404 behavior.
- [x] Validate: focused UI tests (3 files, 24 passed); offline suite (180 files passed, 1 skipped; 2,127 passed, 32 skipped); ESLint passed; scoped Prettier check passed; Pages production frontend build passed. Build emitted only the existing third-party `lottie-web` direct-eval warning.

## Completed feature: remove bundled What's New surface

- [x] Remove the runtime modal/history mounts and all bundled What's New components, styles, selection service, payload, transit image, state action, marker endpoint, legacy hash compatibility path, development mock, locale keys, and feature-specific tests.
- [x] Add a static UI regression test preventing runtime components, bundled payload, marker API, state action, and locale references from returning.
- [x] Preserve unrelated browser notification wording, release tooling, shared heart artwork, README, LICENSE, Fredy/Christian Kellner attribution, and image-404 behavior.
- [x] Validate: targeted removal and locale tests (2 files, 16 passed); offline suite (182 files passed, 1 skipped; 2,123 passed, 32 skipped); ESLint passed; Prettier check passed; copyright check passed; Pages production frontend build passed. Build emitted only the existing third-party `lottie-web` direct-eval warning.
