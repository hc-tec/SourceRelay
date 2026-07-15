$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $root "docker-compose.poc.yml"
$envFile = Join-Path $root ".env"

if (-not (Test-Path -LiteralPath $envFile)) {
    Write-Output "No Maxun POC .env exists; nothing to stop."
    exit 0
}

docker compose --project-name maxun-poc --env-file $envFile -f $compose stop
if ($LASTEXITCODE -ne 0) {
    throw "Maxun Docker Compose failed to stop cleanly."
}
