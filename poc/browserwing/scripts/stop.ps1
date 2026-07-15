$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root "browserwing.pid"
$binary = Join-Path $root "node_modules/browserwing/bin/browserwing.exe"

if (-not (Test-Path -LiteralPath $pidFile)) {
    Write-Output "No BrowserWing PID file exists."
    exit 0
}

$serverPid = [int](Get-Content -LiteralPath $pidFile -Raw)
$process = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
if ($process) {
    if (Test-Path -LiteralPath $binary) {
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        & $binary browser stop default 2>$null | Out-Null
        $ErrorActionPreference = $previousErrorActionPreference
        Start-Sleep -Seconds 1
    }
    Stop-Process -Id $serverPid
    $process.WaitForExit(10000) | Out-Null
    Write-Output "Stopped BrowserWing PID $serverPid."
} else {
    Write-Output "BrowserWing PID $serverPid is no longer running."
}

Remove-Item -LiteralPath $pidFile -Force

# A direct `exec` session can leave Chrome children alive even after the
# BrowserWing instance is marked inactive. Terminate only processes whose
# command line explicitly points at this POC's isolated profile.
$profilePath = Join-Path $root "runtime/chrome-user-data"
$pocChrome = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine.IndexOf($profilePath, [StringComparison]::OrdinalIgnoreCase) -ge 0
}
foreach ($chromeProcess in $pocChrome) {
    Stop-Process -Id $chromeProcess.ProcessId -Force -ErrorAction SilentlyContinue
}
