$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $root "docker-compose.poc.yml"
$envFile = Join-Path $root ".env"

& (Join-Path $PSScriptRoot "init-env.ps1")

docker compose --project-name maxun-poc --env-file $envFile -f $compose up -d
if ($LASTEXITCODE -ne 0) {
    throw "Maxun Docker Compose failed to start."
}

$deadline = (Get-Date).AddMinutes(3)
$frontendReady = $false
$backendReady = $false
$browserReady = $false

do {
    Start-Sleep -Seconds 2
    try {
        $frontend = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:5173" -TimeoutSec 3
        $frontendReady = ($frontend.StatusCode -eq 200)
    } catch {
        $frontendReady = $false
    }
    try {
        $backend = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:18081" -TimeoutSec 3
        $backendReady = ($backend.StatusCode -lt 500)
    } catch {
        if ($_.Exception.Response) {
            $backendReady = ([int]$_.Exception.Response.StatusCode -lt 500)
        } else {
            $backendReady = $false
        }
    }
    try {
        $browser = Invoke-RestMethod -Uri "http://127.0.0.1:3002/health" -TimeoutSec 3
        $browserReady = ($browser.status -eq "healthy")
    } catch {
        $browserReady = $false
    }
} while (-not ($frontendReady -and $backendReady -and $browserReady) -and (Get-Date) -lt $deadline)

if (-not ($frontendReady -and $backendReady -and $browserReady)) {
    throw "Maxun did not become ready within three minutes. Run scripts/status.ps1 for diagnostics."
}

Write-Output "Maxun frontend: http://127.0.0.1:5173"
Write-Output "Maxun backend:  http://127.0.0.1:18081"
Write-Output "Browser health: http://127.0.0.1:3002/health"
