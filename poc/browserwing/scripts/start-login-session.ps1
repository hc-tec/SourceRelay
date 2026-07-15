param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("xiaohongshu", "zhihu", "weibo")]
    [string]$Platform
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$binary = Join-Path $root "node_modules/browserwing/bin/browserwing.exe"

& (Join-Path $PSScriptRoot "start.ps1")

$urls = @{
    xiaohongshu = "https://www.xiaohongshu.com/explore"
    zhihu = "https://www.zhihu.com/hot"
    weibo = "https://s.weibo.com/weibo"
}

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $binary browser stop default 2>$null | Out-Null
$ErrorActionPreference = $previousErrorActionPreference

Start-Sleep -Seconds 1
& $binary browser start default | Out-Null
& $binary exec navigate $urls[$Platform] | Out-Null

Write-Output "Opened the isolated BrowserWing Chrome profile for $Platform."
Write-Output "Complete login manually in the visible Chrome window."
Write-Output "Do not paste credentials, cookies, QR codes, or tokens into the terminal or chat."
Write-Output "Leave the window open until the login state is confirmed."
