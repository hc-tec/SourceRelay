$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root ".venv/Scripts/python.exe"
$envPath = Join-Path $root ".env"
$runtime = Join-Path $root "runtime"
$pidPath = Join-Path $runtime "gateway.pid"

if (-not (Test-Path -LiteralPath $python)) {
    throw "Virtual environment is missing. Run scripts/setup.ps1 first."
}

if (Test-Path -LiteralPath $envPath) {
    foreach ($line in Get-Content -LiteralPath $envPath) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) { continue }
        $name, $value = $trimmed.Split("=", 2)
        [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), "Process")
    }
}

if (-not (Test-Path -LiteralPath $runtime)) {
    New-Item -ItemType Directory -Path $runtime | Out-Null
}

if (Test-Path -LiteralPath $pidPath) {
    $oldPid = [int](Get-Content -Raw -LiteralPath $pidPath)
    if (Get-Process -Id $oldPid -ErrorAction SilentlyContinue) {
        Write-Host "Gateway is already running with PID $oldPid."
        exit 0
    }
    Remove-Item -LiteralPath $pidPath
}

$hostValue = if ($env:GATEWAY_HOST) { $env:GATEWAY_HOST } else { "127.0.0.1" }
$portValue = if ($env:GATEWAY_PORT) { $env:GATEWAY_PORT } else { "8765" }
$levelValue = if ($env:GATEWAY_LOG_LEVEL) { $env:GATEWAY_LOG_LEVEL } else { "info" }
$process = Start-Process -FilePath $python -ArgumentList @(
    "-m", "uvicorn", "app.main:app",
    "--host", $hostValue,
    "--port", $portValue,
    "--log-level", $levelValue
) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime "gateway.out.log") -RedirectStandardError (Join-Path $runtime "gateway.err.log") -PassThru

Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ascii
Write-Host "Gateway started with PID $($process.Id) at http://${hostValue}:${portValue}"
