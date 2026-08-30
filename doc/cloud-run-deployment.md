# Fredy on Cloud Run (free tier)

Run Fredy serverless with scale-to-zero: Firestore stores everything, Cloud
Scheduler triggers each scrape, and no instance runs between scrapes. With
2 providers at a 15-minute interval this fits entirely inside GCP's
always-free tier (~130k of 240k free vCPU-seconds/month).

## How it works

- `STORAGE_BACKEND=firestore` switches the whole storage layer to Firestore
  (no SQLite file, no volume, no migrations).
- `EXTERNAL_SCHEDULER=true` disables Fredy's internal timer and the
  scrape-on-boot; **every** scrape is driven by `POST /api/trigger`.
- Cloud Scheduler calls `/api/trigger` with a shared secret
  (`X-Trigger-Token`). The endpoint holds the request open until the run
  completes — on Cloud Run, CPU is only guaranteed while a request is in
  flight.
- The UI works whenever an instance is warm; opening it cold-starts one.

## One-time setup

```bash
PROJECT=fredy-$(whoami)
REGION=europe-west1              # close to the German portals
TRIGGER_TOKEN=$(openssl rand -hex 32)

gcloud projects create $PROJECT
gcloud config set project $PROJECT
# Billing account must be linked (free tier still requires one):
# gcloud billing projects link $PROJECT --billing-account=XXXXXX-XXXXXX-XXXXXX

gcloud services enable run.googleapis.com firestore.googleapis.com \
  cloudscheduler.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com

# Firestore in Native mode (free tier: 1 GiB, 50k reads / 20k writes per day)
gcloud firestore databases create --location=$REGION

# Build + push the image (uses the repo's regular Dockerfile)
gcloud builds submit --tag $REGION-docker.pkg.dev/$PROJECT/fredy/fredy:latest .

# Deploy: scale-to-zero, single instance, generous timeout for slow scrapes
gcloud run deploy fredy \
  --image $REGION-docker.pkg.dev/$PROJECT/fredy/fredy:latest \
  --region $REGION \
  --memory 1Gi --cpu 1 \
  --min-instances 0 --max-instances 1 \
  --timeout 900 \
  --allow-unauthenticated \
  --set-env-vars STORAGE_BACKEND=firestore,EXTERNAL_SCHEDULER=true,TRIGGER_TOKEN=$TRIGGER_TOKEN

SERVICE_URL=$(gcloud run services describe fredy --region $REGION --format 'value(status.url)')

# Scheduler: scrape every 15 minutes, 15-minute attempt deadline
gcloud scheduler jobs create http fredy-scrape \
  --location $REGION \
  --schedule '*/15 * * * *' \
  --uri "$SERVICE_URL/api/trigger" \
  --http-method POST \
  --headers X-Trigger-Token=$TRIGGER_TOKEN \
  --attempt-deadline 900s
```

Then open `$SERVICE_URL`, log in with `admin`/`admin`, **change the password
immediately** (the service is public), and configure your search jobs.

## Notes and limits

- **Auth of the trigger**: the token check is constant-time; without
  `TRIGGER_TOKEN` set, the endpoint answers 404. For belt-and-braces, switch
  the service to `--no-allow-unauthenticated` and give the Scheduler job an
  OIDC identity — but then the UI needs an authenticated proxy too.
- **Credentials**: Cloud Run's service account gets Firestore access via
  Application Default Credentials — nothing to configure with the default
  compute service account (roles/datastore.user is included in Editor;
  narrow it if you harden the project).
- **The sqlite notification adapter is hidden** on the Firestore backend
  (there is no persistent disk to write to).
- **Firestore doc limit**: a single debug-log line larger than ~1 MiB cannot
  be stored (never happens in practice).
- **Bot detection**: datacenter IPs (Cloud Run egress) are commonly blocked
  by the portals — same story as any cloud host. A German residential proxy
  (Administration → Execution → Proxy URL) applies to the headless-browser
  providers; ImmoScout's mobile API is unaffected.
- **Working hours**: a trigger outside the configured window returns
  `{ran: false}`-style success without scraping, so the Scheduler cadence
  can stay dumb.
- **Free tier math** (2 providers, 15-min cadence, ~45 s/run):
  96 runs/day x 45 s ≈ 130k vCPU-s/month of 240k free; requests and
  Firestore ops are far below their free quotas; Cloud Scheduler's first
  3 jobs are free. Cloud Build gives 120 free build-minutes/day.

## Local verification

```bash
# Firestore emulator
docker run -d --name fredy-firestore-emulator -p 127.0.0.1:8144:8144 \
  gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators \
  gcloud emulators firestore start --host-port=0.0.0.0:8144

# Boot Fredy against it
STORAGE_BACKEND=firestore FIRESTORE_EMULATOR_HOST=127.0.0.1:8144 \
EXTERNAL_SCHEDULER=true TRIGGER_TOKEN=dev-token node index.js

# Trigger a run
curl -X POST -H 'X-Trigger-Token: dev-token' http://localhost:9998/api/trigger

# Contract suite against both backends
yarn test:contract
STORAGE_BACKEND=firestore FIRESTORE_EMULATOR_HOST=127.0.0.1:8144 yarn test:contract
```
