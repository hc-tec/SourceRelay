$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    docker compose stop searxng
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed to stop SearXNG." }
    docker compose rm -f searxng
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed to remove the SearXNG container." }
} finally {
    Pop-Location
}
