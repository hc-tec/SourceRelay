$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$binary = Join-Path $root "node_modules/browserwing/bin/browserwing.exe"
$stdout = Join-Path $root "logs/server.stdout.log"
$stderr = Join-Path $root "logs/server.stderr.log"
$pidFile = Join-Path $root "browserwing.pid"
$isolatedHome = Join-Path $root "runtime/home"

if (-not (Test-Path -LiteralPath $binary)) {
    throw "BrowserWing is not installed. Run npm install in $root first."
}

if (-not (Test-Path -LiteralPath $isolatedHome)) {
    New-Item -ItemType Directory -Path $isolatedHome | Out-Null
}

# BrowserWing's first-run initializer currently derives a default profile from
# the OS home directory before synchronizing config.toml. Keep even that
# temporary first-run path inside the ignored POC runtime directory.
$env:USERPROFILE = $isolatedHome
$env:HOME = $isolatedHome

try {
    $existing = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8080" -TimeoutSec 2
} catch {
    $existing = $null
}

if ($existing -and $existing.StatusCode -eq 200) {
    Write-Output "BrowserWing or another HTTP service is already available on port 8080."
    exit 0
}

$process = Start-Process `
    -FilePath $binary `
    -ArgumentList "--config", (Join-Path $root "config.toml") `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru

Set-Content -LiteralPath $pidFile -Value $process.Id

$deadline = (Get-Date).AddSeconds(30)
$ready = $false
do {
    Start-Sleep -Milliseconds 500
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8080" -TimeoutSec 2
        $ready = ($response.StatusCode -eq 200)
    } catch {
        $ready = $false
    }
} while (-not $ready -and -not $process.HasExited -and (Get-Date) -lt $deadline)

if (-not $ready) {
    if (-not $process.HasExited) {
        Stop-Process -Id $process.Id
    }
    throw "BrowserWing did not become ready within 30 seconds. Check $stderr."
}

Write-Output "Started BrowserWing PID $($process.Id) on http://127.0.0.1:8080"
