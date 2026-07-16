param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9_-]{6,80}$')]
    [string]$VideoId,

    [ValidateRange(1, 60)]
    [int]$WaitSeconds = 5,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$root = Split-Path -Parent $PSScriptRoot
$binary = Join-Path $root "node_modules/browserwing/bin/browserwing.exe"

function Invoke-BrowserWingJson {
    param([Parameter(Mandatory = $true)][string[]]$CommandArguments)

    $output = & $binary @CommandArguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "BrowserWing command failed."
    }
    $text = ($output | Out-String).Trim()
    $starts = @()
    $ends = @()
    for ($index = 0; $index -lt $text.Length; $index++) {
        if ($text[$index] -eq "{") { $starts += $index }
        if ($text[$index] -eq "}") { $ends += $index }
    }
    foreach ($start in $starts) {
        foreach ($end in ($ends | Sort-Object -Descending)) {
            if ($end -le $start) { continue }
            try {
                $parsed = $text.Substring($start, $end - $start + 1) | ConvertFrom-Json -ErrorAction Stop
                if ($parsed.PSObject.Properties.Name -contains "success") { return $parsed }
            } catch { continue }
        }
    }
    throw "BrowserWing command returned no valid JSON envelope."
}

if (-not (Test-Path -LiteralPath $binary)) {
    throw "BrowserWing executable is missing."
}

& (Join-Path $PSScriptRoot "start.ps1") | Out-Null
$previousErrorAction = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$browserStartOutput = & $binary browser start default 2>&1
$browserStartExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorAction
if ($browserStartExitCode -ne 0 -and ($browserStartOutput | Out-String) -notlike "*already running*") {
    throw "Unable to start the isolated BrowserWing browser instance."
}

$sourceUrl = "https://www.kuaishou.com/short-video/$VideoId"
$navigation = Invoke-BrowserWingJson -CommandArguments @("exec", "navigate", $sourceUrl)
if (-not $navigation.success) {
    throw "Unable to open the public Kuaishou video page."
}
Start-Sleep -Seconds $WaitSeconds

$pageInfo = Invoke-BrowserWingJson -CommandArguments @("exec", "page-info")
if (-not $pageInfo.success) {
    throw "Unable to inspect the rendered Kuaishou video page."
}
$finalUri = [Uri]$pageInfo.data.url
if ($finalUri.Host -ne "www.kuaishou.com" -or $finalUri.AbsolutePath.TrimEnd('/') -ne "/short-video/$VideoId") {
    throw "Kuaishou video navigation reached an unexpected route."
}

# The video element's src is deliberately not read: it can be a short-lived
# delivery URL. Only visible public metadata is projected into the artifact.
$extractJavascript = @"
var visible=function(el){var r=el.getBoundingClientRect();var s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
var clean=function(v){return v===undefined||v===null?'':String(v).trim().replace(/\s+/g,' ');};
var root=document.querySelector('.short-video-info-container');
var titleNode=document.querySelector('.video-info-title,.short-video-info-container-detail');
var descriptionNode=document.querySelector('.short-video-info-container-detail');
var authorNode=document.querySelector('.profile-user-name-title');
var timeNode=document.querySelector('.photo-time');
var likesNode=document.querySelector('.like-item .item-count,.like-item .item-text');
var video=document.querySelector('video');
var body=(document.body&&document.body.innerText||'').toLowerCase();
var visibleLogin=Array.from(document.querySelectorAll('button,[role="dialog"],input')).some(function(el){return visible(el)&&/登录|注册|验证码|sign in|log in/i.test(clean(el.innerText||el.placeholder));});
var title=clean(titleNode?titleNode.innerText:(document.title||'').replace(/-快手\s*$/,''));
var description=clean(descriptionNode?descriptionNode.innerText:'');
return {schema_version:1,platform:'kuaishou',operation:'video_detail',video_id:'$VideoId',title:title,description:description,author_name:clean(authorNode?authorNode.innerText:''),published_text:clean(timeNode?timeNode.innerText:''),likes_text:clean(likesNode?likesNode.innerText:''),source_url:'$sourceUrl',query_scope:'anonymous-public-rendered-video-page',page_state:(title&&video)?'ok':(visibleLogin?'authentication_required':'source_unavailable'),video_element_present:!!video,media_url_exported:false};
"@

$evaluation = Invoke-BrowserWingJson -CommandArguments @("exec", "eval", $extractJavascript)
if (-not $evaluation.success) {
    throw "BrowserWing failed to read public Kuaishou video metadata."
}
$result = $evaluation.data.result
if ($result.page_state -eq "authentication_required") {
    throw "authentication_required: Kuaishou displayed a login gate."
}
if ($result.page_state -ne "ok") {
    throw "Kuaishou returned no readable public video metadata."
}

$resolvedOutput = if ([IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $root $OutputPath }
$parent = Split-Path -Parent $resolvedOutput
if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent | Out-Null
}
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resolvedOutput -Encoding utf8
Write-Output "Kuaishou public video artifact written."
