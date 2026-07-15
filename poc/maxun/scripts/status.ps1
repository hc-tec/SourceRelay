$ErrorActionPreference = "Continue"

$root = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $root "docker-compose.poc.yml"
$envFile = Join-Path $root ".env"

docker compose --project-name maxun-poc --env-file $envFile -f $compose ps
docker compose --project-name maxun-poc --env-file $envFile -f $compose logs --tail 80 backend browser frontend postgres redis minio
