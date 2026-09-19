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
- [ ] Commit and push the `firebase-bearer-auth` branch; open its protected-mainline PR.
- [ ] Deploy the immutable commit image to GCP and smoke-test authentication without waiting on monitoring.

## Next

- [ ] Host the frontend on GitHub Pages with exact-origin CORS.
- [ ] Add mandatory profile setup after first Firebase registration; keep Settings edit-only afterward.
- [ ] Remove upstream phone-home/update integrations.
- [ ] Implement the selected Paper / forest visual system from the approved light and dark screenshots.
- [ ] Migrate frontend tooling to Bun and frontend source/tests to strict TypeScript with cached CI under 60 seconds.
- [ ] Rewrite the backend in Rust behind frozen API/provider/Firestore contracts.
