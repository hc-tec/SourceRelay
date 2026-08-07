import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { CollectorClient, CollectorClientError, createClientRequestId } from '../collector-client/src/index.mjs';

const pocRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = await availablePort();
const origin = `http://127.0.0.1:${port}`;
const stateDirectory = await mkdtemp(join(tmpdir(), 'collector-user-browser-api-smoke-'));
const userHome = join(stateDirectory, 'user-home');
let gateway;

try {
  gateway = spawn(process.execPath, ['collector-gateway/dist/user-browser-server.js'], {
    cwd: pocRoot,
    env: {
      ...process.env,
      COLLECTOR_GATEWAY_PORT: String(port),
      COLLECTOR_USER_BROWSER_HOME: userHome,
      COLLECTOR_USER_BROWSER_STATE_DIR: join(userHome, 'gateway')
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  gateway.stdout.on('data', (chunk) => process.stdout.write(`[api-smoke] ${chunk}`));
  gateway.stderr.on('data', (chunk) => process.stderr.write(`[api-smoke] ${chunk}`));
  await waitForGateway();

  const release = await readJson('/v2/release');
  const capabilities = await readJson('/v2/capabilities');
  if (release.releaseVersion !== '0.7.17' || release.service?.schemaVersion !== 3 ||
      release.compatibility?.digestAlgorithm !== 'sha256-canonical-json-v1' ||
      capabilities.schemaVersion !== 3 || capabilities.capabilities?.length !== 21 ||
      capabilities.directContracts?.length !== 18) {
    throw new Error('user_browser_api_catalog_probe_failed');
  }

  const officialProviderHeaders = {
    origin,
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json'
  };
  const officialBefore = await fetchJson('/v2/official-providers', {
    headers: { origin, 'sec-fetch-site': 'same-origin' }
  }, 200);
  if (officialBefore.providers?.[0]?.runtimeState !== 'credential_required') {
    throw new Error('user_browser_api_official_provider_initial_state_failed');
  }
  const configuredOfficial = await fetchJson('/v2/official-providers/zhihu/credential', {
    method: 'POST',
    headers: officialProviderHeaders,
    body: JSON.stringify({ accessSecret: 'api-smoke-official-secret-123456' })
  }, 200);
  if (configuredOfficial.provider?.runtimeState !== 'ready' ||
      JSON.stringify(configuredOfficial).includes('api-smoke-official-secret-123456')) {
    throw new Error('user_browser_api_official_provider_configure_failed');
  }
  const configuredCapabilities = await readJson('/v2/capabilities');
  if (configuredCapabilities.capabilities
    ?.filter((item) => item.executionProvider === 'zhihu_open_platform')
    .some((item) => item.runtimeState !== 'ready')) {
    throw new Error('user_browser_api_official_provider_catalog_state_failed');
  }
  await fetchJson('/v2/official-providers/zhihu/credential/clear', {
    method: 'POST',
    headers: officialProviderHeaders,
    body: '{}'
  }, 200);

  const issued = await fetchJson('/v2/collector-service/clients', {
    method: 'POST',
    headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: JSON.stringify({ label: 'versioned-api-smoke', scopes: ['browser-bindings:read', 'collect:execute', 'operations:read', 'artifacts:read'] })
  }, 201);
  const token = issued.token;
  const client = new CollectorClient({ origin, token });
  const sdkRelease = await client.readRelease();
  const sdkCapabilities = await client.listCapabilities();
  const bindings = await client.listBrowserBindings();
  if (sdkRelease.releaseVersion !== release.releaseVersion || sdkCapabilities.length !== 21 || bindings.length !== 0) {
    throw new Error('user_browser_api_sdk_probe_failed');
  }

  const rejected = await fetchJson('/v2/collect', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 3,
      clientRequestId: createClientRequestId(),
      browserBindingId: '11111111-1111-4111-8111-111111111111',
      platform: 'bilibili',
      capability: 'bilibili.transcript',
      executionTarget: 'collector_work_tab',
      input: { canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }
    })
  }, 400);
  if (rejected.error !== 'user_browser_collector_service_request_invalid') throw new Error('user_browser_api_catalog_only_not_rejected');

  const validRequest = {
    schemaVersion: 3,
    clientRequestId: createClientRequestId(),
    browserBindingId: '11111111-1111-4111-8111-111111111111',
    platform: 'bilibili',
    capability: 'bilibili.video_detail',
    executionTarget: 'collector_work_tab',
    input: { canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }
  };
  await assertClientError(() => client.collect(validRequest), 'browser_binding_not_found');
  await assertClientError(() => client.getOperation('22222222-2222-4222-8222-222222222222'), 'extension_work_not_found');

  const missingArtifact = await fetchJson(`/v1/collect/artifacts/bilibili.video_detail/22222222-2222-4222-8222-222222222222`, {
    headers: { authorization: `Bearer ${token}` }
  }, 404);
  if (missingArtifact.error !== 'collector_service_artifact_not_found') throw new Error('user_browser_api_artifact_boundary_failed');
  const missingArtifactMetadata = await fetchJson('/v2/collect/artifacts/22222222-2222-4222-8222-222222222222', {
    headers: { authorization: `Bearer ${token}` }
  }, 404);
  if (missingArtifactMetadata.error !== 'collector_service_artifact_not_found') {
    throw new Error('user_browser_api_artifact_metadata_boundary_failed');
  }

  const limitedIssued = await fetchJson('/v2/collector-service/clients', {
    method: 'POST',
    headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: JSON.stringify({ label: 'limited-api-smoke', scopes: ['operations:read'] })
  }, 201);
  const limited = new CollectorClient({ origin, token: limitedIssued.token });
  await assertClientError(() => limited.listBrowserBindings(), 'collector_client_http_error');

  console.log(JSON.stringify({
    ok: true,
    gate: 'user-browser-sdk-gateway-operation-artifact-smoke',
    releaseVersion: release.releaseVersion,
    catalogCount: capabilities.capabilities.length,
    browserCapabilitiesRequireOnlineBinding: true,
    officialCapabilitiesRequireBrowserBinding: false,
    officialProviderConsoleConfigurationChecked: true,
    catalogOnlyCapabilityRejected: true,
    artifactCapabilityBoundaryChecked: true,
    scopeIsolationChecked: true,
    browserProcessStarted: false,
    livePlatformRequests: 0
  }, null, 2));
} finally {
  if (gateway && gateway.exitCode === null) gateway.kill('SIGTERM');
  await rm(stateDirectory, { recursive: true, force: true });
}

async function readJson(path) {
  return await fetchJson(path, {}, 200);
}

async function fetchJson(path, options, expectedStatus) {
  const response = await fetch(origin + path, { ...options, signal: AbortSignal.timeout(5_000) });
  const payload = await response.json();
  if (response.status !== expectedStatus) throw new Error(`user_browser_api_status_unexpected:${path}:${response.status}:${expectedStatus}`);
  return payload;
}

async function assertClientError(action, expectedCode) {
  try {
    await action();
  } catch (error) {
    if (error instanceof CollectorClientError && (expectedCode === 'collector_client_http_error' || error.code === expectedCode)) return;
    throw error;
  }
  throw new Error(`user_browser_api_expected_error_missing:${expectedCode}`);
}

async function waitForGateway() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin + '/v1/status', { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch { /* process is still starting */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('user_browser_api_gateway_start_timeout');
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  if (!address || typeof address === 'string') throw new Error('user_browser_api_port_unavailable');
  return address.port;
}
