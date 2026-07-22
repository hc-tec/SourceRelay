import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  terminateTestScopedProcesses,
  waitForTestScopedProcessesToExit
} from '../../collector-browser-host/scripts/lifecycle-gate-helpers.mjs';

const gatewayRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(gatewayRoot, '..');
const runtimeParent = resolve(gatewayRoot, 'runtime');
const runtimeRoot = resolve(runtimeParent, `gateway-browser-host-${Date.now()}`);
if (!runtimeRoot.startsWith(`${runtimeParent}\\`) && !runtimeRoot.startsWith(`${runtimeParent}/`)) {
  throw new Error('gateway_host_gate_runtime_path_rejected');
}

const gatewayMain = resolve(gatewayRoot, 'dist', 'server.js');
const browserHostMain = resolve(workspaceRoot, 'collector-browser-host', 'dist', 'main.js');
const extensionDirectory = resolve(workspaceRoot, 'collector-extension', 'dist');
const port = await availablePort();
const origin = `http://127.0.0.1:${port}`;
const environment = {
  ...process.env,
  COLLECTOR_GATEWAY_PORT: String(port),
  COLLECTOR_GATEWAY_STATE_DIR: runtimeRoot,
  COLLECTOR_BROWSER_HOST_STATE_DIR: resolve(runtimeRoot, 'browser-host'),
  COLLECTOR_BROWSER_HOST_ENDPOINT: resolve(runtimeRoot, 'browser-host', 'endpoint.json'),
  COLLECTOR_BROWSER_HOST_MAIN: browserHostMain,
  COLLECTOR_EXTENSION_DIRECTORY: extensionDirectory,
  COLLECTOR_BROWSER_HEADLESS: 'true'
};

let gateway = null;
let hostPid = null;
const browserPids = [];
let crossSiteProfileCreationRejected = false;
try {
  await mkdir(runtimeRoot, { recursive: true });
  gateway = await startGateway(environment, origin);
  const crossSiteResponse = await fetch(`${origin}/v1/profiles`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://attacker.invalid',
      'sec-fetch-site': 'cross-site'
    },
    body: JSON.stringify({
      kind: 'collection',
      platform: 'bilibili',
      accountCategory: 'user_managed',
      accountLabel: 'must never be created'
    })
  });
  const crossSiteBody = await crossSiteResponse.json();
  assert.equal(crossSiteResponse.status, 403);
  assert.deepEqual(crossSiteBody, { ok: false, error: 'console_origin_rejected' });
  crossSiteProfileCreationRejected = true;

  const createdAlpha = await request(origin, '/v1/profiles', {
    method: 'POST',
    body: {
      kind: 'collection',
      platform: 'bilibili',
      accountCategory: 'user_managed',
      accountLabel: 'Gateway Host integration profile alpha'
    }
  });
  const createdBeta = await request(origin, '/v1/profiles', {
    method: 'POST',
    body: {
      kind: 'collection',
      platform: 'bilibili',
      accountCategory: 'user_managed',
      accountLabel: 'Gateway Host integration profile beta'
    }
  });
  const alphaProfileId = createdAlpha.profile?.profile?.profileId;
  const betaProfileId = createdBeta.profile?.profile?.profileId;
  assert.match(alphaProfileId, /^[0-9a-f-]{36}$/i);
  assert.match(betaProfileId, /^[0-9a-f-]{36}$/i);
  assert.notEqual(alphaProfileId, betaProfileId);

  const launchedAlpha = await request(origin, `/v1/profiles/${alphaProfileId}/browser/launch`, {
    method: 'POST',
    body: {}
  });
  const launchedBeta = await request(origin, `/v1/profiles/${betaProfileId}/browser/launch`, {
    method: 'POST',
    body: {}
  });
  const alphaFirst = launchedAlpha.profile;
  const betaFirst = launchedBeta.profile;
  assertLaunchedProfile(alphaFirst);
  assertLaunchedProfile(betaFirst);
  hostPid = alphaFirst.host?.hostProcessId ?? null;
  const alphaBrowserPid = alphaFirst.runtime?.browserProcessId ?? null;
  const betaBrowserPid = betaFirst.runtime?.browserProcessId ?? null;
  const alphaBrowserSessionId = alphaFirst.runtime?.browserSessionId;
  const betaBrowserSessionId = betaFirst.runtime?.browserSessionId;
  assert.ok(Number.isSafeInteger(hostPid));
  assert.ok(Number.isSafeInteger(alphaBrowserPid));
  assert.ok(Number.isSafeInteger(betaBrowserPid));
  assert.equal(betaFirst.host?.hostProcessId, hostPid);
  assert.notEqual(alphaBrowserPid, betaBrowserPid);
  assert.match(alphaBrowserSessionId, /^[0-9a-f-]{36}$/i);
  assert.match(betaBrowserSessionId, /^[0-9a-f-]{36}$/i);
  assert.notEqual(alphaBrowserSessionId, betaBrowserSessionId);
  browserPids.push(alphaBrowserPid, betaBrowserPid);

  await stopGateway(gateway);
  gateway = null;
  assert.equal(processIsAlive(hostPid), true, 'Gateway exit must not close Browser Host');
  for (const browserPid of browserPids) {
    assert.equal(processIsAlive(browserPid), true, 'Gateway exit must not close either Chromium Profile');
  }

  gateway = await startGateway(environment, origin);
  const reconnected = await request(origin, '/v1/profiles');
  const alphaSecond = profileById(reconnected.profiles, alphaProfileId);
  const betaSecond = profileById(reconnected.profiles, betaProfileId);
  assertReconnectedProfile(alphaSecond, hostPid, alphaBrowserPid, alphaBrowserSessionId);
  assertReconnectedProfile(betaSecond, hostPid, betaBrowserPid, betaBrowserSessionId);

  await request(origin, `/v1/profiles/${alphaProfileId}/browser/close`, { method: 'POST', body: {} });
  await waitUntil(() => !processIsAlive(alphaBrowserPid), 10_000, 'gateway_host_gate_alpha_browser_close_timeout');
  assert.equal(processIsAlive(betaBrowserPid), true, 'explicit close for alpha must not close beta');
  const afterAlphaClose = await request(origin, '/v1/profiles');
  const survivingBeta = profileById(afterAlphaClose.profiles, betaProfileId);
  assertReconnectedProfile(survivingBeta, hostPid, betaBrowserPid, betaBrowserSessionId);

  await request(origin, `/v1/profiles/${betaProfileId}/browser/close`, { method: 'POST', body: {} });
  await waitUntil(() => !processIsAlive(betaBrowserPid), 10_000, 'gateway_host_gate_beta_browser_close_timeout');
  await request(origin, '/v1/browser-host/exit', { method: 'POST', body: {} });
  await waitUntil(() => !processIsAlive(hostPid), 10_000, 'gateway_host_gate_host_exit_timeout');
  await waitForTestScopedProcessesToExit(runtimeRoot, 10_000);

  console.log(JSON.stringify({
    ok: true,
    gate: 'gateway-real-browser-host-lifecycle',
    livePlatformRequests: 0,
    browserMode: 'headless_test_scoped',
    gatewayExitDidNotCloseHost: true,
    gatewayExitDidNotCloseBrowser: true,
    reconnectPreservedHostPid: true,
    reconnectPreservedBrowserPid: true,
    reconnectPreservedBrowserSession: true,
    twoProfilesSurvivedGatewayRestart: true,
    profilesRemainIsolatedThroughGatewayApi: true,
    extensionNativeBridgeConnected: true,
    crossSiteProfileCreationRejected,
    profileClosedOnlyByExplicitRequest: true,
    hostExitedOnlyByExplicitRequest: true,
    testScopedProcessResidue: 0,
    testScopedExplicitCleanup: true
  }, null, 2));
} finally {
  if (gateway) await stopGateway(gateway).catch(() => undefined);
  for (const browserPid of browserPids) {
    if (processIsAlive(browserPid)) process.kill(browserPid);
  }
  if (hostPid && processIsAlive(hostPid)) process.kill(hostPid);
  await terminateTestScopedProcesses(runtimeRoot);
  await waitForTestScopedProcessesToExit(runtimeRoot, 5_000).catch(() => undefined);
  await rm(runtimeRoot, { recursive: true, force: true });
}

