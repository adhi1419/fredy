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
# (Fredy's image is large: node + Chromium + fonts) and storage grows
# unboundedly. With it, storage stays pinned at ~one image.
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

echo "== Deploy =="
# env-vars-file instead of --set-env-vars: the web config JSON contains
# commas, which --set-env-vars would split on.
ENVFILE=$(mktemp)
python3 - "$ENVFILE" "$TRIGGER_TOKEN" << 'PYEOF'
import json, sys
envfile, token = sys.argv[1], sys.argv[2]
web_config = json.dumps(json.load(open('firebase-web-config.json')), separators=(',', ':'))
env = {
    'EXTERNAL_SCHEDULER': 'true',
    'TRIGGER_TOKEN': token,
    'FIREBASE_WEB_CONFIG': web_config,
    'FRONTEND_ORIGIN': 'https://adhi1419.github.io',
    'FRONTEND_URL': 'https://adhi1419.github.io/fredy/',
}
with open(envfile, 'w') as f:
    for key, value in env.items():
        f.write(f'{key}: {json.dumps(value)}\n')
PYEOF

# GEMINI_API_KEY powers inquiry-message drafting (on-demand + the eager
# Telegram second message). It is a credential, so it lives in Secret Manager
# and is attached with --update-secrets (which co-exists with --env-vars-file;
# the latter only replaces plain env vars). Attach it ONLY when the secret
# exists, so instances that don't use the feature still deploy cleanly — the
# app already gates the route on GEMINI_API_KEY being present. Create once:
#   printf %s '<key>' | gcloud secrets create gemini-api-key --data-file=- --project "$PROJECT"
#   gcloud secrets add-iam-policy-binding gemini-api-key --project "$PROJECT" \
#     --member "serviceAccount:$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')-compute@developer.gserviceaccount.com" \
#     --role roles/secretmanager.secretAccessor
SECRET_FLAGS=()
if gcloud secrets describe gemini-api-key > /dev/null 2>&1; then
  echo "   attaching GEMINI_API_KEY from Secret Manager"
  SECRET_FLAGS=(--update-secrets "GEMINI_API_KEY=gemini-api-key:latest")
else
  echo "   gemini-api-key secret absent — inquiry drafting stays disabled in prod"
fi

gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --memory 1Gi --cpu 1 \
  --min-instances 0 --max-instances 1 \
  --timeout 900 \
  --allow-unauthenticated \
  --env-vars-file "$ENVFILE" \
  "${SECRET_FLAGS[@]}"
SERVICE_URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')

echo "== Scheduler =="
if gcloud scheduler jobs describe fredy-scrape --location "$REGION" > /dev/null 2>&1; then
  gcloud scheduler jobs update http fredy-scrape --location "$REGION" \
    --schedule '*/15 * * * *' \
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
