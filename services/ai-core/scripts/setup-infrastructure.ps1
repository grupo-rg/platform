# PowerShell version of setup-infrastructure.sh for native Windows use.
#
# Idempotent: re-running is safe; resources already created are detected
# and skipped. Run from PowerShell with gcloud authenticated against the
# target project.
#
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File services/ai-core/scripts/setup-infrastructure.ps1
#
# NOTE on PowerShell 5.1 + gcloud quirks:
#   - We do NOT use `2>$null` because PS 5.1 wraps native stderr in
#     NativeCommandError, which (with ErrorActionPreference=Stop) would kill
#     the script on a perfectly normal "resource not found" probe.
#   - Existence checks are done via `gcloud ... list --filter=...` + count,
#     which uses stdout only.

[CmdletBinding()]
param(
    [string]$ProjectId  = "grupo-rg-a9929",
    [string]$Region     = "europe-southwest1",
    [string]$JobName    = "ai-core-worker",
    [string]$WorkerSaId = "ai-core-worker-sa"
)

# Continue past native stderr noise; we gate on $LASTEXITCODE explicitly.
$ErrorActionPreference = 'Continue'

$ServiceSa = "firebase-adminsdk-fbsvc@$ProjectId.iam.gserviceaccount.com"
$WorkerSa  = "$WorkerSaId@$ProjectId.iam.gserviceaccount.com"
$Bucket    = "gs://$ProjectId-pipeline-uploads"

function Test-GcloudOk { return ($LASTEXITCODE -eq 0) }

Write-Host "==> Project: $ProjectId  Region: $Region"
gcloud config set project $ProjectId | Out-Null

# -- 1. Artifact Registry ----------------------------------------------------

Write-Host "==> Artifact Registry repo 'ai-core'..."
$repoName = gcloud artifacts repositories list `
    --location=$Region `
    --filter="name~ai-core$" `
    --format="value(name)"
if ($repoName) {
    Write-Host "    already exists, skipping."
} else {
    gcloud artifacts repositories create ai-core `
        --repository-format=docker `
        --location=$Region `
        --description="ai-core Docker images (Service + Worker)"
}

# -- 2. Worker Service Account ----------------------------------------------

Write-Host "==> Worker service account $WorkerSaId..."
$saEmail = gcloud iam service-accounts list `
    --filter="email=$WorkerSa" `
    --format="value(email)"
if ($saEmail) {
    Write-Host "    already exists, skipping creation."
} else {
    gcloud iam service-accounts create $WorkerSaId `
        --display-name="ai-core worker (Cloud Run Job)"
    # IAM has eventual consistency on SA visibility — give it a few seconds
    # so the role bindings below don't fail with "service account does not
    # exist". Skipped if the SA already existed.
    Write-Host "    Waiting 8s for IAM to propagate the new SA..."
    Start-Sleep -Seconds 8
}

Write-Host "==> Granting worker SA the runtime roles..."
$roles = @(
    'roles/datastore.user',
    'roles/logging.logWriter',
    'roles/monitoring.metricWriter'
)
foreach ($role in $roles) {
    gcloud projects add-iam-policy-binding $ProjectId `
        --member="serviceAccount:$WorkerSa" `
        --role=$role `
        --condition=None `
        --quiet | Out-Null
}

# -- 3. Storage bucket for PDF uploads ---------------------------------------

Write-Host "==> Storage bucket $Bucket..."
$bucketName = gcloud storage buckets list `
    --filter="name=$ProjectId-pipeline-uploads" `
    --format="value(name)"
if ($bucketName) {
    Write-Host "    already exists, skipping creation."
} else {
    gcloud storage buckets create $Bucket `
        --location=$Region `
        --uniform-bucket-level-access `
        --public-access-prevention
}

Write-Host "==> Applying lifecycle rule (delete pipeline_uploads/* after 7 days)..."
$lifecycleJson = @'
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
'@
$tmpFile = New-TemporaryFile
$tmpPath = $tmpFile.FullName
try {
    Set-Content -Path $tmpPath -Value $lifecycleJson -Encoding utf8
    gcloud storage buckets update $Bucket --lifecycle-file="$tmpPath"
} finally {
    Remove-Item -Path $tmpPath -Force -ErrorAction SilentlyContinue
}

Write-Host "==> Granting worker SA objectViewer on the uploads bucket..."
gcloud storage buckets add-iam-policy-binding $Bucket `
    --member="serviceAccount:$WorkerSa" `
    --role=roles/storage.objectViewer | Out-Null

# -- 4. Cross-SA permission: Service must be able to invoke the Worker Job ---

Write-Host "==> run.invoker on the Worker Job for the Service SA..."
# `gcloud run jobs list` exposes the short name under the column `JOB`, not
# `name`. We grab all names and check membership in PowerShell — simpler
# than guessing the right filter key per resource type.
$allJobNames = gcloud run jobs list `
    --region=$Region `
    --format="value(metadata.name)"
$jobNameLines = @($allJobNames -split "`r?`n" | Where-Object { $_ })
if ($jobNameLines -contains $JobName) {
    # NOTE: `roles/run.invoker` allows running the job but NOT with env-var
    # overrides. Our dispatcher injects `JOB_ID` via overrides, which needs
    # `run.jobs.runWithOverrides`. The minimal role that includes it is
    # `roles/run.developer`. If you tighten this later, ensure the chosen
    # role still includes `run.jobs.runWithOverrides`.
    gcloud run jobs add-iam-policy-binding $JobName `
        --region=$Region `
        --member="serviceAccount:$ServiceSa" `
        --role=roles/run.developer | Out-Null
    Write-Host "    (bound on job)"
} else {
    Write-Host "    Job '$JobName' does not exist yet. Run cloudbuild.yaml first,"
    Write-Host "    then re-run this script to apply the IAM binding on the Job."
}

Write-Host ""
Write-Host "Infrastructure is ready."
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Set env vars on Service (Cloud Console UI or gcloud run services update)."
Write-Host "  2. Submit the build:"
Write-Host "       gcloud builds submit --config services/ai-core/cloudbuild.yaml services/ai-core"
Write-Host "  3. Set env vars on the Worker Job (FIREBASE_*, GOOGLE_GENAI_API_KEY, QDRANT_*, ...):"
Write-Host "       gcloud run jobs update $JobName --region=$Region --update-env-vars=..."
Write-Host "  4. Re-run this script if step (4) above was skipped because the Job did not exist."
