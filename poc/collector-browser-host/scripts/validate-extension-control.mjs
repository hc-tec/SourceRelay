import { writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserHostClient } from '../dist/client.js';
import { approveExactExtensionPermission } from '../../collector-extension/scripts/native-permission-harness.mjs';
import {
  browserHostEndpointPath,
  validationProfileId
} from './validation-browser-config.mjs';

const origin = loopbackOrigin(process.env.COLLECTOR_SERVICE_ORIGIN ?? 'http://127.0.0.1:43127');
const extensionSourceDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'collector-extension');
let client = null;

try {
  const pairing = await createPairing(origin);
  client = await BrowserHostClient.connect(browserHostEndpointPath, 'validation-extension-control');
  const snapshot = await client.command({ type: 'get_snapshot' });
  const profile = Array.isArray(snapshot.profiles)
    ? snapshot.profiles.find((candidate) => candidate?.profileId === validationProfileId)
    : null;
  if (!profile?.running) throw new Error('validation_extension_control_profile_not_running');

  // This is a programmatic exact-scope native permission approval.  It does
  // not use a human click and reports a benign absence when permission was
  // already granted in the persistent validation profile.
  const approval = approveExactExtensionPermission(
    extensionSourceDirectory,
    '127.0.0.1',
    '127.0.0.1',
    8,
    { allowAbsence: true }
  );
  const result = await client.command({
    type: 'run_validation_extension_control',
    request: {
      schemaVersion: 1,
      profileId: validationProfileId,
      loopbackOrigin: origin,
      identityFingerprint: pairing.identityFingerprint,
      pairingSessionId: pairing.pairingSessionId,
      pairingCode: pairing.pairingCode,
      selection: 'bilibili_discussion_current_active_tab'
    }
  }, { timeoutMs: 35_000 });
  const permission = await approval;
  if (!isControlResult(result)) throw new Error('validation_extension_control_result_invalid');
  writeJson({
    ok: true,
    profileId: result.profileId,
    pairingState: result.connectionState,
    discussionSelection: result.discussionSelection,
    controlTargetDisposed: result.controlTargetDisposed,
    permission: permission?.allowInvoked === true ? 'approved_once' : 'already_granted_or_not_requested'
  });
} catch (error) {
  writeJson({ ok: false, error: safeErrorCode(error) });
  process.exitCode = 1;
} finally {
  client?.close();
}

async function createPairing(loopbackOrigin) {
  const response = await fetch(`${loopbackOrigin}/v1/browser-bindings/pairing-sessions`, {
    method: 'POST',
    headers: {
      origin: loopbackOrigin,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json'
    },
    body: '{}',
    signal: AbortSignal.timeout(8_000)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.pairing || !isPairing(payload.pairing)) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'validation_extension_control_pairing_session_failed');
  }
  return payload.pairing;
}

function isPairing(value) {
  return value && typeof value === 'object' &&
    typeof value.identityFingerprint === 'string' && /^[a-f0-9]{64}$/.test(value.identityFingerprint) &&
    typeof value.pairingSessionId === 'string' && /^[0-9a-f-]{36}$/i.test(value.pairingSessionId) &&
    typeof value.pairingCode === 'string' && /^\d{8}$/.test(value.pairingCode);
}

function isControlResult(value) {
  return value && typeof value === 'object' && value.schemaVersion === 1 &&
    value.profileId === validationProfileId && value.connectionState === 'online' &&
    value.discussionSelection === 'available' && value.controlTargetDisposed === true &&
    typeof value.browserBindingId === 'string' && /^[0-9a-f-]{36}$/i.test(value.browserBindingId);
}

function loopbackOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('validation_extension_control_origin_invalid');
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('validation_extension_control_origin_invalid');
  }
  return url.origin;
}

function safeErrorCode(error) {
  const value = error instanceof Error ? error.message : '';
  return /^[a-z0-9_.:-]{1,160}$/i.test(value) ? value : 'validation_extension_control_failed';
}

function writeJson(value) {
  writeSync(process.stdout.fd, `${JSON.stringify(value)}\n`, undefined, 'utf8');
}
