import {
  CollectorClient,
  CollectorClientError,
  bilibiliNativeSearch,
  createClientRequestId,
  listDirectCapabilities
} from '../src/index.mjs';
import { pathToFileURL } from 'node:url';

const EXPECTED_CAPABILITY_COUNT = 21;
const EXPECTED_DIRECT_READY_COUNT = 18;
const EXPECTED_OPENAPI_PATHS = [
  '/v2/capabilities',
  '/v2/collector-service/browser-bindings',
  '/v2/collect',
  '/v2/collect/operations/{operationId}',
  '/v2/collect/artifacts/{artifactId}',
  '/v2/collect/artifacts/{artifactId}/content',
  '/v1/collect/artifacts/{capability}/{artifactId}'
];
const PLACEHOLDER_BINDING_ID = '00000000-0000-4000-8000-000000000000';

export async function runGatewayContractSmoke({
  origin = process.env.COLLECTOR_SERVICE_ORIGIN ?? 'http://127.0.0.1:43127',
  token = process.env.COLLECTOR_SERVICE_TOKEN
} = {}) {
  if (!token) throw new Error('COLLECTOR_SERVICE_TOKEN is required');

  const client = new CollectorClient({ origin, token });
  const status = await client.readStatus();
  const catalog = await client.readCapabilityCatalog();
  const openapi = await client.readOpenApi();
  const release = await client.readRelease();
  const bindings = await client.listBrowserBindings();
  const directReady = catalog.capabilities.filter((item) => item?.dispatchState === 'direct_ready');
  const onlineBinding = bindings.find((item) => item?.state === 'online');

  if (catalog.capabilities.length !== EXPECTED_CAPABILITY_COUNT ||
      directReady.length !== EXPECTED_DIRECT_READY_COUNT) {
    throw new Error('unexpected_capability_catalog_shape');
  }
  const directNames = listDirectCapabilities();
  const directSet = new Set(directReady.map((item) => item.capability));
  if (new Set(directNames).size !== EXPECTED_DIRECT_READY_COUNT ||
      directNames.some((name) => !directSet.has(name))) {
    throw new Error('javascript_allowlist_catalog_mismatch');
  }
  if (status.deploymentMode !== 'user_owned_browser_extension' ||
      status.browserProcessControl !== 'not_available' ||
      Number(status.onlineBrowserBindingCount ?? 0) < 1) {
    throw new Error('javascript_runtime_status_unexpected');
  }
  if (release.releaseVersion !== '0.7.17' || release.service?.schemaVersion !== 3) {
    throw new Error('javascript_release_unexpected');
  }
  const openapiPaths = openapi.paths && typeof openapi.paths === 'object' ? openapi.paths : {};
  if (!EXPECTED_OPENAPI_PATHS.every((path) => Object.hasOwn(openapiPaths, path))) {
    throw new Error('openapi_paths_incomplete');
  }
  if (!onlineBinding?.browserBindingId) throw new Error('online_binding_missing');

  const request = bilibiliNativeSearch({
    clientRequestId: createClientRequestId(),
    browserBindingId: onlineBinding.browserBindingId,
    query: 'DeepSeek'
  });
  if (request.schemaVersion !== 3 || request.capability !== 'bilibili.native_search' ||
      request.executionTarget !== 'collector_work_tab') {
    throw new Error('javascript_builder_unexpected');
  }

  let migrationCapabilityRejected = false;
  try {
    await client.collect({
      schemaVersion: 3,
      clientRequestId: createClientRequestId(),
      browserBindingId: PLACEHOLDER_BINDING_ID,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.current_page.network_metadata',
      executionTarget: 'user_selected_tab',
      input: {}
    });
  } catch (error) {
    if (!(error instanceof CollectorClientError) || error.code !== 'collector_client_collect_request_invalid') {
      throw error;
    }
    migrationCapabilityRejected = true;
  }
  if (!migrationCapabilityRejected) throw new Error('catalog_only_capability_was_accepted');

  return {
    ok: true,
    sdk: 'javascript',
    gatewayOrigin: origin,
    capabilityCount: catalog.capabilities.length,
    directReadyCount: directReady.length,
    onlineBinding: true,
    openapiPathCount: Object.keys(openapiPaths).length,
    releaseVersion: release.releaseVersion,
    serviceSchemaVersion: release.service.schemaVersion,
    typedBuilder: true,
    migrationCapabilityRejected: true,
    platformActionSubmitted: false
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(await runGatewayContractSmoke())}\n`);
  } catch (error) {
    process.stderr.write(`javascript_gateway_contract_smoke_failed:${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
