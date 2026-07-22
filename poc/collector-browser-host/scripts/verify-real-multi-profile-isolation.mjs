import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { BrowserHostClient, launchBrowserHost } from '../dist/client.js';
import {
  acquireRequest,
  asAcquire,
  asSnapshot,
  expectHostError,
  processAlive,
  terminateTestScopedProcesses,
  waitForExit,
  waitForProcessExit,
  waitForTestScopedProcessesToExit
} from './lifecycle-gate-helpers.mjs';

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(root, '..');
const runtimeParent = resolve(root, 'runtime');
const runtimeRoot = resolve(runtimeParent, `multi-profile-isolation-${Date.now()}`);
const stateDirectory = resolve(runtimeRoot, 'host-state');
const profileRoot = resolve(runtimeRoot, 'profiles');
const endpointPath = resolve(stateDirectory, 'endpoint.json');
const extensionDirectory = resolve(workspaceRoot, 'collector-extension', 'dist');
const mainModulePath = resolve(root, 'dist', 'main.js');
const alphaProfileId = 'multi-profile-alpha';
const betaProfileId = 'multi-profile-beta';

if (relative(runtimeParent, runtimeRoot).startsWith('..')) {
  throw new Error('multi_profile_runtime_path_rejected');
}

await mkdir(stateDirectory, { recursive: true });
await mkdir(profileRoot, { recursive: true });

let endpoint = null;
let client = null;
let cleanupClient = null;
let report = null;

