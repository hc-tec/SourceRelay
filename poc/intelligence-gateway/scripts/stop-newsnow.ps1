$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Push-Location $root
try {
    docker compose stop newsnow
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed to stop NewsNow." }
    docker compose rm -f newsnow
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed to remove the NewsNow container." }
} finally {
    Pop-Location
}
