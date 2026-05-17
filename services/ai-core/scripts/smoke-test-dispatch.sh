#!/usr/bin/env bash
# End-to-end smoke test for the dispatcher → Cloud Run Jobs path.
#
# What it does:
#   1. Uploads a small fixture PDF to the pipeline-uploads bucket.
#   2. POSTs /api/v1/jobs/dispatch on the deployed Service with that gcsUri.
#   3. Polls /api/v1/jobs/{jobId} until the status is terminal or 5min elapses.
#   4. Prints the final status + execution name.
#
# This is the production health check before the canary rollout (the
# "permisos IAM" risk in the plan: §I.4).
#
# Usage:
#   AI_CORE_URL=https://ai-core-xxx.run.app \
#   INTERNAL_WORKER_TOKEN=<token> \
#   PDF_FIXTURE=services/ai-core/tests/fixtures/small_budget.pdf \
#   bash services/ai-core/scripts/smoke-test-dispatch.sh

set -euo pipefail

: "${AI_CORE_URL:?Set AI_CORE_URL to the deployed Service base URL}"
: "${INTERNAL_WORKER_TOKEN:?Set INTERNAL_WORKER_TOKEN (matches Service env var)}"
: "${PROJECT_ID:=grupo-rg-a9929}"
: "${PDF_FIXTURE:=/tmp/smoke.pdf}"

BUCKET="${PROJECT_ID}-pipeline-uploads"
UID_TEST="smoketest-$(date +%s)"
JOB_ID_HINT="smoke-${UID_TEST}"

# If no PDF fixture supplied, synthesise the smallest valid PDF possible.
if [ ! -f "$PDF_FIXTURE" ]; then
  echo "==> Synthesising minimal PDF at $PDF_FIXTURE"
  cat > "$PDF_FIXTURE" <<'PDF'
%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Resources<<>>>>endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000052 00000 n
0000000098 00000 n
trailer<</Size 4/Root 1 0 R>>
startxref
156
%%EOF
PDF
fi

GCS_PATH="pipeline_uploads/${UID_TEST}/${JOB_ID_HINT}/smoke.pdf"
GCS_URI="gs://${BUCKET}/${GCS_PATH}"

echo "==> Uploading $PDF_FIXTURE → $GCS_URI"
gcloud storage cp "$PDF_FIXTURE" "$GCS_URI" --content-type="application/pdf"

echo "==> POST /api/v1/jobs/dispatch"
RESPONSE=$(curl -sS -X POST "${AI_CORE_URL}/api/v1/jobs/dispatch" \
  -H "Content-Type: application/json" \
  -H "x-internal-token: ${INTERNAL_WORKER_TOKEN}" \
  -d "$(cat <<JSON
{
  "jobType": "measurements",
  "uid": "${UID_TEST}",
  "leadId": "smoke-lead",
  "budgetId": "smoke-budget-$(date +%s)",
  "payload": {
    "gcsUri": "${GCS_URI}",
    "strategy": "INLINE"
  }
}
JSON
)")

echo "    Response: $RESPONSE"
JOB_ID=$(echo "$RESPONSE" | python -c "import sys, json; print(json.load(sys.stdin)['jobId'])")
echo "==> Job ID: $JOB_ID"

# Poll up to 5 minutes, every 5 seconds.
DEADLINE=$(( $(date +%s) + 300 ))
echo "==> Polling status..."
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  STATE=$(curl -sS "${AI_CORE_URL}/api/v1/jobs/${JOB_ID}" \
    -H "x-internal-token: ${INTERNAL_WORKER_TOKEN}")
  STATUS=$(echo "$STATE" | python -c "import sys, json; print(json.load(sys.stdin)['status'])")
  echo "    status=$STATUS"
  if [[ "$STATUS" == "completed" || "$STATUS" == "failed" || "$STATUS" == "canceled" ]]; then
    echo "==> Final job state:"
    echo "$STATE" | python -m json.tool
    exit 0
  fi
  sleep 5
done

echo "ERROR: job did not reach a terminal state within 5 minutes."
exit 1
