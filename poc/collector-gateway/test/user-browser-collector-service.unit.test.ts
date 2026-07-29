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

  test('admits only a phrase for the fixed two-page search batch', () => {
    expect(userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.native_search_batch',
      executionTarget: 'collector_work_tab',
      input: { query: '  DeepSeek   两页  ' }
    })).toEqual({
      schemaVersion: 2,
      browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.native_search_batch',
      executionTarget: 'collector_work_tab',
      input: { query: 'DeepSeek 两页' }
    });
    expect(() => userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.native_search_batch',
      executionTarget: 'collector_work_tab',
      input: { query: 'DeepSeek', pages: [1, 2] }
    })).toThrow('user_browser_collector_service_request_invalid');
  });

  test('admits Xiaohongshu query-only or bounded sequential depth input in an existing Explore tab', () => {
    expect(userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.search.public_notes.v1',
      executionTarget: 'existing_public_explore_tab',
      input: { query: '咖啡豆' }
    })).toEqual({
      schemaVersion: 2,
      browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.search.public_notes.v1',
      executionTarget: 'existing_public_explore_tab',
      input: { query: '咖啡豆' }
    });
    expect(userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.search.public_notes.v1',
      executionTarget: 'existing_public_explore_tab',
      input: { query: '咖啡豆', maximumDetails: 3 }
    })).toMatchObject({ input: { query: '咖啡豆', maximumDetails: 3 } });
    expect(userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.search.public_notes.v1',
      executionTarget: 'existing_public_explore_tab',
      input: { query: '咖啡豆', maximumDetails: 1, comments: { maximumScrolls: 2 } }
    })).toMatchObject({ input: { query: '咖啡豆', maximumDetails: 1, comments: { maximumScrolls: 2 } } });
    expect(userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.search.public_notes.v1',
      executionTarget: 'existing_public_explore_tab',
      input: { query: '咖啡豆', maximumDetails: 1,
        comments: { maximumScrolls: 2, replies: { maximumThreads: 1 } } }
    })).toMatchObject({ input: { comments: { maximumScrolls: 2, replies: { maximumThreads: 1 } } } });
    for (const input of [
      { query: '咖啡豆', comments: { maximumScrolls: 1 } },
      { query: '咖啡豆', maximumDetails: 1, comments: { maximumScrolls: 0 } },
      { query: '咖啡豆', maximumDetails: 1, comments: { maximumScrolls: 4 } },
      { query: '咖啡豆', maximumDetails: 1, comments: { maximumScrolls: 1, extra: true } },
      { query: '咖啡豆', maximumDetails: 1, comments: { maximumScrolls: 1, replies: { maximumThreads: 2 } } },
      { query: '咖啡豆', maximumDetails: 1, comments: { maximumScrolls: 1, replies: { maximumThreads: 1, extra: true } } }
    ]) expect(() => userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.search.public_notes.v1',
      executionTarget: 'existing_public_explore_tab',
      input
    })).toThrow('user_browser_collector_service_request_invalid');
    for (const invalidDepth of [-1, 21, 1.5]) expect(() => userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.search.public_notes.v1',
      executionTarget: 'existing_public_explore_tab',
      input: { query: '咖啡豆', maximumDetails: invalidDepth }
    })).toThrow('user_browser_collector_service_request_invalid');
    for (const extra of [
      { url: 'https://www.xiaohongshu.com/search_result?keyword=x' },
      { tabId: 1 },
      { selector: 'textarea' },
      { coordinate: { x: 1, y: 2 } },
      { script: 'document.body.innerHTML' },
      { debuggerCommand: 'Runtime.evaluate' }
    ]) expect(() => userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.search.public_notes.v1',
      executionTarget: 'existing_public_explore_tab',
      input: { query: '咖啡豆', ...extra }
    })).toThrow('user_browser_collector_service_request_invalid');
  });

  test('admits Xiaohongshu public-profile notes with only a bounded scroll budget', () => {
    expect(userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.account.public_notes.v1',
      executionTarget: 'existing_public_profile_tab',
      input: { maximumScrolls: 2 }
    })).toEqual({
      schemaVersion: 2,
      browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.account.public_notes.v1',
      executionTarget: 'existing_public_profile_tab',
      input: { maximumScrolls: 2 }
    });
    for (const input of [
      { maximumScrolls: 0 }, { maximumScrolls: 4 },
      { maximumScrolls: 1, url: 'https://www.xiaohongshu.com/user/profile/x' },
      { maximumScrolls: 1, tabId: 1 }, { maximumScrolls: 1, selector: 'section.note-item' }
    ]) expect(() => userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.account.public_notes.v1',
      executionTarget: 'existing_public_profile_tab',
      input
    })).toThrow('user_browser_collector_service_request_invalid');
  });

  test('publishes direct and canary passive capabilities without a Profile or browser-control primitive', () => {
    const document = userBrowserCollectorServiceOpenApiDocument('http://127.0.0.1:43127') as Record<string, any>;
    const variants = document.components.schemas.UserBrowserCollectRequest.oneOf;
    expect(variants).toEqual([
      { $ref: '#/components/schemas/UserBrowserVideoDetailCollectRequest' },
      { $ref: '#/components/schemas/UserBrowserNativeSearchCollectRequest' },
      { $ref: '#/components/schemas/UserBrowserNativeSearchBatchCollectRequest' },
      { $ref: '#/components/schemas/UserBrowserAccountProfileCollectRequest' },
      { $ref: '#/components/schemas/UserBrowserAccountInventoryCollectRequest' },
      { $ref: '#/components/schemas/UserBrowserVideoDiscussionCollectRequest' },
      { $ref: '#/components/schemas/UserBrowserDynamicCollectRequest' },
      { $ref: '#/components/schemas/UserBrowserCollectionSeriesOverviewCollectRequest' },
      { $ref: '#/components/schemas/UserBrowserCollectionSeriesDetailCollectRequest' },
      { $ref: '#/components/schemas/UserBrowserDanmakuCollectRequest' },
      { $ref: '#/components/schemas/UserBrowserXiaohongshuPublicNotesSearchCollectRequest' },
      { $ref: '#/components/schemas/UserBrowserXiaohongshuAccountPublicNotesCollectRequest' },
      { $ref: '#/components/schemas/UserBrowserXiaohongshuNotePublicDetailCollectRequest' },
      { $ref: '#/components/schemas/UserBrowserXiaohongshuNotePublicCommentsCollectRequest' },
      { $ref: '#/components/schemas/UserBrowserXiaohongshuReplyCollectRequest' }
    ]);
    expect(document.components.schemas.UserBrowserNativeSearchCollectRequest.properties).toMatchObject({
      capability: { const: 'bilibili.native_search' },
      input: { required: ['query'] }
    });
    expect(document.components.schemas.UserBrowserNativeSearchBatchCollectRequest.properties).toMatchObject({
      capability: { const: 'bilibili.native_search_batch' },
      input: { required: ['query'] }
    });
    expect(document.components.schemas.UserBrowserXiaohongshuPublicNotesSearchCollectRequest.properties).toMatchObject({
      platform: { const: 'xiaohongshu' },
      capability: { const: 'xiaohongshu.search.public_notes.v1' },
      executionTarget: { const: 'existing_public_explore_tab' },
      input: { required: ['query'], additionalProperties: false }
    });
    expect(document.components.schemas.UserBrowserXiaohongshuAccountPublicNotesCollectRequest.properties).toMatchObject({
      platform: { const: 'xiaohongshu' },
      capability: { const: 'xiaohongshu.account.public_notes.v1' },
      executionTarget: { type: 'string', enum: ['existing_public_profile_tab', 'ephemeral_public_profile_url'] },
      input: { required: ['maximumScrolls'], additionalProperties: false }
    });
    expect(document.components.schemas.UserBrowserXiaohongshuNotePublicDetailCollectRequest.properties).toMatchObject({
      platform: { const: 'xiaohongshu' },
      capability: { const: 'xiaohongshu.note.public_detail.v1' },
      executionTarget: { const: 'existing_public_search_tab' },
      input: { required: ['resultRank'], additionalProperties: false }
    });
    expect(document.components.schemas.UserBrowserXiaohongshuNotePublicCommentsCollectRequest.properties).toMatchObject({
      platform: { const: 'xiaohongshu' }, capability: { const: 'xiaohongshu.note.public_comments.v1' },
      executionTarget: { const: 'existing_public_note_overlay' },
      input: { required: ['maximumScrolls'], additionalProperties: false }
    });
    expect(document.components.schemas.UserBrowserXiaohongshuReplyCollectRequest.properties).toMatchObject({
      platform:{const:'xiaohongshu'},capability:{const:'xiaohongshu.note.public_comment_replies.v1'},
      executionTarget:{const:'existing_public_note_overlay'},input:{required:['maximumThreads'],additionalProperties:false}
    });
    expect(Object.keys(document.paths)).not.toContain('/v1/profiles');
    const schemaText = JSON.stringify(document.components.schemas);
    expect(schemaText).not.toContain('"profileId"');
    expect(schemaText).not.toContain('"tabId"');
    expect(schemaText).not.toContain('"windowId"');
    expect(schemaText).not.toContain('"documentId"');
    expect(schemaText).not.toContain('"arbitraryUrl"');
    expect(schemaText).not.toContain('"selector"');
    expect(schemaText).not.toContain('"script"');
    expect(document['x-collector-excluded-surfaces']).toEqual(expect.arrayContaining([
      'arbitrary_url', 'arbitrary_selector', 'arbitrary_script'
    ]));
  });

  test('admits one canonical public MID for profile and first-screen inventory, never a page URL or pagination control', () => {
    for (const capability of ['bilibili.account_profile', 'bilibili.account_inventory'] as const) {
      expect(userBrowserCollectorServiceRequestInput({
        schemaVersion: 2,
        browserBindingId,
        platform: 'bilibili',
        capability,
        executionTarget: 'collector_work_tab',
        input: { canonicalProfileUrl: 'https://space.bilibili.com/7481602' }
      })).toMatchObject({
        capability,
        input: { canonicalProfileUrl: 'https://space.bilibili.com/7481602' }
      });
    }
    expect(() => userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.account_inventory',
      executionTarget: 'collector_work_tab',
      input: { canonicalProfileUrl: 'https://space.bilibili.com/7481602/upload/video' }
    })).toThrow('user_browser_collector_service_request_invalid');
  });

  test('admits user_selected_tab only for the fixed inventory identity and never lets the caller name browser controls', () => {
    expect(userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.account_inventory',
      executionTarget: 'user_selected_tab',
      input: { canonicalProfileUrl: 'https://space.bilibili.com/7481602' }
    })).toEqual({
      schemaVersion: 2,
      browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.account_inventory',
      executionTarget: 'user_selected_tab',
      input: { canonicalProfileUrl: 'https://space.bilibili.com/7481602' }
    });
    expect(() => userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.account_profile',
      executionTarget: 'user_selected_tab',
      input: { canonicalProfileUrl: 'https://space.bilibili.com/7481602' }
    })).toThrow('user_browser_collector_service_request_invalid');
    expect(() => userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.account_inventory',
      executionTarget: 'user_selected_tab',
      input: { canonicalProfileUrl: 'https://space.bilibili.com/7481602', tabId: 7 }
    })).toThrow('user_browser_collector_service_request_invalid');

    const document = userBrowserCollectorServiceOpenApiDocument('http://127.0.0.1:43127') as Record<string, any>;
    expect(document.components.schemas.UserBrowserAccountInventoryCollectRequest.properties.executionTarget).toMatchObject({
      enum: ['collector_work_tab', 'user_selected_tab']
    });
    expect(document.components.schemas.Operation.properties.executionTarget).toMatchObject({
      enum: ['collector_work_tab', 'user_selected_tab', 'existing_public_explore_tab',
        'existing_public_profile_tab', 'ephemeral_public_profile_url', 'existing_public_search_tab',
        'existing_public_note_overlay']
    });
    expect(document.components.schemas.Operation.properties.capability.enum).toEqual(expect.arrayContaining([
      'xiaohongshu.search.public_notes.v1', 'xiaohongshu.account.public_notes.v1',
      'xiaohongshu.note.public_detail.v1', 'xiaohongshu.note.public_comments.v1',
      'xiaohongshu.note.public_comment_replies.v1'
    ]));
    expect(document.components.schemas.ArtifactResponse.properties.capability.enum).toEqual(expect.arrayContaining([
      'xiaohongshu.search.public_notes.v1', 'xiaohongshu.account.public_notes.v1',
      'xiaohongshu.note.public_detail.v1', 'xiaohongshu.note.public_comments.v1',
      'xiaohongshu.note.public_comment_replies.v1'
    ]));
  });

  test('admits comments only as a canonical video bound to a popup-selected existing document', () => {
    expect(userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.discussion',
      executionTarget: 'user_selected_tab',
      input: { canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }
    })).toEqual({
      schemaVersion: 2,
      browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.discussion',
      executionTarget: 'user_selected_tab',
      input: { canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }
    });
    expect(() => userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.discussion',
      executionTarget: 'collector_work_tab',
      input: { canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }
    })).toThrow('user_browser_collector_service_request_invalid');
    expect(() => userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.discussion',
      executionTarget: 'user_selected_tab',
      input: {
        canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa',
        tabId: 7
      }
    })).toThrow('user_browser_collector_service_request_invalid');

    const document = userBrowserCollectorServiceOpenApiDocument('http://127.0.0.1:43127') as Record<string, any>;
    expect(document.components.schemas.UserBrowserVideoDiscussionCollectRequest.properties).toMatchObject({
      capability: { const: 'bilibili.discussion' },
      executionTarget: { const: 'user_selected_tab' },
      input: { required: ['canonicalVideoUrl'] }
    });
  });

  test('admits only fixed public identities for passive dynamic, collection and danmaku canaries', () => {
    expect(userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.dynamic',
      executionTarget: 'collector_work_tab',
      input: { canonicalProfileUrl: 'https://space.bilibili.com/7481602' }
    })).toMatchObject({ capability: 'bilibili.dynamic' });
    expect(userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.collection_series.detail',
      executionTarget: 'collector_work_tab',
      input: {
        canonicalProfileUrl: 'https://space.bilibili.com/7481602',
        stableSeriesId: '123',
        listType: 'series'
      }
    })).toMatchObject({
      capability: 'bilibili.collection_series.detail',
      input: { stableSeriesId: '123', listType: 'series' }
    });
    expect(userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.danmaku',
      executionTarget: 'collector_work_tab',
      input: { canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }
    })).toMatchObject({ capability: 'bilibili.danmaku' });
    expect(() => userBrowserCollectorServiceRequestInput({
      schemaVersion: 2,
      browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.collection_series.detail',
      executionTarget: 'collector_work_tab',
      input: {
        canonicalProfileUrl: 'https://space.bilibili.com/7481602',
        stableSeriesId: '123',
        listType: 'series',
        page: 2
      }
    })).toThrow('user_browser_collector_service_request_invalid');
  });
});