try {
  const extensionManifest = JSON.parse(await readFile(resolve(extensionDirectory, 'manifest.json'), 'utf8'));
  assert.equal(extensionManifest.version, '0.7.6');
  const extensionRuntime = {
    version: extensionManifest.version,
    controlSurfaceRevision: 10,
    runtimeBootstrapKey: 'collector.runtime-bootstrap.v1'
  };

  endpoint = await launchBrowserHost({
    mainModulePath,
    stateDirectory,
    profileRoot,
    extensionDirectory,
    endpointPath,
    timeoutMs: 30_000
  });
  client = await BrowserHostClient.connect(endpointPath, 'multi-profile-isolation-gateway');

  await launchProfile(client, alphaProfileId, extensionRuntime);
  const afterBothLaunched = await launchProfile(client, betaProfileId, extensionRuntime);
  assert.equal(afterBothLaunched.hostProcessId, endpoint.processId);
  assert.equal(afterBothLaunched.browserSessionId, null, 'top-level session must be ambiguous with two live Profiles');
  assert.equal(afterBothLaunched.profiles.length, 2);

  const alpha = profileById(afterBothLaunched, alphaProfileId);
  const beta = profileById(afterBothLaunched, betaProfileId);
  assert.equal(alpha.running, true);
  assert.equal(beta.running, true);
  assert.ok(alpha.browserProcessId);
  assert.ok(beta.browserProcessId);
  assert.notEqual(alpha.browserProcessId, beta.browserProcessId);
  assert.notEqual(alpha.browserSessionId, beta.browserSessionId);
  for (const profile of [alpha, beta]) {
    assert.equal(profile.livePlatformRequests, 0);
    assert.equal(profile.extensionRuntime?.finalRuntimeVersion, extensionManifest.version);
    assert.equal(profile.extensionRuntime?.nativeBridgeConnected, true);
    assert.equal(profile.extensionPages <= 1, true);
  }

  const alphaNativeHostName = nativeHostNameFor(endpointPath, alphaProfileId);
  const betaNativeHostName = nativeHostNameFor(endpointPath, betaProfileId);
  assert.notEqual(alphaNativeHostName, betaNativeHostName);
  assert.equal((await readdir(resolve(stateDirectory, 'native-hosts'))).length, 2);
  await assertNativeRegistration(alphaNativeHostName, true);
  await assertNativeRegistration(betaNativeHostName, true);

  // These are real blank Chromium tabs created by the Host solely to exercise
  // its page-lease namespace. They are not a fake platform page or a claim
  // about platform interaction semantics.
  const alphaAcquire = asAcquire(await client.command({
    type: 'acquire_page',
    request: acquireRequest(alphaProfileId, 'multi-alpha-task', 'multi-alpha-run', 'inventory', null, {
      maximumManagedPages: 1
    })
  }));
  const betaAcquire = asAcquire(await client.command({
    type: 'acquire_page',
    request: acquireRequest(betaProfileId, 'multi-beta-task', 'multi-beta-run', 'inventory', null, {
      maximumManagedPages: 1
    })
  }));
  assert.equal(alphaAcquire.selection, 'created_new_page');
  assert.equal(betaAcquire.selection, 'created_new_page');
  assert.equal(alphaAcquire.page.extensionTabBound, true);
  assert.equal(betaAcquire.page.extensionTabBound, true);
  assert.equal(alphaAcquire.page.pageAlias, betaAcquire.page.pageAlias, 'page aliases are Profile-local');
  assert.notEqual(alphaAcquire.lease.pageLeaseId, betaAcquire.lease.pageLeaseId);

  await expectHostError(
    () => client.command({
      type: 'release_page',
      request: {
        profileId: betaProfileId,
        pageAlias: alphaAcquire.page.pageAlias,
        pageLeaseId: alphaAcquire.lease.pageLeaseId,
        disposition: 'idle_reusable'
      }
    }),
    'page_lease_mismatch'
  );

  await client.command({
    type: 'release_page',
    request: {
      profileId: alphaProfileId,
      pageAlias: alphaAcquire.page.pageAlias,
      pageLeaseId: alphaAcquire.lease.pageLeaseId,
      disposition: 'idle_reusable'
    }
  });
  await client.command({
    type: 'release_page',
    request: {
      profileId: betaProfileId,
      pageAlias: betaAcquire.page.pageAlias,
      pageLeaseId: betaAcquire.lease.pageLeaseId,
      disposition: 'idle_reusable'
    }
  });

  await client.command({ type: 'close_profile', profileId: alphaProfileId });
  await waitForProcessExit(alpha.browserProcessId, 10_000);
  assert.equal(await processAlive(beta.browserProcessId), true);

  const afterAlphaClose = asSnapshot(await client.command({ type: 'get_snapshot' }));
  const closedAlpha = profileById(afterAlphaClose, alphaProfileId);
  const survivingBeta = profileById(afterAlphaClose, betaProfileId);
  assert.equal(closedAlpha.running, false);
  assert.equal(closedAlpha.browserProcessId, null);
  assert.equal(closedAlpha.extensionRuntime?.nativeBridgeConnected, false);
  assert.equal(survivingBeta.running, true);
  assert.equal(survivingBeta.browserProcessId, beta.browserProcessId);
  assert.equal(survivingBeta.extensionRuntime?.nativeBridgeConnected, true);
  assert.equal(survivingBeta.livePlatformRequests, 0);
  assert.equal((await readdir(resolve(stateDirectory, 'native-hosts'))).length, 1);
  await assertNativeRegistration(alphaNativeHostName, false);
  await assertNativeRegistration(betaNativeHostName, true);

  await client.command({ type: 'close_profile', profileId: betaProfileId });
  await waitForProcessExit(beta.browserProcessId, 10_000);
  assert.equal((await readdir(resolve(stateDirectory, 'native-hosts')).catch(() => [])).length, 0);
  await assertNativeRegistration(betaNativeHostName, false);

  const shutdown = await client.command({ type: 'shutdown_host' });
  assert.equal(shutdown.ok, true);
  client.close();
  client = null;
  await waitForExit(endpoint.processId, endpointPath, 15_000);
  await waitForTestScopedProcessesToExit(runtimeRoot, 10_000);

  report = {
    ok: true,
    gate: 'browser-host-real-multi-profile-isolation',
    livePlatformRequests: 0,
    browserMode: 'headless_test_scoped',
    twoProductionMv3ProfilesStarted: true,
    browserSessionsAndProcessesIsolated: true,
    nativeMessagingRegistrationsIsolated: true,
    profileLocalPageAliasesRejectedForeignLease: true,
    closingOneProfileDidNotCloseTheOther: true,
    nativeMessagingRegistrationsCleanedPerProfile: true,
    testScopedProcessResidue: 0,
    testScopedExplicitCleanup: true
  };
} finally {
  client?.close();
  if (endpoint && await processAlive(endpoint.processId)) {
    try {
      cleanupClient = await BrowserHostClient.connect(endpointPath, 'multi-profile-isolation-cleanup');
      for (const profileId of [alphaProfileId, betaProfileId]) {
        await cleanupClient.command({ type: 'close_profile', profileId }).catch(() => undefined);
      }
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

assert.ok(report, 'multi-profile isolation report must be produced');
console.log(JSON.stringify(report, null, 2));

async function launchProfile(hostClient, profileId, extensionRuntime) {
  return asSnapshot(await hostClient.command({
    type: 'launch_profile',
    request: {
      profileId,
      maximumManagedPages: 1,
      headless: true,
      offlineOnly: true,
      extensionRuntime
    }
  }));
}

function profileById(snapshot, profileId) {
  const profile = snapshot.profiles.find((candidate) => candidate.profileId === profileId);
  assert.ok(profile, `missing Profile ${profileId}`);
  return profile;
}

function nativeHostNameFor(path, profileId) {
  const identity = createHash('sha256')
    .update(`${resolve(path)}\n${profileId}`)
    .digest('hex')
    .slice(0, 32);
  return `com.intelligence.collector.p_${identity}`;
}

async function assertNativeRegistration(nativeHostName, expected) {
  if (process.platform !== 'win32') return;
  for (const rootKey of [
    'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
    'HKCU\\Software\\Chromium\\NativeMessagingHosts'
  ]) {
    assert.equal(await registryKeyExists(`${rootKey}\\${nativeHostName}`), expected);
  }
}

async function registryKeyExists(key) {
  return await execFileAsync('reg.exe', ['QUERY', key], { windowsHide: true })
    .then(() => true, () => false);
}
