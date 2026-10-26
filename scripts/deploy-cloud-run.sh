#!/usr/bin/env bash
#
# Build + deploy Fredy's API-only backend to Cloud Run with direct Firebase bearer auth.
# The frontend is built and deployed separately by GitHub Pages.
# Run from the repo root, wherever gcloud is authenticated.
#
# Usage:
#   ./scripts/deploy-cloud-run.sh <project-id> [region]
#
# Expects ./firebase-web-config.json (produced by setup-firebase-project.sh).
# Idempotent: re-running rebuilds and redeploys; the trigger token and
# scheduler job are preserved unless absent.

set -euo pipefail

PROJECT="${1:?usage: $0 <project-id> [region]}"
REGION="${2:-europe-west1}"
SERVICE=fredy
CLEANUP=""
LIFECYCLE=""
ENVFILE=""
SERVICE_ERROR=""
SERVICE_JSON="{}"

cleanup() {
  [ -z "$CLEANUP" ] || rm -f "$CLEANUP"
  [ -z "$LIFECYCLE" ] || rm -f "$LIFECYCLE"
  [ -z "$ENVFILE" ] || rm -f "$ENVFILE"
  [ -z "$SERVICE_ERROR" ] || rm -f "$SERVICE_ERROR"
}
trap cleanup EXIT

[ -f firebase-web-config.json ] || { echo "firebase-web-config.json not found (run setup-firebase-project.sh first)"; exit 1; }

gcloud config set project "$PROJECT"

echo "== Artifact Registry =="
if ! gcloud artifacts repositories describe fredy --location="$REGION" > /dev/null 2>&1; then
  gcloud artifacts repositories create fredy --repository-format=docker --location="$REGION"
fi

# Cleanup policy: keep only the most recent image version, delete everything
# older than a day. Without this, every deploy adds a full image version
# and storage grows unboundedly. With it, storage stays pinned at ~one image.
CLEANUP=$(mktemp)
cat > "$CLEANUP" << 'JSON'
[
  {
    "name": "keep-most-recent",
    "action": { "type": "Keep" },
    "mostRecentVersions": { "keepCount": 1 }
  },
  {
    "name": "delete-stale",
    "action": { "type": "Delete" },
    "condition": { "olderThan": "86400s" }
  }
]
JSON
gcloud artifacts repositories set-cleanup-policies fredy \
  --location="$REGION" --policy="$CLEANUP" --no-dry-run > /dev/null
echo "   cleanup policy set (keep newest version only)"

echo "== Build (Cloud Build) =="
IMAGE_REPOSITORY="$REGION-docker.pkg.dev/$PROJECT/fredy/fredy"
REVISION=$(git rev-parse --verify HEAD)
IMAGE="$IMAGE_REPOSITORY:$REVISION"
CACHE_IMAGE="$IMAGE_REPOSITORY:latest"
# Cloud Build pulls :latest for caching, then pushes both the immutable revision
# tag and the refreshed cache alias. Cloud Run deploys only the immutable tag.
# --suppress-logs: streaming logs from the default bucket needs project
# Viewer, which the lean CI deployer SA lacks; without the flag gcloud
# exits 1 even though the build keeps running. No --async is used: gcloud
# waits for completion and fails on a failed Cloud Build.
gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions="_IMAGE=$IMAGE,_CACHE_IMAGE=$CACHE_IMAGE" \
  --suppress-logs \
  .

echo "== Staging bucket lifecycle =="
# Every `builds submit` leaves its source tarball in the staging bucket
# forever. A 7-day expiry keeps it at ~zero (the bucket exists only after
# the first build, hence the guard).
LIFECYCLE=$(mktemp)
printf '{"rule":[{"action":{"type":"Delete"},"condition":{"age":7}}]}' > "$LIFECYCLE"
if gcloud storage buckets update "gs://${PROJECT}_cloudbuild" --lifecycle-file="$LIFECYCLE" > /dev/null 2>&1; then
  echo "   7-day expiry set on gs://${PROJECT}_cloudbuild"
else
  echo "   staging bucket not found or not updatable — skipping (harmless)"
fi
rm -f "$LIFECYCLE"

