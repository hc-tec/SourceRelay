$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    docker compose down
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed to stop SearXNG." }
} finally {
    Pop-Location
}
