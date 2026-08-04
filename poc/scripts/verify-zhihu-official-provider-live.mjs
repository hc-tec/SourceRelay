import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CollectorClient,
  zhihuOfficialGlobalSearch,
  zhihuOfficialHotList,
  zhihuOfficialSearch
} from '../collector-client/src/index.mjs';

const pocRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const accessSecret = process.env.ZHIHU_ACCESS_SECRET;
if (typeof accessSecret !== 'string' || accessSecret.length < 20 || /\s/.test(accessSecret)) {
  throw new Error('zhihu_official_live_access_secret_required');
}

const port = await availablePort();
const origin = `http://127.0.0.1:${port}`;
const rootDirectory = await mkdtemp(join(tmpdir(), 'collector-zhihu-official-live-'));
const userHome = join(rootDirectory, 'user-home');
const stateDirectory = join(userHome, 'gateway');
let gateway;
let issuedClient;

try {
  gateway = spawn(process.execPath, ['collector-gateway/dist/user-browser-server.js'], {
    cwd: pocRoot,
    env: {
      ...process.env,
      COLLECTOR_GATEWAY_PORT: String(port),
      COLLECTOR_USER_BROWSER_HOME: userHome,
      COLLECTOR_USER_BROWSER_STATE_DIR: stateDirectory
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  const gatewayOutput = collectOutput(gateway);
  await waitForGateway(gateway, origin, gatewayOutput);

  const catalog = await readJson(origin, '/v2/capabilities');
  const officialDescriptors = catalog.capabilities.filter((entry) => entry.executionTarget === 'official_api');
  if (officialDescriptors.length !== 3 ||
      officialDescriptors.some((entry) => entry.runtimeState !== 'ready' || entry.browserBindingRequired !== false)) {
    throw new Error('zhihu_official_live_catalog_not_ready');
  }

  issuedClient = await fetchJson(origin, '/v2/collector-service/clients', {
    method: 'POST',
    headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: JSON.stringify({
      label: 'Zhihu official provider live canary',
      scopes: ['browser-bindings:read', 'collect:execute', 'operations:read', 'artifacts:read']
    })
  }, 201);
  const client = new CollectorClient({ origin, token: issuedClient.token });
  const queries = {
    zhihu: `RAG ${randomUUID().slice(0, 8)}`,
    global: `OpenAI ${randomUUID().slice(0, 8)}`
  };
  const requests = [
    zhihuOfficialSearch({ clientRequestId: randomUUID(), query: queries.zhihu, count: 1 }),
    zhihuOfficialHotList({ clientRequestId: randomUUID(), limit: 1 }),
    zhihuOfficialGlobalSearch({
      clientRequestId: randomUUID(),
      query: queries.global,
      count: 1,
      searchDatabase: 'all'
    })
  ];
  const evidence = [];
  for (const request of requests) {
    const first = await client.collect(request);
    assertCompletedOfficialOperation(first, request.capability);
    const readBack = await client.getOperation(first.operationId);
    if (JSON.stringify(readBack) !== JSON.stringify(first)) {
      throw new Error('zhihu_official_live_operation_readback_mismatch');
    }
    const artifactId = first.artifact.artifactId;
    const metadata = await client.readArtifactMetadata(artifactId);
    const content = await readWholeArtifact(client, artifactId, metadata.byteLength);
    const parsed = JSON.parse(content);
    if (parsed.capability !== request.capability || parsed.artifact?.operationId !== first.operationId ||
        parsed.artifact?.response?.Code !== 0 || parsed.artifact?.provenance?.browserUsed !== false) {
      throw new Error('zhihu_official_live_artifact_invalid');
    }
    const replay = await client.collect(request);
    if (replay.operationId !== first.operationId || replay.artifact?.artifactId !== artifactId) {
      throw new Error('zhihu_official_live_idempotent_replay_failed');
    }
    evidence.push({
      capability: request.capability,
      itemCount: parsed.artifact.response.Data.Items.length,
      byteLength: metadata.byteLength,
      sha256: metadata.sha256,
      idempotentReplayStable: true
    });
  }

  const bindings = await readJson(origin, '/v2/collector-service/browser-bindings', {
    headers: { authorization: `Bearer ${issuedClient.token}` }
  });
  if (!Array.isArray(bindings.bindings) || bindings.bindings.length !== 0) {
    throw new Error('zhihu_official_live_browser_binding_not_zero');
  }

  await revokeClient(origin, issuedClient.client.clientId);
  issuedClient = null;
  await stopGateway(gateway);
  gateway = undefined;

  const files = await allFiles(stateDirectory);
  const secretLeak = await containsBytes(files, Buffer.from(accessSecret, 'utf8'));
  if (secretLeak) throw new Error('zhihu_official_live_secret_persisted');
  const nonArtifactFiles = files.filter((path) => !path.includes('zhihu-official-artifacts'));
  for (const query of Object.values(queries)) {
    if (await containsBytes(nonArtifactFiles, Buffer.from(query, 'utf8'))) {
      throw new Error('zhihu_official_live_query_persisted_outside_artifact');
    }
  }
  const operations = JSON.parse(await readFile(join(stateDirectory, 'official-source-operations.json'), 'utf8'));
  const artifacts = JSON.parse(await readFile(join(stateDirectory, 'zhihu-official-artifacts.json'), 'utf8'));
  if (operations.length !== 3 || artifacts.length !== 3) {
    throw new Error('zhihu_official_live_duplicate_upstream_effect_detected');
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    gate: 'zhihu-official-provider-gateway-sdk-live-e2e',
    officialCapabilityCount: officialDescriptors.length,
    browserBindingRequired: false,
    browserProcessStarted: false,
    browserWindowDelta: 0,
    livePlatformRequests: 3,
    operationCount: operations.length,
    artifactCount: artifacts.length,
    secretPersisted: false,
    evidence
  }, null, 2)}\n`);
} finally {
  if (issuedClient) {
    try { await revokeClient(origin, issuedClient.client.clientId); } catch { /* best effort */ }
  }
  if (gateway && gateway.exitCode === null) await stopGateway(gateway);
  await rm(rootDirectory, { recursive: true, force: true });
}

function assertCompletedOfficialOperation(operation, capability) {
  if (operation.capability !== capability || operation.browserBindingId !== null ||
      operation.executionTarget !== 'official_api' || operation.state !== 'completed' ||
      operation.terminalReason !== 'official_api_response_ready' || !operation.artifact?.artifactId) {
    throw new Error('zhihu_official_live_operation_invalid');
  }
}

async function readWholeArtifact(client, artifactId, expectedBytes) {
  let offset = 0;
  let text = '';
  while (offset < expectedBytes) {
    const window = await client.readArtifactContentWindow(artifactId, { offset, maxBytes: 65_536 });
    text += window.text;
    if (window.nextOffset === null) {
      offset = window.endExclusive;
      break;
    }
    offset = window.nextOffset;
  }
  if (Buffer.byteLength(text, 'utf8') !== expectedBytes || offset !== expectedBytes) {
    throw new Error('zhihu_official_live_artifact_window_incomplete');
  }
  return text;
}

async function revokeClient(origin, clientId) {
  await fetchJson(origin, `/v2/collector-service/clients/${clientId}/revoke`, {
    method: 'POST',
    headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: '{}'
  }, 200);
}

async function readJson(origin, path, options = {}, expectedStatus = 200) {
  return await fetchJson(origin, path, options, expectedStatus);
}

async function fetchJson(origin, path, options, expectedStatus) {
  const response = await fetch(`${origin}${path}`, options);
  const payload = await response.json();
  if (response.status !== expectedStatus) {
    throw new Error(`zhihu_official_live_http_status_unexpected:${response.status}:${payload?.error ?? 'unknown'}`);
  }
  return payload;
}

function collectOutput(child) {
  const chunks = [];
  child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  return () => Buffer.concat(chunks).toString('utf8');
}

async function waitForGateway(child, origin, output) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`zhihu_official_live_gateway_exited:${child.exitCode}:${safeDigest(output())}`);
    try {
      const response = await fetch(`${origin}/v2/release`);
      if (response.ok) return;
    } catch { /* keep polling the local process */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`zhihu_official_live_gateway_timeout:${safeDigest(output())}`);
}

async function stopGateway(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('zhihu_official_live_port_missing');
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function allFiles(directory) {
  const values = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) values.push(...await allFiles(path));
    else if (entry.isFile()) values.push(path);
  }
  return values;
}

async function containsBytes(files, needle) {
  for (const path of files) {
    if ((await readFile(path)).includes(needle)) return true;
  }
  return false;
}

function safeDigest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}
