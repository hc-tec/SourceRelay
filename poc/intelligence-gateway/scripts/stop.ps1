$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pidPath = Join-Path $root "runtime/gateway.pid"

if (-not (Test-Path -LiteralPath $pidPath)) {
    Write-Host "Gateway PID file was not found."
    exit 0
}

$gatewayPid = [int](Get-Content -Raw -LiteralPath $pidPath)
$process = Get-Process -Id $gatewayPid -ErrorAction SilentlyContinue
if ($process) {
    $children = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $gatewayPid }
    foreach ($child in $children) {
        Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue
    }
    # The launcher can exit after its uvicorn child is stopped. Treat that
    # normal parent/child race as an already-completed stop.
    Stop-Process -Id $gatewayPid -ErrorAction SilentlyContinue
    $process.WaitForExit(10000) | Out-Null
}
Remove-Item -LiteralPath $pidPath -ErrorAction SilentlyContinue
Write-Host "Gateway stopped."
