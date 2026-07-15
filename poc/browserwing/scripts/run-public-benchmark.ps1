param(
    [int]$Iterations = 3
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$binary = Join-Path $root "node_modules/browserwing/bin/browserwing.exe"
$sampleDir = Join-Path $root "samples"
$logDir = Join-Path $root "logs"

$scripts = @(
    "bilibili-hot",
    "zhihu-hot",
    "weibo-hot",
    "toutiao-hot",
    "36kr-hot"
)

$results = [System.Collections.Generic.List[object]]::new()

foreach ($scriptName in $scripts) {
    for ($iteration = 1; $iteration -le $Iterations; $iteration++) {
        $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $stderrPath = Join-Path $logDir "$scriptName-$iteration-$timestamp.stderr.log"
        $stopwatch = [Diagnostics.Stopwatch]::StartNew()
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $raw = & $binary run $scriptName --format=json 2> $stderrPath
        $ErrorActionPreference = $previousErrorActionPreference
        $exitCode = $LASTEXITCODE
        $stopwatch.Stop()

        $success = $false
        $itemCount = 0
        $fields = @()
        $errorMessage = $null

        try {
            $parsed = ($raw -join "`n") | ConvertFrom-Json
            if ($null -ne $parsed) {
                $items = @($parsed)
                $itemCount = $items.Count
                if ($itemCount -gt 0) {
                    $fields = @($items[0].PSObject.Properties.Name)
                }
                $success = ($exitCode -eq 0 -and $itemCount -gt 0)

                if ($iteration -eq 1) {
                    $samplePath = Join-Path $sampleDir "$scriptName.sample.json"
                    $parsed | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $samplePath -Encoding utf8
                }
            }
        } catch {
            $errorMessage = $_.Exception.Message
        }

        if (-not $success -and -not $errorMessage) {
            $errorMessage = "Command exited with code $exitCode or returned an empty result."
        }

        $record = [pscustomobject]@{
            script = $scriptName
            iteration = $iteration
            timestamp = (Get-Date).ToString("o")
            success = $success
            exit_code = $exitCode
            elapsed_ms = $stopwatch.ElapsedMilliseconds
            item_count = $itemCount
            fields = $fields
            error = $errorMessage
            stderr_log = $stderrPath.Substring($root.Length + 1)
        }

        $results.Add($record)
        Write-Output ($record | ConvertTo-Json -Compress)
    }
}

$summaryPath = Join-Path $sampleDir "public-run-summary.json"
$results | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $summaryPath -Encoding utf8
Write-Output "Saved benchmark summary to $summaryPath"