echo "== Trigger token =="
# Only a genuine not-found result may create a token. Permission, transport and
# parse failures stop instead of silently invalidating existing callers.
SERVICE_ERROR=$(mktemp)
if SERVICE_JSON=$(gcloud run services describe "$SERVICE" --region "$REGION" --format=json 2>"$SERVICE_ERROR"); then
  if ! TRIGGER_TOKEN=$(printf '%s' "$SERVICE_JSON" \
    | python3 -c 'import json, sys; service = json.load(sys.stdin); containers = service.get("spec", {}).get("template", {}).get("spec", {}).get("containers", []); env = containers[0].get("env", []) if containers else []; print(next((item.get("value", "") for item in env if item.get("name") == "TRIGGER_TOKEN"), ""))'); then
    echo "Failed to parse the existing Cloud Run service configuration." >&2
    exit 1
  fi
elif grep -qiE 'not found|does not exist' "$SERVICE_ERROR"; then
  TRIGGER_TOKEN=""
else
  cat "$SERVICE_ERROR" >&2
  exit 1
fi
if [ -z "$TRIGGER_TOKEN" ]; then
  TRIGGER_TOKEN=$(openssl rand -hex 32)
  echo "   generated new trigger token"
else
  echo "   reusing existing trigger token"
fi

# Preserve optional Monitoring billing configuration when this bootstrap replaces the service's
# plain environment. A caller may also supply either value when creating a new service.
existing_env() {
  printf '%s' "$SERVICE_JSON" | python3 -c 'import json, sys; key = sys.argv[1]; service = json.load(sys.stdin); containers = service.get("spec", {}).get("template", {}).get("spec", {}).get("containers", []); env = containers[0].get("env", []) if containers else []; print(next((item.get("value", "") for item in env if item.get("name") == key), ""))' "$1"
}
BILLING_TABLE="${GCP_BILLING_EXPORT_TABLE:-$(existing_env GCP_BILLING_EXPORT_TABLE)}"
BILLING_LOCATION="${GCP_BILLING_EXPORT_LOCATION:-$(existing_env GCP_BILLING_EXPORT_LOCATION)}"
BILLING_LOCATION="${BILLING_LOCATION:-EU}"

echo "== Deploy =="
# env-vars-file instead of --set-env-vars: the web config JSON contains
# commas, which --set-env-vars would split on.
ENVFILE=$(mktemp)
python3 - "$ENVFILE" "$TRIGGER_TOKEN" "$PROJECT" "$BILLING_TABLE" "$BILLING_LOCATION" << 'PYEOF'
import json, sys
envfile, token, project, billing_table, billing_location = sys.argv[1:6]
web_config = json.dumps(json.load(open('firebase-web-config.json')), separators=(',', ':'))
env = {
    'TRIGGER_TOKEN': token,
    'GOOGLE_CLOUD_PROJECT': project,
    # These mirror the resource flags on the deploy command below.
    'MONITORING_CLOUD_RUN_VCPU': '0.5',
    'MONITORING_CLOUD_RUN_MEMORY_GIB': '1',
    'FIREBASE_WEB_CONFIG': web_config,
    'FRONTEND_ORIGIN': 'https://adhi1419.github.io',
    'FRONTEND_URL': 'https://adhi1419.github.io/fredy/',
}
if billing_table:
    env['GCP_BILLING_EXPORT_TABLE'] = billing_table
    env['GCP_BILLING_EXPORT_LOCATION'] = billing_location
with open(envfile, 'w') as f:
    for key, value in env.items():
        f.write(f'{key}: {json.dumps(value)}\n')
PYEOF

# Credentials live in Secret Manager and are attached only when present. `--update-secrets`
# co-exists with `--env-vars-file`, which replaces only plain environment variables.
SECRET_BINDINGS=()
if gcloud secrets describe gemini-api-key > /dev/null 2>&1; then
  echo "   attaching GEMINI_API_KEY from Secret Manager"
  SECRET_BINDINGS+=("GEMINI_API_KEY=gemini-api-key:latest")
else
  echo "   gemini-api-key secret absent — inquiry drafting stays disabled in prod"
fi
if gcloud secrets describe provider-credential-encryption-key > /dev/null 2>&1; then
  echo "   attaching PROVIDER_CREDENTIAL_ENCRYPTION_KEY from Secret Manager"
  SECRET_BINDINGS+=("PROVIDER_CREDENTIAL_ENCRYPTION_KEY=provider-credential-encryption-key:latest")
else
  echo "   provider-credential-encryption-key secret absent — connected provider applications stay disabled"
