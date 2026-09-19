# First Rust wire contract: health, auth, and SSE

This document freezes the externally observable HTTP behavior needed by the first Rust strangler
surfaces. The JSON cases in [`test/wireContracts.json`](../../test/wireContracts.json) are shared
golden inputs/expected values: a future Rust implementation should run these same cases without
changing the fixture.

## Assumptions

- Cloud Run is API-only. `/health` and `/api/**` are API routes; an unknown path returns JSON and
  never falls back to the SPA.
- The browser authenticates directly with Firebase. It sends a refreshed Firebase ID token as
  `Authorization: Bearer <token>`; there are no cookies or server sessions. Browser requests use
  `credentials: omit`.
- The production Pages origin is the exact string `https://adhi1419.github.io`. Do not reflect an
  arbitrary origin, add a path, or broaden the allowlist.

## Contract table

| Surface                | Contract                                                                                                                                                                                                                    | Authoritative executable coverage                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`          | `200`, JSON `{ "status": "ok" }`, JSON content type; no Origin is required                                                                                                                                                  | [`test/api/apiServer.test.js`](../../test/api/apiServer.test.js)                                                                                           |
| API-only fallback      | Unknown paths return `404`, JSON `{ "error": "Not found" }`; no frontend HTML fallback                                                                                                                                      | [`test/api/apiServer.test.js`](../../test/api/apiServer.test.js)                                                                                           |
| `GET /api/auth/config` | Public; returns `{ enabled, firebaseConfig }` with the public Firebase web config. It does not establish authorization.                                                                                                     | [`test/api/firebaseLoginRoute.test.js`](../../test/api/firebaseLoginRoute.test.js)                                                                         |
| `GET /api/auth/me`     | Requires one direct Firebase bearer token. Success projects only `userId`, `username`, and `isAdmin`.                                                                                                                       | [`test/api/firebaseLoginRoute.test.js`](../../test/api/firebaseLoginRoute.test.js), [`test/api/security.test.js`](../../test/api/security.test.js)         |
| Auth failures          | Missing/malformed bearer: `401 invalid authorization`; Firebase verification failure: `401 invalid token`; invalid verified claims: `401 invalid token claims`; verified identity absent from allowlist: `403 not allowed`. | [`test/api/security.test.js`](../../test/api/security.test.js)                                                                                             |
| CORS                   | Exact Pages origin only. Bearer preflight allows `GET,POST,PUT,DELETE,OPTIONS` and `Authorization,Content-Type`, returns `204` with no body, `86400` max age, and `Vary: Origin`.                                           | [`test/api/apiServer.test.js`](../../test/api/apiServer.test.js)                                                                                           |
| SSE `/api/jobs/events` | `text/event-stream`; handshake comment `: connected`; then `hello`, job-status frames, and `: ping <milliseconds>` heartbeat comments, each terminated by a blank line; heartbeat cadence is 25 seconds.                    | [`test/services/sse/sseBroker.test.js`](../../test/services/sse/sseBroker.test.js), [`test/api/wireContract.test.js`](../../test/api/wireContract.test.js) |
| Hijacked SSE CORS      | The same approved CORS headers are present on the raw/hijacked response as on an ordinary bearer response.                                                                                                                  | [`test/api/apiServer.test.js`](../../test/api/apiServer.test.js)                                                                                           |

The exact expected cases are kept in [`test/wireContracts.json`](../../test/wireContracts.json) so
parity tests can compare status, selected headers, JSON bodies, and SSE bytes without depending on
Node-specific objects.

## Not contractual

Fastify hooks, plugin prefixes, `reply.hijack()`, Node `ServerResponse`, the in-memory broker, and
module paths are implementation details. Error stack traces, log wording, timing beyond the stated
heartbeat shape/interval, and internal request state are not frozen. Rust may use different routing,
streaming, and identity modules as long as the externally observed cases and security assumptions
remain unchanged.
