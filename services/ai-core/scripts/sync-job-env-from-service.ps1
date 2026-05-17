# Copies env vars from the ai-core Cloud Run Service to the ai-core-worker
# Cloud Run Job. Runs after the first build (when the Job was created
# without env vars) and any time new vars are added to the Service that the
# worker also needs.
#
# Usage (from repo root):
#   .\services\ai-core\scripts\sync-job-env-from-service.ps1

[CmdletBinding()]
param(
    [string]$ProjectId    = "grupo-rg-a9929",
    [string]$Region       = "europe-southwest1",
    [string]$ServiceName  = "ai-core",
    [string]$JobName      = "ai-core-worker"
)

$ErrorActionPreference = 'Continue'

gcloud config set project $ProjectId | Out-Null

Write-Host "==> Reading env vars from Service '$ServiceName'..."

$serviceJson = gcloud run services describe $ServiceName --region=$Region --format=json | Out-String
$service = $serviceJson | ConvertFrom-Json

$envList = $service.spec.template.spec.containers[0].env
if (-not $envList) {
    Write-Host "    Service has no env vars set. Nothing to copy."
    exit 0
}

$skipKeys = @('PORT', 'WORKER_JOB_NAME')
$pairs = New-Object System.Collections.Generic.List[string]
foreach ($e in $envList) {
    if ($skipKeys -contains $e.name) { continue }
    if (-not $e.value) {
        Write-Host ("    Skipping {0} (empty value; may be a Secret Manager ref)." -f $e.name)
        continue
    }
    Write-Host ("    [+] {0}" -f $e.name)
    $pairs.Add("$($e.name)=$($e.value)")
}

if ($pairs.Count -eq 0) {
    Write-Host "    Nothing copyable. Exiting."
    exit 0
}

Write-Host ""
Write-Host ("==> Writing {0} env vars to temp YAML file..." -f $pairs.Count)
$tmpFile = New-TemporaryFile
$tmpPath = $tmpFile.FullName
try {
    $yamlLines = $pairs | ForEach-Object {
        $parts = $_ -split '=', 2
        $key   = $parts[0]
        $value = $parts[1]
        $escaped = $value -replace "'", "''"
        "{0}: '{1}'" -f $key, $escaped
    }
    Set-Content -Path $tmpPath -Value $yamlLines -Encoding utf8

    Write-Host ("==> Applying env vars to Job '{0}'..." -f $JobName)
    gcloud run jobs update $JobName --region=$Region --env-vars-file="$tmpPath"
} finally {
    Remove-Item -Path $tmpPath -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Done. Verify with:"
$verifyCmd = "  gcloud run jobs describe " + $JobName + " --region=" + $Region + " --format=`"value(spec.template.spec.containers[0].env[].name)`""
Write-Host $verifyCmd
