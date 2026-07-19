param(
  [Parameter(Mandatory = $true)][string]$ExpectedExtensionName,
  [Parameter(Mandatory = $true)][string]$ExpectedScopeOne,
  [Parameter(Mandatory = $true)][string]$ExpectedScopeTwo,
  [ValidateRange(1, 30)][int]$TimeoutSeconds = 15
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$allowChinese = ([string][char]0x5141) + ([string][char]0x8BB8)
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$root = [System.Windows.Automation.AutomationElement]::RootElement
$buttonCondition = New-Object System.Windows.Automation.OrCondition(
  (New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty,
    $allowChinese
  )),
  (New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty,
    'Allow'
  ))
)

while ((Get-Date) -lt $deadline) {
  $matches = @()
  $windows = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  for ($windowIndex = 0; $windowIndex -lt $windows.Count; $windowIndex += 1) {
    $window = $windows.Item($windowIndex)
    try {
      $elements = $window.FindAll(
        [System.Windows.Automation.TreeScope]::Subtree,
        [System.Windows.Automation.Condition]::TrueCondition
      )
      $names = @()
      for ($elementIndex = 0; $elementIndex -lt $elements.Count; $elementIndex += 1) {
        $name = $elements.Item($elementIndex).Current.Name
        if ($name) { $names += $name }
      }
      $joined = $names -join ' | '
      if (
        $joined.Contains($ExpectedExtensionName) -and
        $joined.Contains($ExpectedScopeOne) -and
        $joined.Contains($ExpectedScopeTwo)
      ) {
        $allow = $window.FindFirst([System.Windows.Automation.TreeScope]::Subtree, $buttonCondition)
        if ($allow) { $matches += $allow }
      }
    } catch {
      # A browser window may disappear while the automation tree is read.
    }
  }
  if ($matches.Count -gt 1) { throw 'extension_permission_dialog_not_unique' }
  if ($matches.Count -eq 1) {
    $invoke = $matches[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $invoke.Invoke()
    [pscustomobject]@{
      ok = $true
      extension = $ExpectedExtensionName
      exactScopeConfirmed = $true
      allowInvoked = $true
    } | ConvertTo-Json -Compress
    exit 0
  }
  Start-Sleep -Milliseconds 100
}

throw 'extension_permission_dialog_scope_not_confirmed'

