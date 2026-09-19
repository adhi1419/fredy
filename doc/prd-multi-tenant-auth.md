# PRD: Fredy direct Firebase bearer authentication

## Context

Fredy is an open-source apartment-hunting bot that uses Firestore for all
persistence and deploys on GCP Cloud Run. Authentication is provided directly
by Firebase Authentication. This design covers multi-user ownership and
allowlist enforcement without a Fredy cookie or server-side browser session.

## Goals

1. Replace the built-in username/password login with Firebase Authentication.
2. Persist browser authentication with Firebase `browserLocalPersistence`.
3. Send a refreshed Firebase ID token as `Authorization: Bearer <token>` on
   every API request and authenticated event stream.
4. Map Firebase UIDs to Fredy's existing user model.
5. Guarantee per-user isolation for jobs, listings, settings, watch lists,
   notification channels, and inquiry state.
6. Enforce an email allowlist on every authenticated request.

## Non-goals

- Fredy password registration, password changes, or password login.
- Fredy cookies, server-side browser sessions, session TTLs, or session cleanup.
- Admin UI for the allowlist; allowlist edits remain manual Firestore changes.
- Shared/collaborative tenant features.
- Mobile app or PWA.

## Key design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Sign-in | Firebase provider configured by the instance | Firebase owns identity and refresh behavior |
| Browser persistence | `browserLocalPersistence` | Reloads preserve the Firebase user without a Fredy cookie |
| Transport | `Authorization: Bearer <Firebase ID token>` | Works for normal requests and authenticated fetch-based streams |
| Verification | Firebase Admin `verifyIdToken` | The server never trusts a client-supplied user id |
| Allowlist | `allowed_users/{lowercase-email}` | Small trusted installations need no registration UI |
| Tenant id | Firebase UID | Stable server-derived owner id for all Fredy data |
| Admin | `isAdmin` on the allowlist entry, reflected server-side | Instance-admin status is controlled outside the browser |
| Machine trigger | `X-Trigger-Token` on `/api/trigger` | Scheduler is not a browser and does not use Firebase user auth |

## Runtime requirements

Production startup requires a valid `FIREBASE_WEB_CONFIG` JSON object with
`projectId`, `appId`, and `apiKey`. Firestore and Firebase Admin use Application
Default Credentials. Cloud Run obtains ADC from its runtime service account;
local production-mode runs must provide equivalent ADC. The Firestore emulator
is development-only.

## Auth flow

1. The frontend initializes Firebase once and calls
   `setPersistence(auth, browserLocalPersistence)` before sign-in.
2. The user signs in with the configured Firebase provider.
3. Each API request obtains the current ID token, refreshing it when needed,
   and sends it in the `Authorization` header.
4. The backend rejects missing, malformed, expired, or unverifiable tokens with
   `401`.
5. The backend derives the UID/email from verified claims, reads the matching
   `allowed_users` document, and rejects an absent or revoked entry with `403`.
6. The backend provisions or updates the Fredy user using the verified UID and
   allowlist admin flag, then exposes the existing Fredy user shape to routes.
7. Authenticated event streams use fetch-based streaming so the bearer header
   is present; reconnects obtain a current token and abort cleanly on logout.

Removing an allowlist entry takes effect on the next request, not at a later
cookie/session expiry. Logging out clears Firebase's browser state and stops
future authenticated streams.

## Tenant isolation

Existing storage contracts remain the source of truth:

- jobs are owned by `userId`;
- listings are reached through accessible owning jobs;
- settings, watch lists, configured channels, and inquiry safety state are
  scoped by the verified user id;
- admin visibility is derived server-side from the allowlist, never from a
  request body or query parameter.

## Removed legacy behavior

The migration removes the `AUTH_MODE` feature flag and password-default
startup path, Fastify cookie/session dependencies, Firestore session documents,
session cleanup, and reverse-proxy identity sign-in. Existing browser cookies
are not a migration credential; users must sign in through Firebase again.

## Testing strategy

- Unit/API ownership covers missing, malformed, expired, and revoked tokens;
  UID/email derivation; admin derivation; first-login provisioning; token
  refresh; authenticated streaming; and logout.
- The Firestore emulator backs storage contracts. Tests must never fall back to
  a real Firestore project.
- Offline tests do not open a real Google popup or prove browser storage
  partitioning behavior.
- A browser acceptance test against a Firebase project must verify persistence
  across reload, bearer headers on API/stream requests, revoked allowlist
  behavior, and logout.
- Docker smoke validates health and emulator read/write behavior without a
  password login or admin bootstrap document.

## Rollout and migration risks

1. Configure Firebase, authorized domains, ADC, and the first allowlist entry
   before deploying the production image.
2. Deploy the immutable image with `FIREBASE_WEB_CONFIG` and retain the machine
   trigger token.
3. Have every browser user sign in again through Firebase; old Fredy cookies
   are intentionally ignored.
4. Verify UID ownership against existing Firestore data before inviting more
   users. A mismatched UID or email allowlist id can make existing data appear
   absent without deleting it.
5. Keep a Firestore backup before the first multi-tenant rollout. Incorrect
   allowlist admin flags change visibility immediately, and revocation is
   enforced on the next request.
