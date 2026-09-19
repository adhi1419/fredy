# Fredy split deployment: Cloud Run API + GitHub Pages

Fredy's hosted frontend lives at [https://adhi1419.github.io/fredy/](https://adhi1419.github.io/fredy/).
Cloud Run is API-only: it serves `/api` and `/health`; GitHub Pages serves the hash-routed React SPA.
The API image still includes CloakBrowser and its browser/runtime dependencies for provider scraping.

## Runtime architecture

- Firestore is the only persistence layer. Cloud Run uses its runtime service account through ADC.
- Production requires `FIREBASE_WEB_CONFIG`; Firebase Authentication runs in the browser and API requests carry Firebase bearer tokens.
- Every authenticated request rechecks the Firestore `allowed_users` collection.
- `EXTERNAL_SCHEDULER=true` disables the internal timer and scrape-on-boot.
- Cloud Scheduler calls `POST /api/trigger` with `X-Trigger-Token`.
- One GitHub Actions `Deploy` run detects changed production inputs, then starts Cloud Run API and Pages build jobs in parallel. Unchanged surfaces are skipped.
- Pull requests build the real backend image, publish a minimal BuildKit cache at `ghcr.io/adhi1419/fredy:buildcache`, and push the runnable image under `candidate-<backend-context-hash>`.
- A push to `main` computes the same hash and promotes that exact validated candidate to an immutable Artifact Registry SHA tag without rebuilding. If no exact candidate exists, a GitHub-runner Buildx fallback imports the shared cache. Cloud Run then performs an image-only rollout and preserves existing environment variables and secrets.

## One-time infrastructure bootstrap

```bash
PROJECT=fredy-$(whoami)
REGION=europe-west1

gcloud projects create "$PROJECT"
gcloud config set project "$PROJECT"
# Billing must be linked even when usage remains inside the free tier.

gcloud services enable run.googleapis.com firestore.googleapis.com \
  cloudscheduler.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com firebase.googleapis.com \
  identitytoolkit.googleapis.com

gcloud firestore databases create --location="$REGION"
```

Attach Firebase to the project, create a Firebase web app, enable Google sign-in, and save its web configuration as `firebase-web-config.json`. Seed the first administrator manually:

```text
allowed_users/<lowercase-email>
{ email, isAdmin: true, addedAt }
```

Run the full helper once. It creates/reconciles Artifact Registry, cleanup policies, Cloud Run configuration, trigger token, optional Gemini secret attachment, and Scheduler:

```bash
./scripts/deploy-cloud-run.sh "$PROJECT" "$REGION"
```

The helper sets `FRONTEND_ORIGIN=https://adhi1419.github.io` and `FRONTEND_URL=https://adhi1419.github.io/fredy/`. Confirm `/health` before enabling automatic deployments.

Configure keyless GitHub deployment:

```bash
./scripts/setup-github-deploy.sh "$PROJECT" adhi1419/fredy
```

Store the printed `WIF_PROVIDER` and `GCP_SA_EMAIL` as repository Actions variables. Also configure `GCP_PROJECT_ID` and `GCP_REGION`.

The GitHub deployer only needs Artifact Registry write, Cloud Run administration, service-usage consumption, and permission to act as the runtime service account. Bootstrap remains a human-administered operation rather than part of every merge.

## Combined steady-state deployment

`.github/workflows/deploy.yml` is the only automatic deployment workflow. A short change-detection job classifies the merged commit, then the applicable jobs fan out:

- **Cloud Run API:** `lib/**`, `index.js`, `Dockerfile`, `scripts/backend-image-key.sh`, `package.json`, `yarn.lock`, or the deploy workflow.
- **GitHub Pages:** `ui/**`, `index.html`, `vite.config.js`, `package.json`, `yarn.lock`, or the deploy workflow.
- **Manual dispatch:** runs both surfaces.

Cloud Run and the Pages build both depend only on change detection, so they run in parallel. Pages publication depends only on its build and does not wait for Cloud Run. Each surface keeps separate job-level permissions and concurrency: an active API rollout is never cancelled, while a newer Pages rollout may replace an older one.

The Cloud Run job:

1. Authenticates with Workload Identity Federation.
2. Logs in to Artifact Registry and GHCR with short-lived credentials.
3. Promotes the exact PR-validated image when its backend-context hash matches.
4. Falls back to a shared-cache Buildx build when no exact candidate exists.
5. Updates only the Cloud Run image and verifies `/health`.

The Pages jobs:

1. Validate `CLOUD_RUN_API_ORIGIN`.
2. Install locked dependencies with lifecycle scripts disabled.
3. Build the `/fredy/` production bundle.
4. Upload and publish the Pages artifact.

Neither surface runs for tests or documentation alone. The workflow deliberately does **not** rewrite repository cleanup policy, bucket lifecycle, service environment, secrets, trigger token, or Scheduler configuration. Re-run the bootstrap helper when those infrastructure settings intentionally change.

## Pages setup

Set repository variable `CLOUD_RUN_API_ORIGIN` to the Cloud Run origin without an API path. The combined Deploy workflow exposes it to Vite as `VITE_API_BASE_URL` and publishes `ui/public` at:

```text
https://adhi1419.github.io/fredy/
```

Add `adhi1419.github.io` to Firebase Authentication **Authorized domains**. Do not include `/fredy/` and do not substitute the Cloud Run host.

## Operational notes

- Without `TRIGGER_TOKEN`, `/api/trigger` returns 404.
- The Cloud Run runtime service account needs Firestore read/write and Firebase token-verification access.
- `FIREBASE_WEB_CONFIG` is client configuration, not a service-account key, but remains required.
- Datacenter IP reputation can still block browser providers; a German residential proxy may be needed.
- A trigger outside configured working hours succeeds without scraping.
- `node:22-trixie-slim` plus CloakBrowser's own browser is intentional. Generic Chromium images do not preserve CloakBrowser compatibility/fingerprint behavior.
- Application code uses BuildKit `COPY --link` layers, allowing manifests to reuse the large browser/runtime layers without downloading and extracting their filesystem for ordinary source changes. This provides the cold-parent optimization without maintaining a custom Fredy browser base image.

## Verification

```bash
./docker-test.sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8144 yarn test:contract
```

Local emulator tests do not emulate Google popup sign-in, Firebase token refresh, or cross-origin persistence. Test those against an actual Firebase project and an allowlisted account.
