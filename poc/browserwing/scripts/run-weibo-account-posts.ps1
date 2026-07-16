param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9]{5,20}$')]
    [string]$AccountId,

    [ValidateRange(1, 10)]
    [int]$Limit = 10,

    [ValidateRange(1, 60)]
    [int]$WaitSeconds = 6,

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

$sourceUrl = "https://m.weibo.cn/u/$AccountId"
$navigation = Invoke-BrowserWingJson -CommandArguments @("exec", "navigate", $sourceUrl)
if (-not $navigation.success) {
    throw "Unable to open the public Weibo account page."
}
Start-Sleep -Seconds $WaitSeconds

$pageInfo = Invoke-BrowserWingJson -CommandArguments @("exec", "page-info")
if (-not $pageInfo.success) {
    throw "Unable to inspect the rendered Weibo page."
}
$finalUri = [Uri]$pageInfo.data.url
if ($finalUri.Host -ne "m.weibo.cn" -or $finalUri.AbsolutePath.TrimEnd('/') -ne "/u/$AccountId") {
    throw "Weibo public account navigation reached an unexpected route."
}

# Build an allowlisted public payload inside the page. Never serialize the full
# Vue instance: it includes user_token and can include signed media URLs.
$extractJavascript = @"
var cards=Array.from(document.querySelectorAll('.card.card9'));
var visible=(document.body&&document.body.innerText||'').toLowerCase();
var state=cards.length?'ok':((visible.indexOf('登录')>=0||visible.indexOf('login')>=0)?'authentication_required':'source_unavailable');
var clean=function(v){return v===undefined||v===null?null:v;};
var items=cards.slice(0,$Limit).map(function(card){
  var vue=card['__vue__'];
  var candidate=vue&&vue.item;
  var m=candidate&&candidate.mblog?candidate.mblog:candidate;
  if(!m){return null;}
  var user=m.user||{};
  var page=m.page_info||{};
  return {
    id:String(clean(m.id)||''),
    mid:String(clean(m.mid)||clean(m.id)||''),
    bid:String(clean(m.bid)||''),
    created_at:String(clean(m.created_at)||''),
    text_html:String(clean(m.text)||''),
    source:String(clean(m.source)||''),
    reposts_count:Number(clean(m.reposts_count)||0),
    comments_count:Number(clean(m.comments_count)||0),
    attitudes_count:Number(clean(m.attitudes_count)||0),
    pic_ids:Array.isArray(m.pic_ids)?m.pic_ids.map(String):[],
    is_long_text:Boolean(m.isLongText||m.is_long_text),
    page_info:{
      object_type:String(clean(page.object_type)||''),
      page_title:String(clean(page.page_title)||''),
      page_url:String(clean(page.page_url)||''),
      play_count:Number(clean(page.play_count)||0)
    },
    user:{
      id:String(clean(user.id)||''),
      screen_name:String(clean(user.screen_name)||''),
      verified:Boolean(user.verified),
      verified_reason:String(clean(user.verified_reason)||'')
    }
  };
}).filter(function(item){return item&&item.mid;});
return {
  schema_version:1,
  platform:'weibo',
  operation:'account_posts',
  account_id:'$AccountId',
  account_name:items.length?items[0].user.screen_name:'',
  source_url:'$sourceUrl',
  query_scope:'anonymous-public-rendered-first-page',
  page_state:state,
  partial:true,
  item_count:items.length,
  items:items
};
"@

$evaluation = Invoke-BrowserWingJson -CommandArguments @("exec", "eval", $extractJavascript)
if (-not $evaluation.success) {
    throw "BrowserWing failed to read the public Weibo post cards."
}
$result = $evaluation.data.result
if ($result.page_state -eq "authentication_required") {
    throw "authentication_required: Weibo displayed a login gate."
}
if ($result.page_state -ne "ok" -or @($result.items).Count -eq 0) {
    throw "Weibo returned no readable public post cards; the page layout or access state may have changed."
}

$resolvedOutput = if ([IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $root $OutputPath }
$parent = Split-Path -Parent $resolvedOutput
if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent | Out-Null
}
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resolvedOutput -Encoding utf8
Write-Output "Weibo public account artifact written."
