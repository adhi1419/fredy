# Fredy split deployment: Cloud Run API + GitHub Pages

Fredy's hosted frontend lives at [https://adhi1419.github.io/fredy/](https://adhi1419.github.io/fredy/).
The Cloud Run service is API-only: it serves `/api` and `/health`, while GitHub Pages serves the
hash-routed React SPA. Cloud Run still includes CloakBrowser and all backend runtime layers needed
for provider scraping.

## How it works

- Firestore is Fredy's only persistence layer. Cloud Run uses Application Default Credentials; no
  local database file or storage volume is required.
- Production startup requires `FIREBASE_WEB_CONFIG`. Firebase Admin and Firestore use the Cloud Run
  service account through ADC.
- The browser persists Firebase Authentication locally with `browserLocalPersistence` and sends a
  refreshed ID token as `Authorization: Bearer <token>` on API requests and authenticated event
  streams. Fredy does not issue a cookie or store a browser session.
- Fredy checks the Firestore `allowed_users` collection for every authenticated request. The Firebase
  UID is the server-derived Fredy user id.
- `EXTERNAL_SCHEDULER=true` disables Fredy's internal timer and scrape-on-boot; every scrape is driven
  by `POST /api/trigger`.
- Cloud Scheduler calls `/api/trigger` with `X-Trigger-Token`. The endpoint holds the request open
  until the run completes.
- The deployment has exactly one backend image build: the deploy script invokes Cloud Build. The
  frontend has exactly one build: the Pages workflow builds `ui/public` and deploys that artifact.

## One-time setup

```bash
PROJECT=fredy-$(whoami)
REGION=europe-west1

gcloud projects create "$PROJECT"
gcloud config set project "$PROJECT"
# Billing account must be linked (free tier still requires one).

gcloud services enable run.googleapis.com firestore.googleapis.com \
  cloudscheduler.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com firebase.googleapis.com \
  identitytoolkit.googleapis.com

gcloud firestore databases create --location="$REGION"
```

Attach Firebase to the project, create a Firebase web app, enable the Google sign-in provider, and
save the web-app JSON as `firebase-web-config.json`. Seed the first instance administrator manually:

```text
allowed_users/<lowercase-email>
{ email, isAdmin: true, addedAt }
```

The repository helper performs the image build, immutable API-only Cloud Run deploy, trigger-token
preservation, and Scheduler setup:

```bash
./scripts/deploy-cloud-run.sh "$PROJECT" "$REGION"
```

The helper passes the web config as `FIREBASE_WEB_CONFIG`, sets
`FRONTEND_ORIGIN=https://adhi1419.github.io`, and does not set an auth-mode feature flag. The Cloud
Run runtime service account must have a role that permits the required Firestore reads/writes.
Confirm that the Cloud Run service responds successfully at `/health`.

For the Pages deployment, set the repository GitHub Actions variable `CLOUD_RUN_API_ORIGIN` to the
Cloud Run service origin, without an API path suffix. The workflow projects it into
`VITE_API_BASE_URL`, runs `yarn build:frontend` once, and publishes `ui/public` to:

```text
https://adhi1419.github.io/fredy/
```

Add `adhi1419.github.io` to Firebase Authentication's **Authorized domains**. Do not add the
`/fredy/` path or the Cloud Run origin as a replacement for the Pages host.

## Notes and limits

- **Trigger auth:** without `TRIGGER_TOKEN`, `/api/trigger` answers 404. Keep the service publicly
  reachable only when the trigger token is protected and use the scheduler header exactly as
  configured.
- **ADC:** Cloud Run uses its runtime service account. Identify it with:
  `gcloud run services describe fredy --region "$REGION" --format='value(spec.template.spec.serviceAccountName)'`.
- **Firebase config:** `FIREBASE_WEB_CONFIG` is client configuration, not a service-account secret,
  but it is still required and must be valid JSON.
- **Browser auth:** authorized-domain errors, missing allowlist documents, and clock-skewed/expired ID
  tokens fail authentication before any tenant data is accessed.
- **Bot detection:** datacenter IPs can be blocked by portals. A German residential proxy may be
  required for browser-based providers.
- **Working hours:** a trigger outside the configured window returns success without scraping, so
  Scheduler cadence can stay simple.

## Local verification

The local emulator path validates storage and machine triggering only. It does not emulate Google
popup sign-in, Firebase token refresh, or cross-origin browser persistence:

```bash
./docker-test.sh
```

The Docker smoke test waits for the API-only `/health` endpoint and then verifies Firestore and the
bundled CloakBrowser runtime. For the Firestore contract suite:

```bash
# Start the official emulator, then:
FIRESTORE_EMULATOR_HOST=127.0.0.1:8144 yarn test:contract
```

To test real browser authentication, use a Firebase project, a valid `FIREBASE_WEB_CONFIG`, the
Firebase authorized domain `adhi1419.github.io`, and an allowlisted email. Do not point local tests
at a production Firestore project merely to exercise the emulator contracts.
