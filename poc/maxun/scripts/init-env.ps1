$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root ".env"

if (Test-Path -LiteralPath $envPath) {
    Write-Output "Maxun POC .env already exists; leaving it unchanged."
    exit 0
}

function New-HexSecret([int]$Bytes) {
    $buffer = New-Object byte[] $Bytes
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($buffer)
    } finally {
        $rng.Dispose()
    }
    return -join ($buffer | ForEach-Object { $_.ToString("x2") })
}

$content = @"
NODE_ENV=production
JWT_SECRET=$(New-HexSecret 48)
SESSION_SECRET=$(New-HexSecret 48)
ENCRYPTION_KEY=$(New-HexSecret 32)

DB_NAME=maxun
DB_USER=maxun
DB_PASSWORD=$(New-HexSecret 24)
DB_HOST=postgres
DB_PORT=5432

REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=

MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_CONSOLE_PORT=9001
MINIO_ACCESS_KEY=maxunpoc
MINIO_SECRET_KEY=$(New-HexSecret 24)

BACKEND_PORT=8080
FRONTEND_PORT=5173
BACKEND_URL=http://127.0.0.1:18081
PUBLIC_URL=http://127.0.0.1:5173
VITE_BACKEND_URL=http://127.0.0.1:18081
VITE_PUBLIC_URL=http://127.0.0.1:5173

BROWSER_WS_PORT=3001
BROWSER_HEALTH_PORT=3002
BROWSER_WS_HOST=browser

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
AIRTABLE_CLIENT_ID=
AIRTABLE_REDIRECT_URI=
MAXUN_TELEMETRY=false

POC_EMAIL=maxun-poc@example.invalid
POC_PASSWORD=$(New-HexSecret 18)
"@

Set-Content -LiteralPath $envPath -Value $content -Encoding utf8
Write-Output "Created ignored Maxun POC environment file at $envPath"
