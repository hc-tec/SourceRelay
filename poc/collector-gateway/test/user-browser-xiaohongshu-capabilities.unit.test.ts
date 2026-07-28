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
      accountScopedSurfaces: 'forbidden',
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
    }), expect.objectContaining({
      capability: 'xiaohongshu.search.public_notes.v1',
      platform: 'xiaohongshu',
      inputMode: 'query_only_no_caller_url',
      executionTarget: 'existing_public_explore_tab',
      accountScopedSurfaces: 'forbidden',
      dispatchState: 'direct_ready',
      managedValidationState: 'gateway_extension_real_e2e_passed',
      captureMode: 'current_document_main_world_public_projection',
      responseBodies: 'temporarily_read_projected_not_stored',
      routeAdmission: 'public_payload_shape_verified_no_url_dependency',
      browserHostFallback: 'forbidden',
      budget: {
        maximumPlatformNavigations: 0,
        maximumPageReloads: 0,
        maximumPageInitiatedNewDocuments: 0,
        maximumSemanticActions: 1,
        maximumNetworkResponseBodies: 8,
        maximumProjectedItems: 40,
        maximumRawPayloadBytesStored: 0
      }
    }), expect.objectContaining({
      capability: 'xiaohongshu.account.public_notes.v1',
      platform: 'xiaohongshu',
      inputMode: 'scroll_budget_only_no_caller_url',
      executionTarget: 'existing_public_profile_tab',
      dispatchState: 'direct_canary_pending',
      captureMode: 'current_document_network_projection_plus_trusted_scroll',
      responseBodies: 'temporarily_read_projected_not_stored',
      browserHostFallback: 'forbidden',
      budget: expect.objectContaining({ maximumSemanticActions: 3, maximumProjectedItems: 40 })
    }), expect.objectContaining({
      capability: 'xiaohongshu.note.public_detail.v1',
      platform: 'xiaohongshu',
      inputMode: 'result_rank_only_no_caller_url',
      executionTarget: 'existing_public_search_tab',
      dispatchState: 'direct_ready',
      managedValidationState: 'gateway_extension_real_e2e_passed',
      captureMode: 'network_first_dom_fallback_same_document_overlay',
      browserHostFallback: 'forbidden',
      budget: expect.objectContaining({ maximumSemanticActions: 1, maximumNetworkResponseBodies: 4 })
    }), expect.objectContaining({
      capability: 'xiaohongshu.note.public_comments.v1', executionTarget: 'existing_public_note_overlay',
      dispatchState: 'direct_ready', managedValidationState: 'gateway_extension_real_e2e_passed',
      captureMode: 'network_first_dom_fallback_trusted_scroll',
      budget: expect.objectContaining({ maximumSemanticActions: 3, maximumProjectedItems: 80 })
    }), expect.objectContaining({capability:'xiaohongshu.note.public_comment_replies.v1',
      executionTarget:'existing_public_note_overlay',dispatchState:'direct_canary_pending',
      managedValidationState:'implementation_ready_live_e2e_pending',
      captureMode:'network_archive_first_dom_hierarchy_fallback_trusted_click',
      budget:expect.objectContaining({maximumSemanticActions:1,maximumProjectedItems:40})
    })]);
  });

  test('keeps the Bilibili catalog and the Xiaohongshu policy visible together', () => {
    const catalog = listUserBrowserCapabilities();
    expect(catalog).toHaveLength(18);
    expect(catalog.map((entry) => entry.capability)).toContain('bilibili.discussion');
    expect(catalog.map((entry) => entry.capability)).toContain('xiaohongshu.current_page.network_metadata');
    expect(catalog.map((entry) => entry.capability)).toContain('xiaohongshu.search.public_notes.v1');
    expect(catalog.map((entry) => entry.capability)).toContain('xiaohongshu.account.public_notes.v1');
    expect(catalog.map((entry) => entry.capability)).toContain('xiaohongshu.note.public_detail.v1');
    expect(catalog.map((entry) => entry.capability)).toContain('xiaohongshu.note.public_comments.v1');
    expect(catalog.map((entry) => entry.capability)).toContain('xiaohongshu.note.public_comment_replies.v1');
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
    const xiaohongshuCapabilitySchema = document.components.schemas.XiaohongshuUserBrowserCapability;
    expect(xiaohongshuCapabilitySchema.required).toContain('accountScopedSurfaces');
    expect(xiaohongshuCapabilitySchema.properties.accountScopedSurfaces).toEqual({
      type: 'string',
      const: 'forbidden'
    });
    expect(document.components.schemas.UserBrowserCollectRequest.oneOf).not.toEqual(expect.arrayContaining([
      { $ref: '#/components/schemas/XiaohongshuCurrentPageNetworkCollectRequest' }
    ]));
    expect(document.components.schemas.UserBrowserCapability.oneOf).toContainEqual({
      $ref: '#/components/schemas/XiaohongshuPublicNotesSearchCapability'
    });
    expect(document.components.schemas.UserBrowserCapability.oneOf).toContainEqual({
      $ref: '#/components/schemas/XiaohongshuAccountPublicNotesCapability'
    });
    expect(document.components.schemas.UserBrowserCapability.oneOf).toContainEqual({
      $ref: '#/components/schemas/XiaohongshuNotePublicDetailCapability'
    });
    expect(document.components.schemas.UserBrowserCapability.oneOf).toContainEqual({
      $ref: '#/components/schemas/XiaohongshuNotePublicCommentsCapability'
    });

    expect(userBrowserCollectorServiceRequestInput({
      schemaVersion: 2, browserBindingId: '11111111-1111-4111-8111-111111111111', platform: 'xiaohongshu',
      capability: 'xiaohongshu.note.public_comments.v1', executionTarget: 'existing_public_note_overlay',
      input: { maximumScrolls: 1 }
    })).toMatchObject({ input: { maximumScrolls: 1 } });

    expect(userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId: '11111111-1111-4111-8111-111111111111',
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.note.public_detail.v1',
      executionTarget: 'existing_public_search_tab',
      input: { resultRank: 1 }
    })).toMatchObject({ input: { resultRank: 1 } });
    for (const input of [
      { resultRank: 0 }, { resultRank: 21 }, { resultRank: 1, url: 'https://www.xiaohongshu.com/explore/x' },
      { resultRank: 1, selector: 'section.note-item' }
    ]) expect(() => userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId: '11111111-1111-4111-8111-111111111111',
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.note.public_detail.v1',
      executionTarget: 'existing_public_search_tab',
      input
    })).toThrow('user_browser_collector_service_request_invalid');
  });
});