function assertLaunchedProfile(profile) {
  assert.equal(profile.running, true);
  assert.equal(profile.runtime?.extensionRuntime?.finalRuntimeVersion, '0.7.10');
  assert.equal(profile.runtime?.extensionRuntime?.nativeBridgeConnected, true);
  assert.equal(profile.runtime?.livePlatformRequests, 0);
}

function profileById(profiles, profileId) {
  const profile = profiles.find((candidate) => candidate.profile.profileId === profileId);
  assert.ok(profile, `gateway_profile_missing:${profileId}`);
  return profile;
}

function assertReconnectedProfile(profile, expectedHostPid, expectedBrowserPid, expectedBrowserSessionId) {
  assert.equal(profile.host.hostProcessId, expectedHostPid);
  assert.equal(profile.runtime.browserProcessId, expectedBrowserPid);
  assert.equal(profile.runtime.browserSessionId, expectedBrowserSessionId);
  assert.equal(profile.runtime.extensionRuntime.nativeBridgeConnected, true);
  assert.equal(profile.runtime.livePlatformRequests, 0);
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveReady);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise((resolveClose) => server.close(resolveClose));
  if (!port) throw new Error('gateway_host_gate_port_unavailable');
  return port;
}

async function startGateway(env, origin) {
  await Promise.all([gatewayMain, browserHostMain, resolve(extensionDirectory, 'manifest.json')].map(access));
  const child = spawn(process.execPath, [gatewayMain], {
    cwd: gatewayRoot,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  await waitUntil(async () => {
    if (child.exitCode !== null) throw new Error(`gateway_host_gate_gateway_exited:${logs.slice(-500)}`);
    try {
      const response = await fetch(`${origin}/v1/status`);
      return response.ok;
    } catch {
      return false;
    }
  }, 15_000, 'gateway_host_gate_gateway_start_timeout');
  return child;
}

async function stopGateway(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('gateway_host_gate_gateway_stop_timeout')), 10_000))
  ]);
}

async function request(origin, path, options = {}) {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  const response = await fetch(`${origin}${path}`, {
    method: options.method ?? 'GET',
    headers: body === undefined ? undefined : {
      'content-type': 'application/json',
      origin,
      'sec-fetch-site': 'same-origin'
    },
    body
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `gateway_host_gate_http_${response.status}`);
  return value;
}

function processIsAlive(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function waitUntil(predicate, timeoutMs, errorCode) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(errorCode);
}
