import { describe, expect, test } from 'vitest';
import { listUserBrowserCapabilities } from '../src/user-browser-capabilities.js';
import { userBrowserCollectorServiceRequestInput } from '../src/user-browser-collector-service-contract.js';
import { userBrowserCollectorServiceOpenApiDocument } from '../src/user-browser-collector-service-openapi.js';
import { listUserBrowserXiaohongshuCapabilities } from '../src/user-browser-xiaohongshu-capabilities.js';

describe('user-owned browser Xiaohongshu capability catalog', () => {
  test('publishes the strict network-first policy without making it dispatchable', () => {
    const capabilities = listUserBrowserXiaohongshuCapabilities();
    expect(capabilities).toEqual([expect.objectContaining({
      capability: 'xiaohongshu.current_page.network_metadata',
      platform: 'xiaohongshu',
      inputMode: 'explicit_current_page_selection_no_caller_url',
      executionTarget: 'user_selected_tab',
      dispatchState: 'policy_ready_route_admission_required',
      captureMode: 'prearmed_same_document_network_metadata',
      responseBodies: 'not_read',
      routeAdmission: 'no_public_content_route_admitted',
      browserHostFallback: 'forbidden',
      budget: {
        maximumPlatformNavigations: 0,
        maximumPageReloads: 0,
        maximumPageInitiatedNewDocuments: 0,
        maximumSemanticActions: 0,
        maximumNetworkResponseBodies: 0,
        maximumNetworkMetadataObservations: 24,
        maximumRawPayloadBytes: 0
      }
    })]);
  });

  test('keeps the Bilibili catalog and the Xiaohongshu policy visible together', () => {
    const catalog = listUserBrowserCapabilities();
    expect(catalog).toHaveLength(13);
    expect(catalog.map((entry) => entry.capability)).toContain('bilibili.discussion');
    expect(catalog.map((entry) => entry.capability)).toContain('xiaohongshu.current_page.network_metadata');
  });

  test('keeps the catalog-only policy outside the executable collect request union', () => {
    expect(() => userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId: '11111111-1111-4111-8111-111111111111',
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.current_page.network_metadata',
      executionTarget: 'user_selected_tab',
      input: {}
    })).toThrow('user_browser_collector_service_request_invalid');

    const document = userBrowserCollectorServiceOpenApiDocument('http://127.0.0.1:43127') as Record<string, any>;
    const capabilitySchema = document.components.schemas.UserBrowserCapability;
    expect(capabilitySchema.oneOf).toEqual(expect.arrayContaining([
      { $ref: '#/components/schemas/BilibiliUserBrowserCapability' },
      { $ref: '#/components/schemas/XiaohongshuUserBrowserCapability' }
    ]));
    expect(document.components.schemas.UserBrowserCollectRequest.oneOf).not.toEqual(expect.arrayContaining([
      { $ref: '#/components/schemas/XiaohongshuCurrentPageNetworkCollectRequest' }
    ]));
  });
});
