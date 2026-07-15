$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root ".venv"
$python = Join-Path $venv "Scripts/python.exe"

if (-not (Test-Path -LiteralPath $python)) {
    python -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw "Failed to create the Python virtual environment." }
}

& $python -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "Failed to upgrade pip." }
& $python -m pip install -e "$root[dev]"
if ($LASTEXITCODE -ne 0) { throw "Failed to install gateway dependencies." }

$envPath = Join-Path $root ".env"
if (-not (Test-Path -LiteralPath $envPath)) {
    Copy-Item -LiteralPath (Join-Path $root ".env.example") -Destination $envPath
}

& (Join-Path $PSScriptRoot "init-env.ps1")
Push-Location $root
try {
    & $python -c "from app.config import Settings; from app.storage import GatewayStore; s=Settings.from_env(); GatewayStore(s.database_path).initialize(); print('Initialized', s.database_path)"
    if ($LASTEXITCODE -ne 0) { throw "Failed to initialize the gateway database." }
} finally {
    Pop-Location
}

Write-Host "Gateway setup is complete. No credentials were printed or copied into source files."
