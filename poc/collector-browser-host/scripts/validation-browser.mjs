import { writeSync } from 'node:fs';
import {
  rebuildValidationBrowser,
  startValidationBrowser,
  stopValidationBrowser,
  validationBrowserPaths,
  validationBrowserStatus
} from './validation-browser-runtime.mjs';

const command = process.argv[2] ?? 'start';

try {
  const result = await run(command);
  // On this Windows Chromium path, creating the visible persistent context
  // can make the parent process's stdout pipe unavailable while stderr stays
  // healthy. Keep machine-readable `status` on stdout, but make start/rebuild
  // results reliably visible to developers and agents.
  writeJson(command === 'start' || command === 'rebuild' ? process.stderr.fd : process.stdout.fd, result);
} catch (error) {
  writeJson(process.stderr.fd, {
    ok: false,
    command,
    error: error instanceof Error ? error.message : 'validation_browser_unknown_error'
  });
  process.exitCode = 1;
}

async function run(value) {
  switch (value) {
    case 'start': return await startValidationBrowser();
    case 'rebuild': return await rebuildValidationBrowser();
    case 'status': return await validationBrowserStatus();
    case 'stop': return await stopValidationBrowser();
    case 'paths': return { ok: true, paths: validationBrowserPaths() };
    default: throw new Error('validation_browser_command_invalid_expected_start_rebuild_status_stop_or_paths');
  }
}

function writeJson(fileDescriptor, value) {
  writeSync(fileDescriptor, `${JSON.stringify(value, null, 2)}\n`, undefined, 'utf8');
}
