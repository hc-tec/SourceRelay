import {
  CollectorClient,
  CollectorClientError,
  CollectionResult,
  bilibiliNativeSearch,
  listDirectCapabilities
} from '../src/index.mjs';

const bindingIdPlaceholder = '00000000-0000-4000-8000-000000000000';

async function run() {
  const origin = process.env.COLLECTOR_SERVICE_ORIGIN ?? 'http://127.0.0.1:43127';
  const token = process.env.COLLECTOR_SERVICE_TOKEN;
  if (!token) throw new Error('COLLECTOR_SERVICE_TOKEN is required');

  const client = new CollectorClient({ origin, token });
  const capabilities = await client.listCapabilities();
  const openapi = await client.readOpenApi();
  const bindings = await client.listBrowserBindings();
  const directReady = new Set(
    capabilities.filter((item) => item?.dispatchState === 'direct_ready').map((item) => item.capability)
  );
  if (capabilities.length !== 18 || directReady.size !== 15) throw new Error('unexpected_capability_catalog_shape');
  if (new Set(listDirectCapabilities()).size !== directReady.size ||
      listDirectCapabilities().some((value) => !directReady.has(value))) {
    throw new Error('javascript_allowlist_catalog_mismatch');
  }
  const expectedPaths = [
    '/v2/capabilities',
    '/v2/collector-service/browser-bindings',
    '/v2/collect',
    '/v2/collect/operations/{operationId}',
    '/v1/collect/artifacts/{capability}/{artifactId}'
  ];
  if (!expectedPaths.every((path) => Object.hasOwn(openapi.paths ?? {}, path))) {
    throw new Error('openapi_paths_incomplete');
  }
  const binding = bindings.find((item) => item?.state === 'online');
  if (!binding || typeof binding.browserBindingId !== 'string') throw new Error('online_binding_missing');

  let catalogOnlyRejected = false;
  try {
    await client.collect({
      schemaVersion: 2,
      browserBindingId: bindingIdPlaceholder,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.current_page.network_metadata',
      executionTarget: 'user_selected_tab',
      input: {}
    });
  } catch (error) {
    if (!(error instanceof CollectorClientError) || error.code !== 'collector_client_collect_request_invalid') throw error;
    catalogOnlyRejected = true;
  }
  if (!catalogOnlyRejected) throw new Error('catalog_only_capability_was_accepted');

  const request = bilibiliNativeSearch({
    browserBindingId: binding.browserBindingId,
    query: 'DeepSeek'
  });
  const result = await client.collectAndWaitModel(request);
  if (!(result instanceof CollectionResult)) throw new Error('javascript_sdk_real_result_model_missing');
  if (!result.succeeded || result.operation.capability !== 'bilibili.native_search') {
    throw new Error(`javascript_sdk_real_operation_not_completed:${result.operation.state}`);
  }
  if (!result.artifact || result.artifact.capability !== result.operation.capability) {
    throw new Error('javascript_sdk_real_artifact_capability_mismatch');
  }
  if (!result.artifact.summary || typeof result.artifact.summary !== 'object') {
    throw new Error('javascript_sdk_real_artifact_summary_missing');
  }
  return {
    capabilityCount: capabilities.length,
    directReadyCount: directReady.size,
    onlineBinding: true,
    openapiPathCount: Object.keys(openapi.paths ?? {}).length,
    catalogOnlyRejected,
    operationState: result.operation.state,
    operationCapability: result.operation.capability,
    artifactCapability: result.artifact.capability,
    capturedItems: result.artifact.summary.capturedItems,
    visibleVideoCardCount: result.artifact.summary.visibleVideoCardCount
  };
}

try {
  console.log(JSON.stringify(await run()));
} catch (error) {
  console.error(`javascript_sdk_real_gateway_smoke_failed:${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
