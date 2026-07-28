/**
 * A dedicated, persistent validation browser for Xiaohongshu public-content
 * reconnaissance. It deliberately shares no state directory, endpoint or
 * Chromium user-data directory with the generic validation fixture. Its
 * validation control surface remains fixed-contract only: callers cannot
 * supply arbitrary URLs, selectors, scripts, tabs or browser commands.
 *
 * Keep this as a process boundary rather than importing the generic CLI
 * in-process so the dedicated Profile keeps its own runtime and lifecycle.
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
    COLLECTOR_VALIDATION_PROFILE_ID: 'xiaohongshu_validation'
  },
  stdio: 'inherit',
  windowsHide: true
});

const exitCode = await new Promise((resolvePromise, reject) => {
  child.once('error', reject);
  child.once('exit', (code) => resolvePromise(code ?? 1));
});
if (exitCode !== 0) process.exitCode = exitCode;
