#!/usr/bin/env bash
# One-time infrastructure setup for the ai-core pipeline-jobs deployment.
#
# Idempotent: re-running is safe; resources already created are detected
# and skipped. Run from a workstation with `gcloud` authenticated against
# the target project.
#
# What it creates / configures:
#   1. Artifact Registry repo `ai-core` for the Docker image.
#   2. Worker service account `ai-core-worker-sa` with the minimum roles
#      needed at runtime (Firestore RW, Storage Object Viewer on the
#      uploads bucket, Logging Writer, Monitoring Metric Writer).
#   3. Grants the Service's existing SA `roles/run.invoker` on the Worker
#      Job so the dispatcher endpoint can fire executions.
#   4. Cloud Storage bucket `${PROJECT_ID}-pipeline-uploads` with a
#      lifecycle rule that deletes objects after 7 days.
#
# Usage:
#   bash services/ai-core/scripts/setup-infrastructure.sh
#
# Required env (or sane defaults):
#   PROJECT_ID    grupo-rg-a9929
#   REGION        europe-southwest1
#   JOB_NAME      ai-core-worker
#   WORKER_SA_ID  ai-core-worker-sa
#   SERVICE_SA    firebase-adminsdk-fbsvc@$PROJECT_ID.iam.gserviceaccount.com

set -euo pipefail

: "${PROJECT_ID:=grupo-rg-a9929}"
: "${REGION:=europe-southwest1}"
: "${JOB_NAME:=ai-core-worker}"
: "${WORKER_SA_ID:=ai-core-worker-sa}"
: "${SERVICE_SA:=firebase-adminsdk-fbsvc@${PROJECT_ID}.iam.gserviceaccount.com}"

WORKER_SA="${WORKER_SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"
BUCKET="gs://${PROJECT_ID}-pipeline-uploads"

echo "==> Project: $PROJECT_ID  Region: $REGION"
gcloud config set project "$PROJECT_ID" >/dev/null

# -- 1. Artifact Registry ----------------------------------------------------

echo "==> Artifact Registry repo 'ai-core'..."
if gcloud artifacts repositories describe ai-core \
      --location="$REGION" >/dev/null 2>&1; then
  echo "    already exists, skipping."
else
  gcloud artifacts repositories create ai-core \
    --repository-format=docker \
    --location="$REGION" \
    --description="ai-core Docker images (Service + Worker)"
fi

# -- 2. Worker Service Account ----------------------------------------------

echo "==> Worker service account ${WORKER_SA_ID}..."
if gcloud iam service-accounts describe "$WORKER_SA" >/dev/null 2>&1; then
  echo "    already exists, skipping creation."
else
  gcloud iam service-accounts create "$WORKER_SA_ID" \
    --display-name="ai-core worker (Cloud Run Job)"
fi

echo "==> Granting worker SA the runtime roles..."
for role in \
    roles/datastore.user \
    roles/logging.logWriter \
    roles/monitoring.metricWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${WORKER_SA}" \
    --role="$role" \
    --condition=None >/dev/null
done

# -- 3. Storage bucket for PDF uploads ---------------------------------------

echo "==> Storage bucket ${BUCKET}..."
if gcloud storage buckets describe "$BUCKET" >/dev/null 2>&1; then
  echo "    already exists, skipping creation."
else
  gcloud storage buckets create "$BUCKET" \
    --location="$REGION" \
    --uniform-bucket-level-access \
    --public-access-prevention
fi

echo "==> Applying lifecycle rule (delete pipeline_uploads/* after 7 days)..."
TMP_LIFECYCLE=$(mktemp)
cat > "$TMP_LIFECYCLE" <<'JSON'
{
  "rule": [
    {
      "action": {"type": "Delete"},
      "condition": {
        "age": 7,
        "matchesPrefix": ["pipeline_uploads/"]
      }
    }
  ]
}
JSON
gcloud storage buckets update "$BUCKET" --lifecycle-file="$TMP_LIFECYCLE"
rm -f "$TMP_LIFECYCLE"

echo "==> Granting worker SA objectViewer on the uploads bucket..."
gcloud storage buckets add-iam-policy-binding "$BUCKET" \
  --member="serviceAccount:${WORKER_SA}" \
  --role=roles/storage.objectViewer >/dev/null

# -- 4. Cross-SA permission: Service must be able to invoke the Worker Job ---
#
# This binding is on the Job resource specifically, not project-wide, so the
# Service SA only gets invoker rights on this one Job — least privilege.
#
# We bind even if the Job doesn't exist yet (cloudbuild.yaml will create it
# on first deploy). If the binding fails with NOT_FOUND, we fall back to a
# project-wide grant which can be tightened later.

echo "==> run.invoker on the Worker Job for the Service SA..."
if gcloud run jobs describe "$JOB_NAME" --region="$REGION" >/dev/null 2>&1; then
  gcloud run jobs add-iam-policy-binding "$JOB_NAME" \
    --region="$REGION" \
    --member="serviceAccount:${SERVICE_SA}" \
    --role=roles/run.invoker >/dev/null
  echo "    (bound on job)"
else
  echo "    Job '$JOB_NAME' does not exist yet. Run cloudbuild.yaml first,"
  echo "    then re-run this script to apply the IAM binding on the Job."
fi

echo
echo "Infrastructure is ready."
echo
echo "Next steps:"
echo "  1. Push code with env vars set in the Service via 'gcloud run services update':"
echo "       FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY,"
echo "       GOOGLE_GENAI_API_KEY, INTERNAL_WORKER_TOKEN, QDRANT_URL, QDRANT_API_KEY"
echo "  2. (For the Worker Job): set the same env vars via"
echo "       gcloud run jobs update ${JOB_NAME} --region=${REGION} --update-env-vars=..."
echo "  3. Submit the build:"
echo "       gcloud builds submit --config services/ai-core/cloudbuild.yaml services/ai-core"
echo "  4. Re-run this script if step (4) above was skipped because the Job didn't exist."
