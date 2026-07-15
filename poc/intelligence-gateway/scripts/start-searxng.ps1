$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot "init-env.ps1")

Push-Location $root
try {
    docker compose up -d searxng
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed to start SearXNG." }
} finally {
    Pop-Location
}

$healthUrl = "http://127.0.0.1:8888/search?q=healthcheck&format=json"
for ($attempt = 1; $attempt -le 45; $attempt++) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 5
        if ($response.StatusCode -eq 200 -and $response.Headers["Content-Type"] -like "application/json*") {
            Write-Host "SearXNG is ready at http://127.0.0.1:8888"
            exit 0
        }
    } catch {
        if ($attempt -eq 45) { throw }
    }
    Start-Sleep -Seconds 2
}

throw "SearXNG did not become ready within 90 seconds."
