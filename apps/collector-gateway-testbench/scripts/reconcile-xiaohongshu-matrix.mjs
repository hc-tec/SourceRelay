import { fileURLToPath } from 'node:url';
import { CollectorClient } from '@intelligence/collector-client';
import {
  buildXiaohongshuReconciliationRequest,
  readRetainedXiaohongshuCase,
  readXiaohongshuReconciliationManifest,
  reconcileXiaohongshuCase
} from '../src/xiaohongshu-reconciliation.mjs';

const manifestPath = fileURLToPath(new URL(
  '../../../docs/validation/xiaohongshu-sdk-reconciliation-v0.7.17.json',
  import.meta.url
));

try {
  const token = process.env.COLLECTOR_SERVICE_TOKEN;
  const browserBindingId = process.env.COLLECTOR_SERVICE_BINDING_ID;
  const query = process.env.COLLECTOR_XIAOHONGSHU_RECONCILE_QUERY;
  if (!token) throw new Error('collector_service_token_required');
  if (!browserBindingId) throw new Error('collector_service_binding_id_required');
  if (!query) throw new Error('xiaohongshu_reconciliation_query_required');

  const origin = process.env.COLLECTOR_SERVICE_ORIGIN ?? 'http://127.0.0.1:43127';
  const manifest = await readXiaohongshuReconciliationManifest(manifestPath);
  const client = new CollectorClient({ origin, token, requestTimeoutMs: 20_000 });
  const release = await client.readRelease();
  const capabilities = await client.listCapabilities();
  const bindings = await client.listBrowserBindings();
  if (release.releaseVersion !== manifest.releaseVersion ||
    release.service?.schemaVersion !== manifest.serviceSchemaVersion) {
    throw new Error('xiaohongshu_reconciliation_release_mismatch');
  }
  if (manifest.cases.some((evidence) => !capabilities.some((descriptor) =>
    descriptor.capability === evidence.capability && descriptor.dispatchState === 'direct_ready'))) {
    throw new Error('xiaohongshu_reconciliation_capability_unavailable');
  }
  if (!bindings.some((binding) => binding.browserBindingId === browserBindingId && binding.state === 'online')) {
    throw new Error('xiaohongshu_reconciliation_binding_not_online');
  }

  const cases = [];
  for (const evidence of manifest.cases) {
    if (evidence.reconciliationMode === 'retained_operation_read') {
      cases.push(await readRetainedXiaohongshuCase(client, evidence));
      continue;
    }
    const request = buildXiaohongshuReconciliationRequest(evidence, { browserBindingId, query });
    cases.push(await reconcileXiaohongshuCase(client, evidence, request));
  }
  const collectionSubmissions = cases.filter((item) => item.collectionSubmitted).length;
  process.stdout.write(`${JSON.stringify({
    ok: true,
    language: 'javascript',
    releaseVersion: manifest.releaseVersion,
    caseCount: cases.length,
    collectionSubmissions,
    retainedOperationReads: cases.length - collectionSubmissions,
    expectedNewCoreOperations: 0,
    expectedLivePlatformActions: manifest.livePlatformActionsExpected,
    browserBindingOnline: true,
    cases
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    language: 'javascript',
    error: safeErrorCode(error)
  })}\n`);
  process.exitCode = 1;
}

function safeErrorCode(error) {
  const value = error instanceof Error ? error.message : '';
  return /^[a-z0-9_.-]{1,120}$/i.test(value) ? value : 'xiaohongshu_javascript_reconciliation_failed';
}
