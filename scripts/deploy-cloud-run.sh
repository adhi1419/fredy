#!/usr/bin/env bash
#
# Build + deploy Fredy to Cloud Run in multi-tenant firebase mode.
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
rm -f "$CLEANUP"
echo "   cleanup policy set (keep newest version only)"

echo "== Build (Cloud Build) =="
IMAGE="$REGION-docker.pkg.dev/$PROJECT/fredy/fredy:latest"
gcloud builds submit --tag "$IMAGE" .

echo "== Trigger token =="
# Reuse the existing token when the service already has one, so the
# scheduler job keeps working across redeploys.
TRIGGER_TOKEN=$(gcloud run services describe $SERVICE --region "$REGION" \
  --format 'value(spec.template.spec.containers[0].env)' 2>/dev/null \
  | tr ';' '\n' | grep -oP "(?<='TRIGGER_TOKEN': ')[^']+" || true)
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
    'STORAGE_BACKEND': 'firestore',
    'AUTH_MODE': 'firebase',
    'EXTERNAL_SCHEDULER': 'true',
    'TRIGGER_TOKEN': token,
    'FIREBASE_WEB_CONFIG': web_config,
}
with open(envfile, 'w') as f:
    for key, value in env.items():
        f.write(f'{key}: {json.dumps(value)}\n')
PYEOF

gcloud run deploy $SERVICE \
  --image "$IMAGE" \
  --region "$REGION" \
  --memory 1Gi --cpu 1 \
  --min-instances 0 --max-instances 1 \
  --timeout 900 \
  --allow-unauthenticated \
  --env-vars-file "$ENVFILE"
rm -f "$ENVFILE"

SERVICE_URL=$(gcloud run services describe $SERVICE --region "$REGION" --format 'value(status.url)')

echo "== Scheduler =="
if gcloud scheduler jobs describe fredy-scrape --location "$REGION" > /dev/null 2>&1; then
  gcloud scheduler jobs update http fredy-scrape --location "$REGION" \
    --schedule '*/30 * * * *' \
    --uri "$SERVICE_URL/api/trigger" \
    --update-headers X-Trigger-Token="$TRIGGER_TOKEN"
else
  gcloud scheduler jobs create http fredy-scrape \
    --location "$REGION" \
    --schedule '*/30 * * * *' \
    --uri "$SERVICE_URL/api/trigger" \
    --http-method POST \
    --headers X-Trigger-Token="$TRIGGER_TOKEN" \
    --attempt-deadline 900s
fi

echo ""
echo "======================================================================"
echo "Deployed: $SERVICE_URL"
echo ""
echo "FINAL STEP — authorize the domain for Google sign-in (once):"
echo "  https://console.firebase.google.com/project/$PROJECT/authentication/settings"
echo "  -> Authorized domains -> Add domain -> ${SERVICE_URL#https://}"
echo "  (without it the sign-in popup is rejected with auth/unauthorized-domain)"
echo "======================================================================"