fi
SECRET_FLAGS=()
if ((${#SECRET_BINDINGS[@]} > 0)); then
  SECRET_FLAGS=(--update-secrets "$(IFS=,; echo "${SECRET_BINDINGS[*]}")")
fi

RUNTIME_SERVICE_ACCOUNT_NAME=fredy-runtime
RUNTIME_SERVICE_ACCOUNT="$RUNTIME_SERVICE_ACCOUNT_NAME@$PROJECT.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$RUNTIME_SERVICE_ACCOUNT" > /dev/null 2>&1; then
  echo "   creating dedicated runtime identity: $RUNTIME_SERVICE_ACCOUNT"
  gcloud iam service-accounts create "$RUNTIME_SERVICE_ACCOUNT_NAME" --display-name='Fredy Cloud Run runtime'
  # A newly-created identity can take a few seconds to propagate to project IAM.
  sleep 10
fi
for role in roles/datastore.user roles/monitoring.viewer roles/bigquery.jobUser; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$RUNTIME_SERVICE_ACCOUNT" --role="$role" --condition=None --quiet > /dev/null
done
# The admin Schedule control re-times the Cloud Scheduler job from inside Fredy. A custom role with
# only get+update keeps the runtime identity from creating, pausing or deleting jobs; the predefined
# roles/cloudscheduler.admin would allow all of that.
SCHEDULE_ROLE_ID=fredyScheduleEditor
if ! gcloud iam roles describe "$SCHEDULE_ROLE_ID" --project "$PROJECT" > /dev/null 2>&1; then
  gcloud iam roles create "$SCHEDULE_ROLE_ID" --project "$PROJECT" \
    --title 'Fredy schedule editor' \
    --description 'Read and re-time the Fredy Cloud Scheduler job' \
    --permissions cloudscheduler.jobs.get,cloudscheduler.jobs.update --quiet > /dev/null
fi
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$RUNTIME_SERVICE_ACCOUNT" \
  --role="projects/$PROJECT/roles/$SCHEDULE_ROLE_ID" --condition=None --quiet > /dev/null
for secret in gemini-api-key provider-credential-encryption-key; do
  if gcloud secrets describe "$secret" > /dev/null 2>&1; then
    gcloud secrets add-iam-policy-binding "$secret" \
      --member="serviceAccount:$RUNTIME_SERVICE_ACCOUNT" \
      --role=roles/secretmanager.secretAccessor --condition=None --quiet > /dev/null
  fi
done

gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --service-account "$RUNTIME_SERVICE_ACCOUNT" \
  --region "$REGION" \
  --memory 1Gi --cpu 0.5 \
  --concurrency 1 --execution-environment gen1 \
  --min-instances 0 --max-instances 2 \
  --timeout 900 \
  --allow-unauthenticated \
  --env-vars-file "$ENVFILE" \
  "${SECRET_FLAGS[@]}"
# Half a vCPU: the scrape is I/O-bound (p99 CPU utilisation 16% of one vCPU), so halving the
# allocation halves the billed vCPU-seconds and barely changes run time - it is what keeps a
# 5-minute cadence inside the Cloud Run free tier. Below 1 vCPU Cloud Run requires request-based
# billing, memory <= 1 GiB, the first-generation execution environment and a concurrency of 1.
# Concurrency 1 means a browser request cannot share the instance a 30-second scrape is holding,
# hence max-instances 2: the second instance only exists while the two overlap. The Scheduler
# never overlaps itself (one request every few minutes, each ~30 s), so two instances only run
# jobs at the same time when a manual "run" from the UI coincides with a scheduled one.
SERVICE_URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')

echo "== Scheduler =="
# The cadence is NOT passed on update: an administrator sets it from the Monitoring page (it is
# written straight to this job), and re-running the bootstrap must not reset their choice.
if gcloud scheduler jobs describe fredy-scrape --location "$REGION" > /dev/null 2>&1; then
  gcloud scheduler jobs update http fredy-scrape --location "$REGION" \
    --uri "$SERVICE_URL/api/trigger" \
    --update-headers X-Trigger-Token="$TRIGGER_TOKEN"
else
  gcloud scheduler jobs create http fredy-scrape \
    --location "$REGION" \
    --schedule '*/15 * * * *' \
    --uri "$SERVICE_URL/api/trigger" \
    --http-method POST \
    --headers X-Trigger-Token="$TRIGGER_TOKEN" \
    --attempt-deadline 900s
fi

echo ""
echo "======================================================================"
echo "Deployed: $SERVICE_URL"
echo ""
echo "FINAL STEP — authorize GitHub Pages for Google sign-in (once):"
echo "  https://console.firebase.google.com/project/$PROJECT/authentication/settings"
echo "  -> Authorized domains -> Add domain -> adhi1419.github.io"
echo "  Pages: https://adhi1419.github.io/fredy/"
echo "======================================================================"
