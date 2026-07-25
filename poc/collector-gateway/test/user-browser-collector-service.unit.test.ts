import { describe, expect, test } from 'vitest';
import { userBrowserCollectorServiceRequestInput } from '../src/user-browser-collector-service-contract.js';
import { userBrowserCollectorServiceOpenApiDocument } from '../src/user-browser-collector-service-openapi.js';

const browserBindingId = '11111111-1111-4111-8111-111111111111';

describe('user-owned browser collector service', () => {
  test('admits only the fixed first-page native-search input and normalises its phrase', () => {
    expect(userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.native_search',
      executionTarget: 'collector_work_tab',
      input: { query: '  DeepSeek   搜索  ' }
    })).toEqual({
      schemaVersion: 2,
      browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.native_search',
      executionTarget: 'collector_work_tab',
      input: { query: 'DeepSeek 搜索' }
    });
    expect(() => userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.native_search',
      executionTarget: 'collector_work_tab',
      input: { query: 'DeepSeek', page: 2 }
    })).toThrow('user_browser_collector_service_request_invalid');
  });

  test('publishes two registered direct-mode capabilities without a profile or browser-control primitive', () => {
    const document = userBrowserCollectorServiceOpenApiDocument('http://127.0.0.1:43127') as Record<string, any>;
    const variants = document.components.schemas.UserBrowserCollectRequest.oneOf;
    expect(variants).toEqual([
      { $ref: '#/components/schemas/UserBrowserVideoDetailCollectRequest' },
      { $ref: '#/components/schemas/UserBrowserNativeSearchCollectRequest' }
    ]);
    expect(document.components.schemas.UserBrowserNativeSearchCollectRequest.properties).toMatchObject({
      capability: { const: 'bilibili.native_search' },
      input: { required: ['query'] }
    });
    expect(Object.keys(document.paths)).not.toContain('/v1/profiles');
    expect(JSON.stringify(document.components.schemas)).not.toMatch(/profileId|arbitraryUrl|selector|script/i);
    expect(document['x-collector-excluded-surfaces']).toEqual(expect.arrayContaining([
      'arbitrary_url', 'arbitrary_selector', 'arbitrary_script'
    ]));
  });
});
