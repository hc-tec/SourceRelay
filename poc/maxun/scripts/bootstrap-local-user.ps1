$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root ".env"
$cookiesDir = Join-Path $root "cookies"
$runtimeDir = Join-Path $root "runtime"
$backendUrl = "http://127.0.0.1:18081"

if (-not (Test-Path -LiteralPath $envPath)) {
    throw "Missing .env. Run scripts/init-env.ps1 first."
}

$settings = @{}
foreach ($line in [System.IO.File]::ReadAllLines($envPath)) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith("#")) {
        continue
    }
    $parts = $line.Split('=', 2)
    if ($parts.Count -eq 2) {
        $settings[$parts[0].Trim()] = $parts[1]
    }
}

if (-not $settings.POC_EMAIL -or -not $settings.POC_PASSWORD) {
    throw "POC_EMAIL or POC_PASSWORD is missing from .env."
}

New-Item -ItemType Directory -Force -Path $cookiesDir, $runtimeDir | Out-Null
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$credentials = @{
    email = $settings.POC_EMAIL
    password = $settings.POC_PASSWORD
} | ConvertTo-Json

$authMode = "registered"
try {
    Invoke-RestMethod -Method Post -Uri "$backendUrl/auth/register" -ContentType "application/json" -Body $credentials -WebSession $session | Out-Null
} catch {
    $errorBody = $_.ErrorDetails.Message
    if ($errorBody -notmatch 'USER_EXISTS') {
        throw
    }
    $authMode = "logged_in"
    Invoke-RestMethod -Method Post -Uri "$backendUrl/auth/login" -ContentType "application/json" -Body $credentials -WebSession $session | Out-Null
}

$currentUser = Invoke-RestMethod -Method Get -Uri "$backendUrl/auth/current-user" -WebSession $session
$apiKeyResponse = Invoke-RestMethod -Method Get -Uri "$backendUrl/auth/api-key" -WebSession $session
$apiKeyCreated = $false
if ([string]::IsNullOrWhiteSpace($apiKeyResponse.api_key)) {
    $apiKeyResponse = Invoke-RestMethod -Method Post -Uri "$backendUrl/auth/generate-api-key" -WebSession $session
    $apiKeyCreated = $true
}

[System.IO.File]::WriteAllText(
    (Join-Path $cookiesDir "maxun-api-key.txt"),
    [string]$apiKeyResponse.api_key,
    [System.Text.UTF8Encoding]::new($false)
)

$tokenCookie = $session.Cookies.GetCookies([Uri]$backendUrl)["token"]
if ($null -eq $tokenCookie) {
    throw "Authentication succeeded but no token cookie was returned."
}

$userForUiJson = $currentUser.user |
    Select-Object -Property * -ExcludeProperty api_key, api_key_created_at |
    ConvertTo-Json -Compress -Depth 5

$storageState = @{
    cookies = @(@{
        name = $tokenCookie.Name
        value = $tokenCookie.Value
        domain = "127.0.0.1"
        path = "/"
        expires = -1
        httpOnly = $true
        secure = $false
        sameSite = "Lax"
    })
    origins = @(@{
        origin = "http://127.0.0.1:5173"
        localStorage = @(@{
            name = "user"
            value = $userForUiJson
        })
    })
} | ConvertTo-Json -Depth 5

[System.IO.File]::WriteAllText(
    (Join-Path $cookiesDir "playwright-storage-state.json"),
    $storageState,
    [System.Text.UTF8Encoding]::new($false)
)

$robots = Invoke-RestMethod -Method Get -Uri "$backendUrl/api/robots" -Headers @{ "x-api-key" = $apiKeyResponse.api_key }
if ($robots.statusCode -ne 200 -or $robots.messageCode -ne "success") {
    throw "GET /api/robots returned an unexpected response."
}
$robotCount = [int]$robots.robots.totalCount

$summary = [ordered]@{
    checkedAt = (Get-Date).ToString("o")
    authMode = $authMode
    currentUserOk = [bool]$currentUser.ok
    apiKeyCreated = $apiKeyCreated
    apiRobotsEndpointOk = $true
    robotCount = $robotCount
}
$summaryJson = $summary | ConvertTo-Json
[System.IO.File]::WriteAllText(
    (Join-Path $runtimeDir "bootstrap-summary.json"),
    $summaryJson,
    [System.Text.UTF8Encoding]::new($false)
)

Write-Output "Local user bootstrap: $authMode"
Write-Output "Current-user endpoint: OK"
Write-Output "API key stored in ignored cookies directory: OK"
Write-Output "GET /api/robots: OK ($robotCount robots)"
