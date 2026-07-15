param(
    [Parameter(Mandatory = $true)]
    [string]$Keyword,

    [int]$Limit = 30,

    [int]$WaitSeconds = 12,

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
        throw "BrowserWing command failed: $($CommandArguments -join ' ')"
    }
    $text = ($output | Out-String).Trim()
    $jsonStarts = @()
    $jsonEnds = @()
    for ($index = 0; $index -lt $text.Length; $index++) {
        if ($text[$index] -eq "{") { $jsonStarts += $index }
        if ($text[$index] -eq "}") { $jsonEnds += $index }
    }
    if ($jsonStarts.Count -eq 0 -or $jsonEnds.Count -eq 0) {
        throw "BrowserWing command returned no JSON object: $($CommandArguments -join ' ')"
    }
    foreach ($jsonStart in $jsonStarts) {
        foreach ($jsonEnd in ($jsonEnds | Sort-Object -Descending)) {
            if ($jsonEnd -le $jsonStart) { continue }
            $json = $text.Substring($jsonStart, $jsonEnd - $jsonStart + 1)
            try {
                $parsed = $json | ConvertFrom-Json -ErrorAction Stop
                if ($parsed.PSObject.Properties.Name -contains "success") {
                    return $parsed
                }
            } catch {
                continue
            }
        }
    }
    throw "BrowserWing command returned malformed JSON: $($CommandArguments -join ' ')"
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

$navigation = Invoke-BrowserWingJson -CommandArguments @(
    "exec", "navigate", "https://www.xiaohongshu.com/explore"
)
if (-not $navigation.success) {
    throw "Unable to open Xiaohongshu Explore with the isolated BrowserWing profile."
}

Start-Sleep -Seconds 3

# Xiaohongshu can restore the last opened note overlay from session state even
# after navigating to /explore. Close that overlay through browser history
# before trying to address the search box.
for ($attempt = 0; $attempt -lt 3; $attempt++) {
    $landingPage = Invoke-BrowserWingJson -CommandArguments @("exec", "page-info")
    $landingUri = [Uri]$landingPage.data.url
    if ($landingUri.AbsolutePath -eq "/explore" -or $landingUri.AbsolutePath -eq "/explore/") {
        break
    }
    if ($landingUri.AbsolutePath -like "/explore/*") {
        & $binary exec back | Out-Null
        Start-Sleep -Seconds 3
        continue
    }
    break
}

$escapedKeyword = $Keyword.Replace("\", "\\").Replace("'", "\'")
$searchJavascript = @"
var preferred=[document.querySelector('#search-input-in-feeds'),document.querySelector('#search-input')];
var el=preferred.find(function(x){return x&&!!(x.offsetWidth||x.offsetHeight||x.getClientRects().length);}) || Array.from(document.querySelectorAll('textarea')).find(function(x){
  return !!(x.offsetWidth||x.offsetHeight||x.getClientRects().length);
});
if(!el){return {ok:false,error:'visible search textarea not found'};}
el.focus();
el.select();
var inserted=document.execCommand('insertText',false,'$escapedKeyword');
return {ok:inserted,value:el.value};
"@

$searchInput = Invoke-BrowserWingJson -CommandArguments @("exec", "eval", $searchJavascript)
if (-not $searchInput.success -or -not $searchInput.data.result.ok) {
    throw "Unable to populate the visible Xiaohongshu search input."
}

Start-Sleep -Seconds 1
& $binary exec press-key Enter | Out-Null
Start-Sleep -Seconds $WaitSeconds

$pageInfo = Invoke-BrowserWingJson -CommandArguments @("exec", "page-info")
if (-not $pageInfo.success -or $pageInfo.data.url -notlike "*xiaohongshu.com/search_result*") {
    throw "Xiaohongshu did not enter a search results route. Final URL: $($pageInfo.data.url)"
}
if ($pageInfo.data.title -notlike "$Keyword*") {
    throw "Xiaohongshu entered a search route for a different query. Final title: $($pageInfo.data.title)"
}

$extractJavascript = @"
return Array.from(document.querySelectorAll('section.note-item')).slice(0,$Limit).map(function(el,i){
  var links=Array.from(el.querySelectorAll('a'));
  var a=links.find(function(x){return x.href.indexOf('/explore/')>=0||x.href.indexOf('/discovery/item/')>=0;});
  var title=el.querySelector('.title, .note-title, [class*=title]');
  var author=el.querySelector('.author-wrapper .name, .author .name, [class*=author] .name, [class*=nickname]');
  var likes=el.querySelector('.like-wrapper .count, [class*=like] .count, [class*=like-count]');
  var raw=a?a.href:'';
  var canonical=raw?raw.split('?')[0]:'';
  return {
    rank:i+1,
    title:title?title.textContent.trim():'',
    author:author?author.textContent.trim():'',
    likes:likes?likes.textContent.trim():'',
    url:canonical,
    text:el.innerText.trim()
  };
})
"@

$evaluation = Invoke-BrowserWingJson -CommandArguments @("exec", "eval", $extractJavascript)
if (-not $evaluation.success) {
    throw "BrowserWing failed to extract Xiaohongshu search results."
}

$items = @($evaluation.data.result)
$itemsWithUrl = @($items | Where-Object { $_.url })
if ($itemsWithUrl.Count -eq 0) {
    throw "Xiaohongshu returned no note cards with canonical URLs. The login may have expired or the page layout may have changed."
}

$result = [pscustomobject]@{
    source_platform = "xiaohongshu"
    operation = "search"
    query = $Keyword
    query_scope = "authenticated-web-search-first-rendered-page"
    fetched_at = (Get-Date).ToString("o")
    final_route = ([Uri]$pageInfo.data.url).AbsolutePath
    partial = $true
    item_count = $items.Count
    items_with_url = $itemsWithUrl.Count
    warnings = @(
        "Requires a user-authenticated isolated Chrome profile.",
        "Only the first rendered result set is collected; pagination is not implemented.",
        "Search results can be personalized by account and platform ranking.",
        "Short-lived xsec_token query parameters are deliberately removed from stored URLs.",
        "Suggestion cards can appear among note cards and may have no canonical URL."
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
