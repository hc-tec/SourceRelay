param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9]{1,20}$')]
    [string]$QuestionId,

    [ValidateRange(1, 5)]
    [int]$Limit = 5,

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

$sourceUrl = "https://www.zhihu.com/question/$QuestionId"
$navigation = Invoke-BrowserWingJson -CommandArguments @("exec", "navigate", $sourceUrl)
if (-not $navigation.success) {
    throw "Unable to open the public Zhihu question page."
}
Start-Sleep -Seconds $WaitSeconds

$pageInfo = Invoke-BrowserWingJson -CommandArguments @("exec", "page-info")
if (-not $pageInfo.success) {
    throw "Unable to inspect the rendered Zhihu question page."
}
$finalUri = [Uri]$pageInfo.data.url
if ($finalUri.Host -ne "www.zhihu.com" -or $finalUri.AbsolutePath.TrimEnd('/') -ne "/question/$QuestionId") {
    throw "Zhihu question navigation reached an unexpected route."
}

# Keep the extraction allowlisted. In particular, do not serialize React/Vue
# state, raw link hrefs, browser storage, or the complete answer object.
$extractJavascript = @"
var visible=function(el){var r=el.getBoundingClientRect();var s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';};
var clean=function(v){return v===undefined||v===null?'':String(v).trim();};
var safeZhihuPath=function(raw,kind){try{var u=new URL(raw);if(u.hostname!=='www.zhihu.com')return '';if(kind==='answer'&&!/^\/question\/$QuestionId\/answer\/[0-9]+$/.test(u.pathname))return '';if(kind==='people'&&!/^\/people\/[^/?#]+$/.test(u.pathname))return '';return 'https://www.zhihu.com'+u.pathname;}catch(e){return '';}};
var titleNode=Array.from(document.querySelectorAll('h1.QuestionHeader-title,h1')).find(visible);
var questionTextNode=Array.from(document.querySelectorAll('.QuestionRichText,[class*=QuestionRichText]')).find(visible);
var topicNodes=Array.from(document.querySelectorAll('.QuestionTopic')).filter(visible);
var cards=Array.from(document.querySelectorAll('div.ContentItem.AnswerItem')).filter(visible);
var answers=cards.slice(0,$Limit).map(function(card){
  var answerId=clean(card.getAttribute('name'));
  var answerLink=Array.from(card.querySelectorAll('a[href]')).map(function(a){return safeZhihuPath(a.href,'answer');}).find(function(x){return !!x;})||'';
  if(!answerLink&&/^[0-9]+$/.test(answerId))answerLink='https://www.zhihu.com/question/$QuestionId/answer/'+answerId;
  var author=card.querySelector('.AuthorInfo-name');
  var authorName=clean(author?author.innerText:'');
  var authorLink=author?Array.from(author.querySelectorAll('a[href]')).map(function(a){return safeZhihuPath(a.href,'people');}).find(function(x){return !!x;})||'':'';
  var headline=card.querySelector('.AuthorInfo-detail,.AuthorInfo-badgeText');
  var rich=card.querySelector('.RichContent-inner,[itemprop="text"]');
  var richContainer=card.querySelector('.RichContent');
  var fullText=clean(rich?rich.innerText:'');
  var timeNode=card.querySelector('.ContentItem-time,[datetime]');
  return {answer_id:answerId,answer_url:answerLink,author_name:authorName,author_url:authorLink,author_headline:clean(headline?headline.innerText:''),text:fullText.slice(0,50000),text_length:fullText.length,published_text:clean(timeNode?timeNode.innerText:(timeNode?timeNode.getAttribute('datetime'):'')),text_truncated:!!(richContainer&&richContainer.className.indexOf('is-collapsed')>=0)||fullText.indexOf('阅读全文')>=0};
}).filter(function(x){return /^[0-9]+$/.test(x.answer_id)&&x.answer_url&&x.text;});
var questionTitle=clean(titleNode?titleNode.innerText:'');
var questionText=clean(questionTextNode?questionTextNode.innerText:'');
var authVisible=Array.from(document.querySelectorAll('[class*=SignFlow],[class*=Login],button')).some(function(el){return visible(el)&&/登录|注册|验证码登录|sign in|log in/i.test(clean(el.innerText));});
var pageState=answers.length?'ok':(authVisible?'authentication_required':(questionTitle?'no_results':'source_unavailable'));
return {schema_version:1,platform:'zhihu',operation:'qa_detail',question_id:'$QuestionId',question_title:questionTitle,question_text:questionText.slice(0,10000),topics:topicNodes.map(function(x){return clean(x.innerText);}).filter(Boolean).slice(0,20),source_url:'$sourceUrl',query_scope:'anonymous-public-rendered-question-first-answers',page_state:pageState,partial:true,item_count:answers.length,answers:answers};
"@

$evaluation = Invoke-BrowserWingJson -CommandArguments @("exec", "eval", $extractJavascript)
if (-not $evaluation.success) {
    throw "BrowserWing failed to read the public Zhihu answer cards."
}
$result = $evaluation.data.result
if ($result.page_state -eq "authentication_required") {
    throw "authentication_required: Zhihu displayed a login gate before public answer cards were readable."
}
if ($result.page_state -eq "source_unavailable") {
    throw "Zhihu question page did not render a recognizable public question structure."
}
if ($result.page_state -eq "no_results") {
    throw "Zhihu question rendered without readable public answers."
}

$resolvedOutput = if ([IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $root $OutputPath }
$parent = Split-Path -Parent $resolvedOutput
if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent | Out-Null
}
$result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $resolvedOutput -Encoding utf8
Write-Output "Zhihu public question artifact written."
