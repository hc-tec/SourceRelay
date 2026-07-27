import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export function approveExactExtensionPermission(
  extensionRoot,
  expectedScopeOne,
  expectedScopeTwo = expectedScopeOne,
  timeoutSeconds = 15,
  options = {}
) {
  if (process.platform !== 'win32') {
    throw new Error('native_permission_automation_requires_windows');
  }
  const scriptPath = resolve(extensionRoot, 'scripts', 'approve-extension-permission.ps1');
  return new Promise((resolveApproval, rejectApproval) => {
    const args = [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-ExpectedExtensionName',
      'Personal Intelligence Collector',
      '-ExpectedScopeOne',
      expectedScopeOne,
      '-ExpectedScopeTwo',
      expectedScopeTwo,
      '-TimeoutSeconds',
      String(timeoutSeconds)
    ];
    if (options.allowAbsence === true) args.push('-AllowAbsence');
    const child = spawn('powershell.exe', args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', rejectApproval);
    child.on('exit', (code) => {
      if (code !== 0) {
        rejectApproval(new Error(`native_permission_approval_failed:${stderr.trim() || stdout.trim() || code}`));
        return;
      }
      try {
        resolveApproval(JSON.parse(stdout.trim()));
      } catch {
        rejectApproval(new Error('native_permission_approval_output_invalid'));
      }
    });
  });
}
