$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$pidPath = Join-Path $root "runtime/gateway.pid"

if (Test-Path -LiteralPath $pidPath) {
    $gatewayPid = [int](Get-Content -Raw -LiteralPath $pidPath)
    if (Get-Process -Id $gatewayPid -ErrorAction SilentlyContinue) {
        Write-Host "Gateway process: running (PID $gatewayPid)"
    } else {
        Write-Host "Gateway process: stale PID file ($gatewayPid)"
    }
} else {
    Write-Host "Gateway process: stopped"
}

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -TimeoutSec 10
    $health | ConvertTo-Json -Depth 8
} catch {
    Write-Host "Gateway API: unavailable"
}

docker compose -f (Join-Path $root "docker-compose.yml") ps 2>$null
