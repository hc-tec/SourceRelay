/**
 * A dedicated, persistent validation browser for Xiaohongshu public-content
 * reconnaissance. It deliberately shares no state directory, endpoint or
 * Chromium user-data directory with the generic validation fixture, and it
 * disables test-only extension-control commands.
 *
 * Keep this as a process boundary rather than importing the generic CLI
 * in-process.  The Browser Host's fixed validation-control allow-list is
 * calculated while the generic CLI module graph loads.  Supplying its
 * configuration in the child environment guarantees that the dedicated
 * Xiaohongshu control flag is present before that graph is evaluated.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [
  resolve(scriptDirectory, 'validation-browser.mjs'),
  ...process.argv.slice(2)
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    COLLECTOR_VALIDATION_BROWSER_INSTANCE: 'xiaohongshu-validation',
    COLLECTOR_VALIDATION_PROFILE_ID: 'xiaohongshu_validation',
    COLLECTOR_VALIDATION_EXTENSION_CONTROL: 'disabled',
    COLLECTOR_XIAOHONGSHU_VALIDATION_EXTENSION_CONTROL: 'enabled'
  },
  stdio: 'inherit',
  windowsHide: true
});

const exitCode = await new Promise((resolvePromise, reject) => {
  child.once('error', reject);
  child.once('exit', (code) => resolvePromise(code ?? 1));
});
if (exitCode !== 0) process.exitCode = exitCode;
