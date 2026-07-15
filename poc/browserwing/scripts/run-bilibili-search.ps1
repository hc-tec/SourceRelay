param(
    [Parameter(Mandatory = $true)]
    [string]$Keyword,

    [int]$Limit = 30,

    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$binary = Join-Path $root "node_modules/browserwing/bin/browserwing.exe"
$encodedKeyword = [Uri]::EscapeDataString($Keyword)
$url = "https://search.bilibili.com/all?keyword=$encodedKeyword"

$navigation = (& $binary exec navigate $url | ConvertFrom-Json)
if (-not $navigation.success) {
    throw "BrowserWing failed to navigate to Bilibili search."
}

Start-Sleep -Seconds 5

$javascript = @"
return Array.from(document.querySelectorAll('.bili-video-card')).slice(0,$Limit).map(function(el,i){
  var a=Array.from(el.querySelectorAll('a')).find(function(x){return x.href.indexOf('/video/')>=0;});
  var title=el.querySelector('h3, .bili-video-card__info--tit');
  var author=el.querySelector('.bili-video-card__info--author, .bili-video-card__info--author-text');
  var stats=Array.from(el.querySelectorAll('.bili-video-card__stats--item')).map(function(x){return x.innerText.trim();});
  return {
    rank:i+1,
    title:title?title.innerText.trim():'',
    author:author?author.innerText.trim():'',
    url:a?a.href:'',
    play:stats.length>0?stats[0]:'',
    danmaku:stats.length>1?stats[1]:''
  };
})
"@

$evaluation = (& $binary exec eval $javascript | ConvertFrom-Json)
if (-not $evaluation.success) {
    throw "BrowserWing failed to extract Bilibili search results."
}

$items = @($evaluation.data.result)
$result = [pscustomobject]@{
    source_platform = "bilibili"
    operation = "search"
    query = $Keyword
    query_scope = "anonymous-web-search-first-page"
    fetched_at = (Get-Date).ToString("o")
    partial = $true
    item_count = $items.Count
    items_with_url = @($items | Where-Object { $_.url }).Count
    warnings = @(
        "Only the first rendered page is collected.",
        "Search results may include promoted courses or cards without a video URL.",
        "The DOM selectors are versioned POC selectors and require health checks."
    )
    items = $items
}

$json = $result | ConvertTo-Json -Depth 10
if ($OutputPath) {
    $resolvedOutput = if ([IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $root $OutputPath }
    $parent = Split-Path -Parent $resolvedOutput
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent | Out-Null
    }
    $json | Set-Content -LiteralPath $resolvedOutput -Encoding utf8
}

$json
