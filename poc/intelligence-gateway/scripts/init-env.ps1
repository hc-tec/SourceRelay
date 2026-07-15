$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$template = Join-Path $root "searxng/settings.yml.example"
$runtimeDir = Join-Path $root "runtime/searxng"
$settingsPath = Join-Path $runtimeDir "settings.yml"

if (-not (Test-Path -LiteralPath $template)) {
    throw "SearXNG settings template is missing: $template"
}

if (-not (Test-Path -LiteralPath $runtimeDir)) {
    New-Item -ItemType Directory -Path $runtimeDir | Out-Null
}

if (-not (Test-Path -LiteralPath $settingsPath)) {
    $bytes = New-Object byte[] 48
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    } finally {
        $generator.Dispose()
    }
    $secret = [Convert]::ToBase64String($bytes)
    $content = (Get-Content -Raw -LiteralPath $template).Replace("__SECRET_KEY__", $secret)
    Set-Content -LiteralPath $settingsPath -Value $content -Encoding utf8
    Write-Host "Created runtime/searxng/settings.yml with a generated local secret."
} else {
    Write-Host "runtime/searxng/settings.yml already exists; keeping the existing secret."
}
