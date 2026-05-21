# Sprint 4 deploy script - Windows PowerShell variant.
# Equivalent functionality to deploy-sprint4.sh for Windows users.
#
# Usage:
#   .\services\ai-core\scripts\deploy-sprint4.ps1
#   .\services\ai-core\scripts\deploy-sprint4.ps1 -NoTabular           # USE_TABULAR_PARSER=false
#   .\services\ai-core\scripts\deploy-sprint4.ps1 -BuildOnly           # solo build
#
# Requires: gcloud CLI autenticated with grupo-rg-a9929 access.

[CmdletBinding()]
param(
    [switch]$NoTabular,
    [switch]$BuildOnly,
    [string]$ProjectId = "grupo-rg-a9929",
    [string]$Region = "europe-southwest1",
    [string]$ServiceName = "ai-core",
    [string]$JobName = "ai-core-worker"
)

# gcloud writes informational messages to stderr (e.g. "Your active configuration is: [...]").
# Don't treat those as PowerShell errors — only check $LASTEXITCODE explicitly.
$ErrorActionPreference = "Continue"

# Sprint 4 env vars defaults
$UseTabularParser = if ($NoTabular) { "false" } else { "true" }
$MaxLlmVisionPages = "50"

# Locate dirs
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AiCoreDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$RepoRoot = (Resolve-Path (Join-Path $AiCoreDir "..\..")).Path

Write-Host "==============================================================="
Write-Host "Sprint 4 deploy - ai-core"
Write-Host "==============================================================="
Write-Host "PROJECT_ID:           $ProjectId"
Write-Host "REGION:               $Region"
Write-Host "SERVICE_NAME:         $ServiceName"
Write-Host "JOB_NAME:             $JobName"
Write-Host "USE_TABULAR_PARSER:   $UseTabularParser"
Write-Host "MAX_LLM_VISION_PAGES: $MaxLlmVisionPages"
Write-Host "MODE:                 $(if ($BuildOnly) { 'build-only' } else { 'full deploy' })"
Write-Host "==============================================================="
Write-Host ""

# Pre-flight: gcloud auth
# gcloud writes "Your active configuration is: [...]" to stderr — redirect to $null.
$currentProject = (& gcloud config get-value project 2>$null | Out-String).Trim()
if ([string]::IsNullOrWhiteSpace($currentProject)) {
    Write-Host "[ERROR] gcloud no autenticado o no devolvió project. Run 'gcloud auth login' first." -ForegroundColor Red
    exit 1
}

if ($currentProject -ne $ProjectId) {
    Write-Host "[WARN] gcloud project actual es '$currentProject', no '$ProjectId'. Continuando con --project=$ProjectId explícito." -ForegroundColor Yellow
}

# Step 1: cloudbuild
Write-Host "[1/3] Cloud Build submit (8-12 min, incluye descarga BGE)..."
Push-Location $AiCoreDir
try {
    & gcloud builds submit `
        --config "$AiCoreDir\cloudbuild.yaml" `
        --substitutions "_REGION=$Region,_SERVICE_NAME=$ServiceName,_JOB_NAME=$JobName" `
        --project $ProjectId `
        $AiCoreDir
    if ($LASTEXITCODE -ne 0) { throw "gcloud builds submit failed" }
} finally {
    Pop-Location
}

if ($BuildOnly) {
    Write-Host ""
    Write-Host "[OK] Build-only mode - env vars not touched."
    exit 0
}

# Step 2: env vars Sprint 4 — Service Y Job
Write-Host ""
Write-Host "[2/3] Updating Sprint 4 env vars in Service '$ServiceName'..."
& gcloud run services update $ServiceName `
    --region $Region `
    --project $ProjectId `
    --update-env-vars "USE_TABULAR_PARSER=$UseTabularParser,MAX_LLM_VISION_PAGES=$MaxLlmVisionPages" `
    --quiet
if ($LASTEXITCODE -ne 0) { throw "Service env vars update failed" }

Write-Host ""
Write-Host "[2/3] Updating Sprint 4 env vars in Job '$JobName'..."
& gcloud run jobs update $JobName `
    --region $Region `
    --project $ProjectId `
    --update-env-vars "USE_TABULAR_PARSER=$UseTabularParser,MAX_LLM_VISION_PAGES=$MaxLlmVisionPages" `
    --quiet
if ($LASTEXITCODE -ne 0) { throw "Job env vars update failed" }

# Step 3: health check + report
Write-Host ""
Write-Host "[3/3] Verifying deploy..."

$ServiceUrl = & gcloud run services describe $ServiceName `
    --region $Region `
    --project $ProjectId `
    --format "value(status.url)"

Write-Host "  Service URL: $ServiceUrl"

try {
    $response = Invoke-WebRequest -Uri "$ServiceUrl/health" -TimeoutSec 30 -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host "  [OK] /health -> 200"
    } else {
        Write-Host "  [WARN] /health -> $($response.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  [WARN] /health check failed: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==============================================================="
Write-Host "[OK] Sprint 4 deploy completed."
Write-Host "==============================================================="
Write-Host ""
Write-Host "Next step: smoke from UI/UX in production."
Write-Host "  Frontend expects AI_CORE_URL=$ServiceUrl"
Write-Host "  Job: projects/$ProjectId/locations/$Region/jobs/$JobName"
Write-Host ""
Write-Host "Sprint 4 rollback (if needed):"
Write-Host "  .\services\ai-core\scripts\deploy-sprint4.ps1 -NoTabular"
Write-Host ""
Write-Host "Useful logs:"
Write-Host "  gcloud run services logs read $ServiceName --region=$Region --limit=50"
Write-Host "  gcloud run jobs executions list --job=$JobName --region=$Region --limit=10"
