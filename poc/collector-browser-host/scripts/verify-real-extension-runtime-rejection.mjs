import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { BrowserHostClient, launchBrowserHost } from '../dist/client.js';
import {
  asSnapshot,
  processAlive,
  terminateTestScopedProcesses,
  waitForExit,
  waitForTestScopedProcessesToExit
} from './lifecycle-gate-helpers.mjs';

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(root, '..');
const runtimeParent = resolve(root, 'runtime');
const runtimeRoot = resolve(runtimeParent, `extension-runtime-rejection-${Date.now()}`);
const stateDirectory = resolve(runtimeRoot, 'host-state');
const profileRoot = resolve(runtimeRoot, 'profiles');
const endpointPath = resolve(stateDirectory, 'endpoint.json');
const extensionDirectory = resolve(workspaceRoot, 'collector-extension', 'dist');
const mainModulePath = resolve(root, 'dist', 'main.js');
const profileId = 'extension-runtime-rejection';
const expectedVersion = '999.999.999';
const expectedControlSurfaceRevision = 13;

if (relative(runtimeParent, runtimeRoot).startsWith('..')) {
  throw new Error('extension_runtime_rejection_path_rejected');
}

await mkdir(stateDirectory, { recursive: true });
await mkdir(profileRoot, { recursive: true });

let endpoint = null;
let client = null;
let cleanupClient = null;
let report = null;

try {
  const extensionManifest = JSON.parse(await readFile(resolve(extensionDirectory, 'manifest.json'), 'utf8'));
  assert.equal(extensionManifest.version, '0.7.15');
  assert.notEqual(extensionManifest.version, expectedVersion);

  endpoint = await launchBrowserHost({
    mainModulePath,
    stateDirectory,
    profileRoot,
    extensionDirectory,
    endpointPath,
    timeoutMs: 30_000
  });
  client = await BrowserHostClient.connect(endpointPath, 'extension-runtime-rejection-gateway');

  const rejection = await captureHostError(
    () => client.command({
      type: 'launch_profile',
      request: {
        profileId,
        maximumManagedPages: 1,
        // This deliberately disagrees with the production MV3 marker. The
        // only Chromium contexts that may run are the offline headless probes
        // inside prepareExtensionRuntime; a managed Profile must never start.
        headless: true,
        offlineOnly: true,
        extensionRuntime: {
          version: expectedVersion,
          controlSurfaceRevision: expectedControlSurfaceRevision,
          runtimeBootstrapKey: 'collector.runtime-bootstrap.v1'
        }
      }
    }, { timeoutMs: 45_000 }),
    'collector_extension_worker_version_mismatch'
  );

  assert.equal(rejection.profileSafetyDisposition, 'host_blocked');
  assert.equal(rejection.platformActionAttempted, false);
  assert.equal(rejection.pageDisposition, 'unchanged');
  assert.equal(rejection.safeDetails.expectedVersion, expectedVersion);
  assert.equal(rejection.safeDetails.expectedControlSurfaceRevision, expectedControlSurfaceRevision);
  assert.equal(rejection.safeDetails.observedManifestVersion, extensionManifest.version);
  assert.equal(rejection.safeDetails.observedRuntimeVersion, extensionManifest.version);
  assert.equal(rejection.safeDetails.observedControlSurfaceRevision, expectedControlSurfaceRevision);

  const afterRejection = asSnapshot(await client.command({ type: 'get_snapshot' }));
  assert.equal(afterRejection.hostProcessId, endpoint.processId);
  assert.equal(afterRejection.profiles.length, 0, 'failed probe must not register a managed Profile');

  const nativeHostName = nativeHostNameFor(endpointPath, profileId);
  assert.equal((await readdir(resolve(stateDirectory, 'native-hosts')).catch(() => [])).length, 0);
  if (process.platform === 'win32') {
    for (const rootKey of [
      'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
      'HKCU\\Software\\Chromium\\NativeMessagingHosts'
    ]) {
      assert.equal(await registryKeyExists(`${rootKey}\\${nativeHostName}`), false);
    }
  }

  const journalText = await readJournal(stateDirectory);
  assert.equal(journalText.includes('"eventType":"profile_launched"'), false);

  const shutdown = await client.command({ type: 'shutdown_host' });
  assert.equal(shutdown.ok, true);
  client.close();
  client = null;
  await waitForExit(endpoint.processId, endpointPath, 15_000);
  await waitForTestScopedProcessesToExit(runtimeRoot, 10_000);

  report = {
    ok: true,
    gate: 'browser-host-real-extension-runtime-rejection',
    livePlatformRequests: 0,
    browserMode: 'headless_test_scoped',
    actualProductionWorkerObserved: true,
    workerVersionMismatchRejected: true,
    versionMismatchRejectedBeforeProfileRegistration: true,
    visibleContextNotLaunched: true,
    nativeMessagingNeverInstalled: true,
    journalHasNoProfileLaunched: true,
    testScopedProcessResidue: 0,
    testScopedExplicitCleanup: true
  };
} finally {
  client?.close();
  if (endpoint && await processAlive(endpoint.processId)) {
    try {
      cleanupClient = await BrowserHostClient.connect(endpointPath, 'extension-runtime-rejection-cleanup');
      await cleanupClient.command({ type: 'close_profile', profileId }).catch(() => undefined);
      await cleanupClient.command({ type: 'shutdown_host' }).catch(() => undefined);
      cleanupClient.close();
    } catch {
      process.kill(endpoint.processId, 'SIGTERM');
    }
  }
  cleanupClient?.close();
  if (endpoint && await processAlive(endpoint.processId)) {
    try {
      await waitForExit(endpoint.processId, endpointPath, 5_000);
    } catch {
      process.kill(endpoint.processId, 'SIGTERM');
      await waitForExit(endpoint.processId, endpointPath, 5_000).catch(() => undefined);
    }
  }
  await terminateTestScopedProcesses(runtimeRoot);
  await waitForTestScopedProcessesToExit(runtimeRoot, 5_000).catch(() => undefined);
  await rm(runtimeRoot, { recursive: true, force: true });
}

assert.ok(report, 'extension runtime rejection report must be produced');
console.log(JSON.stringify(report, null, 2));

async function captureHostError(callback, code) {
  try {
    await callback();
  } catch (error) {
    assert.equal(error?.record?.code, code);
    return error.record;
  }
  assert.fail(`Expected Browser Host error ${code}`);
}

function nativeHostNameFor(path, profile) {
  const identity = createHash('sha256')
    .update(`${resolve(path)}\n${profile}`)
    .digest('hex')
    .slice(0, 32);
  return `com.intelligence.collector.p_${identity}`;
}

async function readJournal(directory) {
  const journalDirectory = resolve(directory, 'journal');
  const names = await readdir(journalDirectory).catch(() => []);
  return (await Promise.all(names.map((name) => readFile(resolve(journalDirectory, name), 'utf8')))).join('\n');
}

async function registryKeyExists(key) {
  return await execFileAsync('reg.exe', ['QUERY', key], { windowsHide: true })
    .then(() => true, () => false);
}
