#!/usr/bin/env bash
#
# One-shot Firebase + GCP project setup for multi-tenant Fredy.
# Run wherever your gcloud is authenticated (laptop is fine).
#
# Usage:
#   ./scripts/setup-firebase-project.sh <project-id> <admin-email> [region] [billing-account-id]
#
# Example:
#   ./scripts/setup-firebase-project.sh fredy-adhi me@gmail.com europe-west1 XXXXXX-XXXXXX-XXXXXX
#
# What it does:
#   1. Creates the GCP project (skips if it exists) and links billing
#   2. Enables all required APIs
#   3. Attaches Firebase to the project (Firebase Management REST API)
#   4. Creates a Firebase *web app* and prints its config JSON
#      -> paste that into FIREBASE_WEB_CONFIG on Cloud Run
#   5. Creates the Firestore database (native mode)
#   6. Seeds allowed_users with <admin-email> as instance admin
#
# What it cannot do (one console step, ~2 clicks):
#   Enable the Google sign-in provider:
#   https://console.firebase.google.com/project/<project-id>/authentication/providers
#   -> Google -> Enable -> Save  (the console auto-provisions the OAuth client)

set -euo pipefail

PROJECT="${1:?usage: $0 <project-id> <admin-email> [region] [billing-account-id]}"
ADMIN_EMAIL="${2:?admin email required}"
REGION="${3:-europe-west1}"
BILLING="${4:-}"

echo "== 1/6 Project =="
if ! gcloud projects describe "$PROJECT" > /dev/null 2>&1; then
  gcloud projects create "$PROJECT"
fi
gcloud config set project "$PROJECT"

if [ -n "$BILLING" ]; then
  gcloud billing projects link "$PROJECT" --billing-account="$BILLING"
else
  echo "   (no billing account passed — link one before deploying Cloud Run:"
  echo "    gcloud billing accounts list && gcloud billing projects link $PROJECT --billing-account=...)"
fi

echo "== 2/6 APIs =="
# Billing-free APIs first: the whole Firebase/Firestore half works without a
# billing account. The Cloud Run half is attempted separately and skipped
# with a warning when billing is not linked yet.
gcloud services enable \
  firebase.googleapis.com identitytoolkit.googleapis.com firestore.googleapis.com

if gcloud services enable \
  run.googleapis.com cloudscheduler.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com 2>/dev/null; then
  echo "   deploy APIs enabled"
else
  echo "   WARNING: deploy APIs (run/scheduler/cloudbuild/artifactregistry) need billing."
  echo "   Continuing with the Firebase setup. Before deploying:"
  echo "     gcloud billing accounts list"
  echo "     gcloud billing projects link $PROJECT --billing-account=XXXXXX-XXXXXX-XXXXXX"
  echo "     gcloud services enable run.googleapis.com cloudscheduler.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com"
fi

TOKEN=$(gcloud auth print-access-token)

echo "== 3/6 Attach Firebase =="
HTTP=$(curl -s -o /tmp/addfb.json -w '%{http_code}' -X POST \
  -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT" -H "Content-Type: application/json" \
  "https://firebase.googleapis.com/v1beta1/projects/$PROJECT:addFirebase" -d '{}')
# 200 = attached now; 409 = already attached — both fine.
if [ "$HTTP" != "200" ] && [ "$HTTP" != "409" ]; then
  echo "addFirebase failed ($HTTP):" && cat /tmp/addfb.json && exit 1
fi
sleep 10

echo "== 4/6 Web app + config =="
APPS=$(curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT" \
  "https://firebase.googleapis.com/v1beta1/projects/$PROJECT/webApps")
APP_ID=$(echo "$APPS" | python3 -c "import sys,json; apps=json.load(sys.stdin).get('apps',[]); print(apps[0]['appId'] if apps else '')")
if [ -z "$APP_ID" ]; then
  OP=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT" -H "Content-Type: application/json" \
    "https://firebase.googleapis.com/v1beta1/projects/$PROJECT/webApps" \
    -d '{"displayName":"fredy"}')
  # webApps.create is long-running; poll briefly then re-list.
  sleep 15
  APPS=$(curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT" \
    "https://firebase.googleapis.com/v1beta1/projects/$PROJECT/webApps")
  APP_ID=$(echo "$APPS" | python3 -c "import sys,json; apps=json.load(sys.stdin).get('apps',[]); print(apps[0]['appId'] if apps else '')")
fi
[ -n "$APP_ID" ] || { echo "could not create/find web app"; exit 1; }

curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT" \
  "https://firebase.googleapis.com/v1beta1/projects/$PROJECT/webApps/$APP_ID/config" \
  > firebase-web-config.json
echo "   wrote firebase-web-config.json"

echo "== 5/6 Firestore =="
if ! gcloud firestore databases describe --database='(default)' > /dev/null 2>&1; then
  gcloud firestore databases create --location="$REGION"
fi

echo "== 6/6 Seed allowlist ($ADMIN_EMAIL as admin) =="
# NOTE: no URL-encoding — the Firestore REST API decodes %xx in document
# paths, and the app reads the doc id as the raw lowercase email.
ENC_EMAIL=$(python3 -c "import sys; print(sys.argv[1].strip().lower())" "$ADMIN_EMAIL")
NOW_MS=$(python3 -c "import time; print(int(time.time()*1000))")
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: $PROJECT" -H "Content-Type: application/json" \
  "https://firestore.googleapis.com/v1/projects/$PROJECT/databases/(default)/documents/allowed_users/$ENC_EMAIL" \
  -d "{\"fields\":{\"email\":{\"stringValue\":\"$(echo "$ADMIN_EMAIL" | tr 'A-Z' 'a-z')\"},\"isAdmin\":{\"booleanValue\":true},\"addedAt\":{\"integerValue\":\"$NOW_MS\"}}}" \
  > /dev/null && echo "   allowlisted: $ADMIN_EMAIL (admin)"

echo ""
echo "======================================================================"
echo "DONE. Two things remain:"
echo ""
echo "1. Enable Google sign-in (2 clicks):"
echo "   https://console.firebase.google.com/project/$PROJECT/authentication/providers"
echo ""
echo "2. Deploy with the config (see doc/cloud-run-deployment.md):"
echo "   FIREBASE_WEB_CONFIG contents are in ./firebase-web-config.json"
echo "======================================================================"
