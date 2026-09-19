#!/usr/bin/env bash
#
# One-time Workload Identity Federation setup so GitHub Actions can deploy
# to Cloud Run WITHOUT any long-lived key stored in GitHub.
#
# Run wherever your gcloud is authenticated:
#   ./scripts/setup-github-deploy.sh <project-id> <github-repo>
# Example:
#   ./scripts/setup-github-deploy.sh fredy-adhi adhi1419/fredy
#
# Prints the two values to store as GitHub Actions *variables* (they are
# identifiers, not secrets): WIF_PROVIDER and GCP_SA_EMAIL.

set -euo pipefail

PROJECT="${1:?usage: $0 <project-id> <owner/repo>}"
REPO="${2:?github repo like owner/name required}"

gcloud config set project "$PROJECT"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')

SA_NAME=github-deployer
SA_EMAIL="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
POOL=github
PROVIDER=github-oidc

echo "== Service account =="
if ! gcloud iam service-accounts describe "$SA_EMAIL" > /dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --display-name="GitHub Actions deployer"
fi

echo "== Roles =="
# What the deploy script needs: Cloud Build submit (build + staging bucket),
# Artifact Registry repo admin (create repo + cleanup policy), Cloud Run
# deploy, Scheduler job upsert, and actAs on the runtime service account.
for role in roles/cloudbuild.builds.editor roles/storage.admin \
            roles/artifactregistry.admin roles/run.admin \
            roles/cloudscheduler.admin roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$SA_EMAIL" --role="$role" --condition=None --quiet > /dev/null
done
gcloud iam service-accounts add-iam-policy-binding \
  "$PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --member="serviceAccount:$SA_EMAIL" --role=roles/iam.serviceAccountUser --quiet > /dev/null

echo "== Workload Identity pool + provider =="
if ! gcloud iam workload-identity-pools describe "$POOL" --location=global > /dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL" --location=global \
    --display-name="GitHub Actions"
fi
if ! gcloud iam workload-identity-pools providers describe "$PROVIDER" \
    --location=global --workload-identity-pool="$POOL" > /dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --location=global --workload-identity-pool="$POOL" \
    --display-name="GitHub OIDC" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository == '$REPO'"
fi

echo "== Allow $REPO to impersonate the deployer =="
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.repository/$REPO" \
  --quiet > /dev/null

WIF_PROVIDER="projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER"

echo ""
echo "======================================================================"
echo "Store these as GitHub Actions VARIABLES (Settings -> Secrets and"
echo "variables -> Actions -> Variables), or via gh:"
echo ""
echo "  gh variable set WIF_PROVIDER -R $REPO --body '$WIF_PROVIDER'"
echo "  gh variable set GCP_SA_EMAIL -R $REPO --body '$SA_EMAIL'"
echo "======================================================================"
