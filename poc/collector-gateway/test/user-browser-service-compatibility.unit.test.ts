import { describe, expect, test } from 'vitest';
import { canonicalJson, sha256Hex } from '../src/canonical-json.js';
import { USER_BROWSER_CAPABILITY_REGISTRY } from '../src/user-browser-capability-registry.js';
import { userBrowserCollectorServiceOpenApiDocument } from '../src/user-browser-collector-service-openapi.js';
import {
  USER_BROWSER_SERVICE_FEATURES,
  userBrowserCapabilityCatalogContract,
  userBrowserServiceCompatibility
} from '../src/user-browser-service-compatibility.js';

function digest(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

describe('user-browser service compatibility identity', () => {
  test('binds all eighteen direct capabilities to exact OpenAPI request schemas and execution targets', () => {
    const origin = 'http://127.0.0.1:43127';
    const catalog = userBrowserCapabilityCatalogContract(origin);
    const openApi = userBrowserCollectorServiceOpenApiDocument(origin) as Record<string, any>;
    expect(catalog.schemaVersion).toBe(3);
    expect(catalog.capabilities).toHaveLength(21);
    expect(catalog.directContracts).toHaveLength(18);
    expect(catalog.catalogDigest).toBe(digest({
      capabilities: catalog.capabilities,
      directContracts: catalog.directContracts
    }));

    for (const contract of catalog.directContracts) {
      const registry = USER_BROWSER_CAPABILITY_REGISTRY[contract.capability];
      expect(contract.requestSchemaRef).toBe(`#/components/schemas/${registry.requestSchemaName}`);
      const schema = openApi.components.schemas[registry.requestSchemaName];
      expect(contract.requestSchemaDigest).toBe(digest(schema));
      expect(contract.executionTargets).toEqual(registry.executionTargets);
      expect(contract.defaultExecutionTarget).toBe(registry.executionTargets[0]);
      expect(contract.executionTargetMode).toBe(registry.executionTargets.length === 1 ? 'fixed' : 'enum');
      expect(contract.budgetPolicy).toBe(registry.budgetPolicy);
      expect(contract.executionProvider).toBe(registry.executionProvider ?? 'browser_extension');
      expect(schema.required).toContain('clientRequestId');
      expect(schema.properties.clientRequestId, contract.capability)
        .toEqual({ type: 'string', format: 'uuid' });
    }
    expect(catalog.directContracts.filter((entry) => entry.executionProvider === 'official_api'))
      .toHaveLength(3);
  });

  test('publishes origin-independent OpenAPI/catalog digests and exact feature flags', () => {
    const first = userBrowserServiceCompatibility('http://127.0.0.1:43127');
    const second = userBrowserServiceCompatibility('http://127.0.0.1:43128');
    expect(first).toEqual(second);
    expect(first.digestAlgorithm).toBe('sha256-canonical-json-v1');
    expect(first.openApiSchemaDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.capabilityCatalogDigest).toBe(
      userBrowserCapabilityCatalogContract('http://127.0.0.1:43127').catalogDigest
    );
    expect(first.features).toEqual(USER_BROWSER_SERVICE_FEATURES);
  });

  test('keeps the series-detail execution target aligned with the dispatch registry', () => {
    const document = userBrowserCollectorServiceOpenApiDocument('http://127.0.0.1:43127') as Record<string, any>;
    expect(document.components.schemas.UserBrowserCollectionSeriesDetailCollectRequest.properties.executionTarget)
      .toEqual({ type: 'string', const: 'collector_work_tab' });
    expect(USER_BROWSER_CAPABILITY_REGISTRY['bilibili.collection_series.detail'].executionTargets)
      .toEqual(['collector_work_tab']);
  });
});
