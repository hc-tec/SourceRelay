import { writeSync } from 'node:fs';

// Keep this invocation in the dedicated validation runtime, not the generic
// Bilibili fixture and never a user-owned everyday browser.
process.env.COLLECTOR_VALIDATION_BROWSER_INSTANCE = 'xiaohongshu-validation';
process.env.COLLECTOR_VALIDATION_PROFILE_ID = 'xiaohongshu_validation';
process.env.COLLECTOR_VALIDATION_EXTENSION_CONTROL = 'disabled';
process.env.COLLECTOR_XIAOHONGSHU_VALIDATION_EXTENSION_CONTROL = 'enabled';

const { BrowserHostClient } = await import('../dist/client.js');
const { browserHostEndpointPath, validationProfileId } = await import('./validation-browser-config.mjs');

let client = null;
try {
  client = await BrowserHostClient.connect(browserHostEndpointPath, 'xiaohongshu-validation-extension-control');
  const snapshot = await client.command({ type: 'get_snapshot' });
  const profile = Array.isArray(snapshot.profiles)
    ? snapshot.profiles.find((candidate) => candidate?.profileId === validationProfileId)
    : null;
  if (!profile?.running) throw new Error('xiaohongshu_validation_extension_control_profile_not_running');
  if (profile.leasedPages !== 0) {
    throw new Error('xiaohongshu_validation_extension_control_active_lease_present');
  }

  const result = await client.command({
    type: 'run_xiaohongshu_validation_extension_control',
    request: {
      schemaVersion: 1,
      profileId: validationProfileId
    }
  }, { timeoutMs: 100_000 });
  if (!isResult(result)) throw new Error('xiaohongshu_validation_extension_control_result_invalid');
  writeJson({
    ok: true,
    profileId: result.profileId,
    selectionState: result.selectionState,
    controlTargetDisposed: result.controlTargetDisposed
  });
} catch (error) {
  writeJson({ ok: false, error: safeErrorCode(error) });
  process.exitCode = 1;
} finally {
  client?.close();
}

function isResult(value) {
  return value && typeof value === 'object' && value.schemaVersion === 1 &&
    value.profileId === validationProfileId && value.selectionState === 'armed_next_document' &&
    value.controlTargetDisposed === true;
}

function safeErrorCode(error) {
  const value = error instanceof Error ? error.message : '';
  return /^[a-z0-9_.:-]{1,160}$/i.test(value) ? value : 'xiaohongshu_validation_extension_control_failed';
}

function writeJson(value) {
  writeSync(process.stdout.fd, `${JSON.stringify(value)}\n`, undefined, 'utf8');
}
