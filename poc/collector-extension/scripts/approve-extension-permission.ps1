param(
  [Parameter(Mandatory = $true)][string]$ExpectedExtensionName,
  [Parameter(Mandatory = $true)][string]$ExpectedScopeOne,
  [Parameter(Mandatory = $true)][string]$ExpectedScopeTwo,
  [ValidateRange(1, 30)][int]$TimeoutSeconds = 15,
  [switch]$AllowAbsence
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CollectorNativePermissionInput {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
}
'@

$allowChinese = ([string][char]0x5141) + ([string][char]0x8BB8)
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$root = [System.Windows.Automation.AutomationElement]::RootElement
# The dialog contains a text child with the same label as its actionable
# button.  Restrict the match to a UIA Button so `InvokePattern` is requested
# from the actual control rather than a label that cannot be invoked.
$allowNameCondition = New-Object System.Windows.Automation.OrCondition(
  (New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty,
    $allowChinese
  )),
  (New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty,
    'Allow'
  ))
)
$buttonCondition = New-Object System.Windows.Automation.AndCondition(
  $allowNameCondition,
  (New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button
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
    $allow = $matches[0]
    $invoked = $false
    try {
      $invoke = $allow.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      $invoke.Invoke()
      $invoked = $true
    } catch {
      # Chrome occasionally exposes this native permission control through
      # MSAA rather than UIA InvokePattern. It remains the exact, scope-checked
      # button above; only the activation pattern differs.
      try {
        $legacy = $allow.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
        $legacy.DoDefaultAction()
        $invoked = $true
      } catch {
        # Last resort: trusted Windows mouse input at the live UIA button's
        # current centre. This is not a coordinate guessed from a screenshot;
        # the unique dialog and exact scope were validated immediately above.
        # A human may have approved the native dialog between UIA discovery
        # and this fallback.  Treat that stale element as a completed native
        # interaction and let the caller verify the real Chrome permission
        # state, rather than failing and causing its test cleanup to close the
        # temporary browser immediately after a valid manual approval.
        try {
          $bounds = $allow.Current.BoundingRectangle
        } catch {
          [pscustomobject]@{
            ok = $true
            extension = $ExpectedExtensionName
            exactScopeConfirmed = $true
            allowInvoked = $false
            dialogClosedBeforeAutomation = $true
          } | ConvertTo-Json -Compress
          exit 0
        }
        if ($bounds.Width -le 1 -or $bounds.Height -le 1) {
          [pscustomobject]@{
            ok = $true
            extension = $ExpectedExtensionName
            exactScopeConfirmed = $true
            allowInvoked = $false
            dialogClosedBeforeAutomation = $true
          } | ConvertTo-Json -Compress
          exit 0
        }
        $x = [int][Math]::Round($bounds.X + ($bounds.Width / 2))
        $y = [int][Math]::Round($bounds.Y + ($bounds.Height / 2))
        if (-not [CollectorNativePermissionInput]::SetCursorPos($x, $y)) { throw 'extension_permission_allow_pointer_move_failed' }
        [CollectorNativePermissionInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
        [CollectorNativePermissionInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
        $invoked = $true
      }
    }
    if (-not $invoked) { throw 'extension_permission_allow_not_invokable' }
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

if ($AllowAbsence) {
  [pscustomobject]@{
    ok = $true
    extension = $ExpectedExtensionName
    exactScopeConfirmed = $false
    allowInvoked = $false
    dialogObserved = $false
  } | ConvertTo-Json -Compress
  exit 0
}

throw 'extension_permission_dialog_scope_not_confirmed'
