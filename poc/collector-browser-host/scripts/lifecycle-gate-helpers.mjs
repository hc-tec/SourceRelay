import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';

export function acquireRequest(profileId, taskId, runId, pageRole, targetUrl, overrides = {}) {
  return {
    profileId,
    taskId,
    runId,
    platform: 'local_validation',
    pageRole,
    targetUrl,
    leaseDurationMs: 60_000,
    maximumManagedPages: 3,
    ...overrides
  };
}

export function navigateRequest(profileId, acquired, url, actionId) {
  return {
    profileId,
    pageAlias: acquired.page.pageAlias,
    pageLeaseId: acquired.lease.pageLeaseId,
    actionId,
    url,
    waitUntil: 'domcontentloaded',
    timeoutMs: 10_000
  };
}

export function releaseRequest(profileId, acquired, disposition) {
  return {
    profileId,
    pageAlias: acquired.page.pageAlias,
    pageLeaseId: acquired.lease.pageLeaseId,
    disposition
  };
}

export function asSnapshot(value) {
  assert.equal(value?.schemaVersion, 1);
  assert.ok(Array.isArray(value.profiles));
  return value;
}

export function asAcquire(value) {
  assert.equal(value?.lease?.schemaVersion, 1);
  assert.equal(typeof value?.page?.pageAlias, 'string');
  return value;
}

export function asReclaimPlan(value) {
  assert.equal(value?.schemaVersion, 1);
  assert.ok(Array.isArray(value.candidates));
  return value;
}

export function asReclaimResult(value) {
  assert.ok(Array.isArray(value?.items));
  return value;
}

export function onlyProfile(snapshot) {
  assert.equal(snapshot.profiles.length, 1);
  return snapshot.profiles[0];
}

export async function expectHostError(callback, code) {
  try {
    await callback();
  } catch (error) {
    assert.equal(error?.record?.code, code);
    return;
  }
  assert.fail(`Expected Browser Host error ${code}`);
}

export async function waitForExit(processId, endpointPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const endpointExists = await stat(endpointPath).then(() => true, () => false);
    if (!endpointExists && !(await processAlive(processId))) return;
    await delay(100);
  }
  throw new Error('browser_host_shutdown_timeout');
}

export async function processAlive(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
