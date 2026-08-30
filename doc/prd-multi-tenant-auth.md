# PRD: Fredy Multi-Tenant Auth (rev. 2)

## Context

Fredy is an open-source apartment-hunting bot (Node.js + Chromium). It has been
migrated from SQLite to Firestore (dual-backend, contract-tested — see
`doc/firestore-data-model.md`) and deploys on GCP Cloud Run
(`doc/cloud-run-deployment.md`). This PRD adds multi-tenant auth so multiple
users can share a single hosted instance, each managing their own jobs and
listings independently.

**This is a personal learning project, not a commercial product.** No
monetization, no scale ambitions, Germany-only.

Rev. 2 changes vs rev. 1: auth transport switched from per-request Bearer
tokens to a Firebase→session-cookie login exchange (SSE compatibility, less
surgery); data-model section reframed around Fredy's *existing* multi-user
model; the three open questions are resolved and baked into the design.

## Prerequisites

- Firestore migration complete (branch `firestore-migration`) ✅
- Fredy running on Cloud Run with Firestore backend ✅

## Goals

1. Replace Fredy's built-in username/password login with Firebase Auth
   (Google sign-in only)
2. Map Firebase UIDs to Fredy's internal user model
3. Guarantee per-user data isolation (jobs, listings, watch list, settings,
   notification channels)
4. Restrict access to an allowlist of approved emails

## Non-Goals

- Registration flows, password management, email verification (Google handles it)
- Admin UI for the allowlist (manual Firestore edits)
- Shared/collaborative features between tenants (Fredy's `shared_with_user`
  stays dormant)
- Billing, rate limiting, abuse prevention (allowlist is sufficient)
- Mobile app or PWA
- Instant lockout on allowlist removal (sessions live until TTL; acceptable
  for ~5 trusted users)

## Users

- You (instance admin) + up to ~5 friends/invitees, manually allowlisted
- Non-technical — they see exactly one "Sign in with Google" button

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Sign-in method | Google only | Zero password UX, verified emails, one button |
| Auth transport | **Login exchange → Fredy session cookie** (NOT Bearer-per-request) | Fredy's live updates use Server-Sent Events; `EventSource` cannot send an Authorization header. The session layer already works on Firestore. Only the login step changes; `authHook`, SSE, session TTL, and every frontend fetch stay untouched. |
| Allowlist | `allowedUsers` Firestore collection, manually edited | <5 users, no admin UI needed |
| Tenant isolation | **Reuse Fredy's existing per-user model** | Jobs carry `userId`; listings scope through their job's owner (`accessibleJobIds`); settings/watch list/channels are per-user — all contract-tested. No schema change needed. |
| Internal user id | **Firebase UID becomes the Fredy user id** at provisioning | `upsertUser` accepts an explicit `userId`; no mapping table, no join |
| Admin semantics | Invitees provisioned `isAdmin: false`; admin flag comes from the allowlist entry | Fredy's `isAdmin` means "sees everyone's data" — it is instance-admin, not per-tenant admin |
| Allowlist enforcement | At the login exchange (before any session exists) | Single enforcement point; removal takes effect at next session expiry |

## Architecture

### Auth flow

1. Frontend loads the Firebase Auth SDK → "Sign in with Google" button
2. User signs in → Firebase returns an ID token (JWT)
3. Frontend POSTs the token once to `POST /api/login/firebase`
4. Backend: verify token (Firebase Admin SDK) → look up
   `allowedUsers/{email}` → reject 403 if absent → provision-or-touch the
   Fredy user → **issue the standard Fredy session cookie**
5. Every subsequent request (API, SSE) authenticates via the existing
   session mechanism — no other endpoint changes

### Provisioning (first login)

- `users/{firebaseUid}` created via existing `upsertUser` with
  `userId = firebaseUid`, `username = email`, `isAdmin` from the allowlist
  entry, and profile extras `{ displayName, createdAt }`; `lastLogin` via the
  existing `setLastLoginToNow`
- Second login: no duplicate (upsert semantics), `lastLogin` updated
- `ensureAdminUserExists()` (admin/admin bootstrap) is **disabled when
  Firebase auth is enabled** — the instance admin is whoever's allowlist
  entry has `isAdmin: true`

