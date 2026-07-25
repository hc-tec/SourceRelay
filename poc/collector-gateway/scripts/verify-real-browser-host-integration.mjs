import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
const referenceClientMain = resolve(gatewayRoot, 'scripts', 'collector-service-reference-client.mjs');
const browserHostMain = resolve(workspaceRoot, 'collector-browser-host', 'dist', 'main.js');
const extensionDirectory = resolve(workspaceRoot, 'collector-extension', 'dist');
const runtimeBuild = JSON.parse(await readFile(resolve(extensionDirectory, 'runtime-build.json'), 'utf8'));
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
let collectorServiceCapabilitiesPublished = false;
let collectorServiceOpenApiPublished = false;
let collectorServiceInvalidInputRejectedPreBrowser = false;
let collectorServiceClientTokenAuthorized = false;
let collectorServiceArtifactTokenGateVerified = false;
let collectorServiceForeignOriginWithTokenRejected = false;
let collectorServiceMissingTokenRejected = false;
let collectorServiceScopesEnforced = false;
let collectorServiceRevokedTokenRejected = false;
let collectorServiceAuditRedacted = false;
let collectorServiceAuditConsoleOnly = false;
let collectorServiceReferenceClientVerified = false;
try {
  await mkdir(runtimeRoot, { recursive: true });
  gateway = await startGateway(environment, origin);
  const capabilityCatalog = await request(origin, '/v1/capabilities');
  assert.equal(capabilityCatalog.schemaVersion, 1);
  assert.equal(capabilityCatalog.capabilities?.length, 12);
  assert.ok(capabilityCatalog.capabilities?.every((capability) =>
    capability.platform === 'bilibili' &&
    capability.requiresProfile?.kind === 'collection' &&
    capability.requiresProfile?.accountCategory === 'user_managed'
  ));
  collectorServiceCapabilitiesPublished = true;

  const openApi = await request(origin, '/v1/openapi.json');
  assert.equal(openApi.openapi, '3.1.0');
  assert.equal(openApi.info?.version, '1.0.0-experimental');
  assert.deepEqual(openApi.servers, [{ url: origin }]);
  assert.ok(openApi.paths?.['/v1/collect']);
  assert.equal(openApi.paths?.['/v1/collector-service/audit'], undefined);
  assert.equal(openApi.paths?.['/v1/browser-host/exit'], undefined);
  assert.ok(openApi.components?.schemas?.bilibili_video_detail_input);
  collectorServiceOpenApiPublished = true;

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

  const issuedServiceClient = await request(origin, '/v1/collector-service/clients', {
    method: 'POST',
    body: { label: 'Gateway Host integration client' }
  });
  assert.match(issuedServiceClient.client?.clientId, /^[0-9a-f-]{36}$/i);
  assert.match(issuedServiceClient.token, /^cst_[A-Za-z0-9_-]{43}$/);
  assert.equal('token' in issuedServiceClient.client, false);
  const clientAuthorization = `Bearer ${issuedServiceClient.token}`;

  const directAuditResponse = await fetch(`${origin}/v1/collector-service/audit`);
  const directAuditBody = await directAuditResponse.json();
  assert.equal(directAuditResponse.status, 403);
  assert.equal(directAuditBody.error, 'console_origin_rejected');
  collectorServiceAuditConsoleOnly = true;

  const profilesOnlyClient = await request(origin, '/v1/collector-service/clients', {
    method: 'POST',
    body: { label: 'Gateway Host profiles-only client', scopes: ['profiles:read'] }
  });
  const profilesOnlyAuthorization = `Bearer ${profilesOnlyClient.token}`;

  const artifactsOnlyClient = await request(origin, '/v1/collector-service/clients', {
    method: 'POST',
    body: { label: 'Gateway Host artifacts-only client', scopes: ['artifacts:read'] }
  });
  const artifactsOnlyAuthorization = `Bearer ${artifactsOnlyClient.token}`;

  const referenceOpenApi = await runReferenceClient({ origin, arguments: ['openapi'] });
  assert.equal(referenceOpenApi.exitCode, 0);
  assert.equal(JSON.parse(referenceOpenApi.stdout).openapi, '3.1.0');

  const referenceCapabilities = await runReferenceClient({ origin, arguments: ['capabilities'] });
  assert.equal(referenceCapabilities.exitCode, 0);
  assert.equal(JSON.parse(referenceCapabilities.stdout).capabilities?.length, 12);

  const referenceProfiles = await runReferenceClient({
    origin,
    token: profilesOnlyClient.token,
    arguments: ['profiles']
  });
  assert.equal(referenceProfiles.exitCode, 0);
  assert.ok(JSON.parse(referenceProfiles.stdout).profiles?.some((profile) => profile.profileId === alphaProfileId));

  const referenceRequestPath = resolve(runtimeRoot, 'reference-client-collect-request.json');
  await writeFile(referenceRequestPath, JSON.stringify({
    schemaVersion: 1,
    profileId: alphaProfileId,
    platform: 'bilibili',
    capability: 'bilibili.video_detail',
    input: { canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }
  }), 'utf8');
  const referenceScopeDenied = await runReferenceClient({
    origin,
    token: profilesOnlyClient.token,
    arguments: ['collect', referenceRequestPath]
  });
  assert.equal(referenceScopeDenied.exitCode, 1);
  assert.deepEqual(JSON.parse(referenceScopeDenied.stderr), {
    ok: false,
    status: 403,
    error: 'collector_service_client_scope_denied'
  });

  const referenceArtifactNotFound = await runReferenceClient({
    origin,
    token: artifactsOnlyClient.token,
    arguments: ['artifact', '/v1/collect/artifacts/bilibili.video_detail/11111111-1111-4111-8111-111111111111']
  });
  assert.equal(referenceArtifactNotFound.exitCode, 1);
  assert.deepEqual(JSON.parse(referenceArtifactNotFound.stderr), {
    ok: false,
    status: 404,
    error: 'collector_service_artifact_not_found'
  });
  collectorServiceReferenceClientVerified = true;

  const missingTokenProfilesResponse = await fetch(`${origin}/v1/collector-service/profiles`);
  const missingTokenProfilesBody = await missingTokenProfilesResponse.json();
  assert.equal(missingTokenProfilesResponse.status, 401);
  assert.equal(missingTokenProfilesBody.error, 'collector_service_client_authorization_rejected');
  collectorServiceMissingTokenRejected = true;

  const clientProfilesResponse = await fetch(`${origin}/v1/collector-service/profiles`, {
    headers: { authorization: clientAuthorization }
  });
  const clientProfilesBody = await clientProfilesResponse.json();
  assert.equal(clientProfilesResponse.status, 200);
  assert.ok(clientProfilesBody.profiles?.some((profile) => profile.profileId === alphaProfileId));
  collectorServiceClientTokenAuthorized = true;

  const profilesOnlyResponse = await fetch(`${origin}/v1/collector-service/profiles`, {
    headers: { authorization: profilesOnlyAuthorization }
  });
  assert.equal(profilesOnlyResponse.status, 200);
  const profilesOnlyCollectResponse = await fetch(`${origin}/v1/collect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: profilesOnlyAuthorization
    },
    body: JSON.stringify({
      schemaVersion: 1,
      profileId: alphaProfileId,
      platform: 'bilibili',
      capability: 'bilibili.video_detail',
      input: { canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }
    })
  });
  const profilesOnlyCollectBody = await profilesOnlyCollectResponse.json();
  assert.equal(profilesOnlyCollectResponse.status, 403);
  assert.equal(profilesOnlyCollectBody.error, 'collector_service_client_scope_denied');
  const artifactsOnlyProfilesResponse = await fetch(`${origin}/v1/collector-service/profiles`, {
    headers: { authorization: artifactsOnlyAuthorization }
  });
  const artifactsOnlyProfilesBody = await artifactsOnlyProfilesResponse.json();
  assert.equal(artifactsOnlyProfilesResponse.status, 403);
  assert.equal(artifactsOnlyProfilesBody.error, 'collector_service_client_scope_denied');
  collectorServiceScopesEnforced = true;

  const unavailableArtifactResponse = await fetch(
    `${origin}/v1/collect/artifacts/bilibili.video_detail/11111111-1111-4111-8111-111111111111`,
    { headers: { authorization: clientAuthorization } }
  );
  const unavailableArtifactBody = await unavailableArtifactResponse.json();
  assert.equal(unavailableArtifactResponse.status, 404);
  assert.equal(unavailableArtifactBody.error, 'collector_service_artifact_not_found');
  collectorServiceArtifactTokenGateVerified = true;

  await request(origin, `/v1/collector-service/clients/${profilesOnlyClient.client.clientId}/revoke`, {
    method: 'POST',
    body: {}
  });
  const revokedProfilesResponse = await fetch(`${origin}/v1/collector-service/profiles`, {
    headers: { authorization: profilesOnlyAuthorization }
  });
  const revokedProfilesBody = await revokedProfilesResponse.json();
  assert.equal(revokedProfilesResponse.status, 401);
  assert.equal(revokedProfilesBody.error, 'collector_service_client_authorization_rejected');
  collectorServiceRevokedTokenRejected = true;

  const invalidCollectorResponse = await fetch(`${origin}/v1/collect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      'sec-fetch-site': 'same-origin'
    },
    body: JSON.stringify({
      schemaVersion: 1,
      profileId: alphaProfileId,
      platform: 'bilibili',
      capability: 'bilibili.video_detail',
      input: {
        canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa',
        unexpected: 'must be rejected before a browser action'
      }
    })
  });
  const invalidCollectorBody = await invalidCollectorResponse.json();
  assert.equal(invalidCollectorResponse.status, 400);
  assert.equal(invalidCollectorBody.error, 'bilibili_video_detail_input_invalid');
  collectorServiceInvalidInputRejectedPreBrowser = true;

  const foreignOriginWithTokenResponse = await fetch(`${origin}/v1/collect`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: clientAuthorization,
      origin: 'http://attacker.invalid',
      'sec-fetch-site': 'cross-site'
    },
    body: JSON.stringify({
      schemaVersion: 1,
      profileId: alphaProfileId,
      platform: 'bilibili',
      capability: 'bilibili.video_detail',
      input: { canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }
    })
  });
  const foreignOriginWithTokenBody = await foreignOriginWithTokenResponse.json();
  assert.equal(foreignOriginWithTokenResponse.status, 403);
  assert.equal(foreignOriginWithTokenBody.error, 'console_origin_rejected');
  collectorServiceForeignOriginWithTokenRejected = true;

  const auditPayload = await request(origin, '/v1/collector-service/audit');
  const auditEvents = auditPayload.events ?? [];
  assert.ok(auditEvents.some((event) =>
    event.action === 'profiles_read' &&
    event.actor?.kind === 'client' &&
    event.actor.clientId === issuedServiceClient.client.clientId &&
    event.outcome === 'completed'
  ));
  assert.ok(auditEvents.some((event) =>
    event.action === 'collect' &&
    event.outcome === 'denied' &&
    event.errorCode === 'collector_service_client_scope_denied' &&
    event.actor?.kind === 'unidentified'
  ));
  assert.ok(auditEvents.some((event) =>
    event.action === 'collect' &&
    event.outcome === 'failed' &&
    event.errorCode === 'bilibili_video_detail_input_invalid' &&
    event.profileIdDigest &&
    event.profileIdDigest !== alphaProfileId
  ));
  assert.ok(auditEvents.some((event) =>
    event.action === 'artifact_read' &&
    event.outcome === 'not_found' &&
    event.errorCode === 'collector_service_artifact_not_found'
  ));
  const auditSerialized = JSON.stringify(auditPayload);
  assert.equal(auditSerialized.includes(issuedServiceClient.token), false);
  assert.equal(auditSerialized.includes(profilesOnlyClient.token), false);
  assert.equal(auditSerialized.includes(alphaProfileId), false);
  assert.equal(auditSerialized.includes('https://www.bilibili.com/video/BV1qZSLBYEpa'), false);
  collectorServiceAuditRedacted = true;

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
    collectorServiceCapabilitiesPublished,
    collectorServiceOpenApiPublished,
    collectorServiceInvalidInputRejectedPreBrowser,
    collectorServiceClientTokenAuthorized,
    collectorServiceArtifactTokenGateVerified,
    collectorServiceForeignOriginWithTokenRejected,
    collectorServiceMissingTokenRejected,
    collectorServiceScopesEnforced,
    collectorServiceRevokedTokenRejected,
    collectorServiceAuditRedacted,
    collectorServiceAuditConsoleOnly,
    collectorServiceReferenceClientVerified,
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
  assert.equal(profile.runtime?.extensionRuntime?.finalRuntimeVersion, '0.7.17');
  assert.equal(profile.runtime?.extensionRuntime?.finalBuildFingerprint, runtimeBuild.buildFingerprint);
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
    headers: {
      origin,
      'sec-fetch-site': 'same-origin',
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    body
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `gateway_host_gate_http_${response.status}`);
  return value;
}

async function runReferenceClient(input) {
  await access(referenceClientMain);
  return await new Promise((resolveResult, rejectResult) => {
    const child = spawn(process.execPath, [referenceClientMain, ...input.arguments], {
      cwd: gatewayRoot,
      env: {
        ...process.env,
        COLLECTOR_SERVICE_ORIGIN: input.origin,
        ...(input.token === undefined ? {} : { COLLECTOR_SERVICE_TOKEN: input.token })
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', rejectResult);
    child.once('exit', (exitCode, signal) => {
      if (signal !== null) {
        rejectResult(new Error(`gateway_host_gate_reference_client_signaled:${signal}`));
        return;
      }
      resolveResult({ exitCode, stdout, stderr });
    });
  });
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
