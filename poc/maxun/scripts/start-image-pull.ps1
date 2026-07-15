$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$stdout = Join-Path $root "runtime/image-pull.stdout.log"
$stderr = Join-Path $root "runtime/image-pull.stderr.log"
$pidFile = Join-Path $root "runtime/image-pull.pid"

New-Item -ItemType Directory -Path (Join-Path $root "runtime") -Force | Out-Null

$existing = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine -like "*pull-images.ps1*"
}
if ($existing) {
    Write-Output "Image pull is already running with PID $($existing[0].ProcessId)."
    exit 0
}

$process = Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "pull-images.ps1") `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru

Set-Content -LiteralPath $pidFile -Value $process.Id
Write-Output "Started Maxun image pull PID $($process.Id)."
Write-Output "Progress log: $stdout"