### Data model

New collection only:

- `allowedUsers/{email}` → `{ email, isAdmin: boolean, addedAt }` (manual)

Everything else already exists and stays:

- `jobs` — already per-user (`userId`); UI already scopes via `queryJobs`
- `listings` — already scoped through the owning job (`accessibleJobIds`);
  no denormalized `userId` needed
- `watch_list`, `settings`, `configured_adapters` — already per-user
- `sessions` — **kept** (Firestore-backed session store from the migration)
- `users` — kept; doc id becomes the Firebase UID for new users

### Config / feature flag

`AUTH_MODE=firebase` env var (or `authMode` in config). Default `password`
keeps classic behavior — local dev and the sqlite backend never need a
Firebase project. Password-auth code is only deleted once firebase mode has
run in production for a while (cheap insurance, near-zero maintenance cost).

### What gets added

- `firebase-admin` (backend) + `firebase/auth` (frontend) dependencies
- `POST /api/login/firebase` route (verify → allowlist → provision → session)
- Frontend: replace the login form with the Google button + token POST
  (login page only; no other frontend changes)
- Startup gating: skip admin/admin bootstrap and hide password login when
  `AUTH_MODE=firebase`

### What gets removed (later, once firebase mode is proven)

- Password login UI + `POST /api/login` password path
- Password hashing/validation (`lib/services/security/hash.js` usage in login)
- NOT removed: sessionStore, authHook, session TTL — they are the transport

## Resolved questions (were open in rev. 1)

1. **Scrape scheduling** — already solved: `POST /api/trigger` → `runAll()`
   runs every enabled job across all users sequentially. Run duration grows
   linearly with users; nothing to change.
2. **Chromium concurrency** — non-issue: `executeJob` runs jobs sequentially
   with one browser at a time. 5 users × 2 providers ≈ 200s per run — well
   inside the 900s trigger/Scheduler deadline on 1 GiB.
3. **Notifications** — already multi-tenant: adapters resolve per job via the
   owner's own configured channels (ownership + visibility contract-tested).

## Testing Strategy

The 341-test dual-backend contract suite remains the backbone. New tests:

1. **Login exchange** — valid token + allowlisted → session cookie set;
   valid token + not allowlisted → 403, no user created; invalid/expired
   token → 401; `AUTH_MODE=password` → route absent (404)
2. **Provisioning** — first login creates the user with UID as id and correct
   `isAdmin`; second login updates `lastLogin` without duplicating
3. **Tenant isolation** — already covered by contract tests
   (owner/shared/admin visibility in jobs + listings); add one end-to-end
   API test: user A's session cannot list or mutate user B's jobs/listings
4. **Admin bootstrap** — with `AUTH_MODE=firebase`, no admin/admin user is
   created on empty DB

Firebase Admin's `verifyIdToken` is mocked in unit tests (fake JWT issuer);
the Firestore emulator (already wired) backs everything else. The Firebase
**Auth** emulator can be added for one end-to-end happy-path test if desired.

## Scope Estimate (agent-driven TDD)

| Component | Effort | Notes |
|---|---|---|
| `/api/login/firebase` route + allowlist check | Small | single file, well-defined contract |
| Provisioning on first login | Small | reuses `upsertUser` |
| Startup gating (`AUTH_MODE`, admin bootstrap) | Small | |
| Storage userId scoping | **None→Small** | audit only — isolation already exists and is tested |
| Frontend login swap | Small | login page only (session cookie does the rest) |
| Remove old auth | Deferred | flag-gated; delete after firebase mode is proven |
| Tests | Medium | login exchange + provisioning + one isolation E2E |

## Rollout

1. Land behind `AUTH_MODE` (default `password`) — zero behavior change
2. Create Firebase project, enable Google provider, seed `allowedUsers` with
   your email (`isAdmin: true`)
3. Flip Cloud Run env to `AUTH_MODE=firebase`, sign in, verify
4. Add friends' emails to `allowedUsers`
5. After a comfortable soak: delete the password path
