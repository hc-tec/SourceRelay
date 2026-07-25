import { describe, expect, test } from 'vitest';
import { collectorServiceCapabilities } from '../src/collector-service-contract.js';
import { collectorServiceOpenApiDocument } from '../src/collector-service-openapi.js';

const ORIGIN = 'http://127.0.0.1:43127';

describe('Collector Service OpenAPI contract', () => {
  test('publishes only the external consumer surface with all registered capability input schemas', () => {
    const document = collectorServiceOpenApiDocument(ORIGIN) as Record<string, any>;
    expect(document.openapi).toBe('3.1.0');
    expect(document.info).toMatchObject({
      title: 'Local Collector Service',
      version: '1.0.0-experimental'
    });
    expect(document.servers).toEqual([{ url: ORIGIN }]);
    expect(Object.keys(document.paths)).toEqual([
      '/v1/openapi.json',
      '/v1/capabilities',
      '/v1/collector-service/profiles',
      '/v1/collect',
      '/v1/collect/artifacts/{capability}/{artifactId}'
    ]);
    expect(JSON.stringify(document)).not.toContain('browser-host');
    expect(JSON.stringify(document)).not.toContain('collector-service/audit');
    expect(document['x-collector-excluded-surfaces']).toEqual(expect.arrayContaining([
      'arbitrary_url',
      'arbitrary_selector',
      'arbitrary_script',
      'arbitrary_pointer_input',
      'arbitrary_network_route'
    ]));

    const requestVariants = document.components.schemas.CollectorServiceRequest.oneOf;
    expect(requestVariants).toHaveLength(12);
    expect(requestVariants.map((variant: Record<string, any>) => variant.properties.capability.const)).toEqual([
      'bilibili.native_search',
      'bilibili.native_search_batch',
      'bilibili.account_profile',
      'bilibili.account_inventory',
      'bilibili.account_inventory.pagination',
      'bilibili.video_detail',
      'bilibili.transcript',
      'bilibili.discussion',
      'bilibili.danmaku',
      'bilibili.dynamic',
      'bilibili.collection_series.overview',
      'bilibili.collection_series.detail'
    ]);
    expect(document.components.schemas.bilibili_native_search_input).toMatchObject({
      additionalProperties: false,
      required: ['query'],
      properties: { page: { maximum: 2 } }
    });
    expect(document.components.schemas.bilibili_dynamic_input).toMatchObject({
      additionalProperties: false,
      required: ['canonicalProfileUrl']
    });
    for (const descriptor of collectorServiceCapabilities()) {
      expect(document.components.schemas[descriptor.input]).toEqual(descriptor.inputSchema);
      expect(descriptor.inputSchema).not.toHaveProperty('properties.profileId');
    }
  });

  test('clones the document and refuses a non-loopback publication origin', () => {
    const first = collectorServiceOpenApiDocument(ORIGIN) as Record<string, any>;
    first.info.title = 'mutated';
    first.components.schemas.bilibili_video_detail_input.required.push('unexpected');
    const second = collectorServiceOpenApiDocument(ORIGIN) as Record<string, any>;
    expect(second.info.title).toBe('Local Collector Service');
    expect(second.components.schemas.bilibili_video_detail_input.required).toEqual(['canonicalVideoUrl']);
    expect(() => collectorServiceOpenApiDocument('https://example.invalid')).toThrow('collector_service_openapi_origin_invalid');
    expect(() => collectorServiceOpenApiDocument('http://127.0.0.1:43127/path')).toThrow('collector_service_openapi_origin_invalid');
  });
});
