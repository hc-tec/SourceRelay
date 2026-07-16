$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot "init-env.ps1")

Push-Location $root
try {
    docker compose up -d newsnow
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed to start NewsNow." }
} finally {
    Pop-Location
}

$healthUrl = "http://127.0.0.1:4444/api/latest"
for ($attempt = 1; $attempt -le 45; $attempt++) {
    try {
        $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 5
        if ($response.v) {
            Write-Host "NewsNow $($response.v) is ready at http://127.0.0.1:4444"
            exit 0
        }
    } catch {
        if ($attempt -eq 45) { throw }
    }
    Start-Sleep -Seconds 2
}

throw "NewsNow did not become ready within 90 seconds."
