import { describe, expect, test } from 'vitest';
import { USER_BROWSER_DIRECT_WORK_CAPABILITIES } from '../src/background/user-browser-gateway-types.js';
import { userBrowserGatewayDirectCapabilityCatalog } from '../src/background/user-browser-gateway-validation.js';

function descriptor(input: {
  capability: string;
  title?: string;
  dispatchState?: string;
}) {
  return {
    schemaVersion: 1,
    capability: input.capability,
    platform: 'bilibili',
    title: input.title ?? input.capability,
    inputMode: 'canonical_profile_url',
    dispatchState: input.dispatchState ?? 'direct_canary_pending',
    captureMode: 'passive_dom_projection',
    legacyImplementationPresent: true,
    browserHostFallback: 'forbidden'
  };
}

describe('user-browser Gateway direct capability catalog', () => {
  test('keeps every Gateway direct-ready Bilibili passive work kind executable', () => {
    expect(USER_BROWSER_DIRECT_WORK_CAPABILITIES).toEqual(expect.arrayContaining([
      'bilibili.dynamic',
      'bilibili.collection_series.overview',
      'bilibili.collection_series.detail',
      'bilibili.danmaku'
    ]));
  });

  test('shows only work types this installed extension can execute and ignores research-only registry entries', () => {
    expect(userBrowserGatewayDirectCapabilityCatalog({
      schemaVersion: 2,
      capabilities: [
        descriptor({ capability: 'bilibili.video_detail', dispatchState: 'direct_ready' }),
        descriptor({ capability: 'bilibili.native_search_batch', dispatchState: 'direct_ready' }),
        descriptor({ capability: 'bilibili.account_profile' }),
        {
          schemaVersion: 1,
          capability: 'xiaohongshu.search.public_notes.v1',
          platform: 'xiaohongshu',
          title: '小红书公开笔记站内搜索',
          inputMode: 'query_only_no_caller_url',
          dispatchState: 'direct_ready',
          captureMode: 'current_document_main_world_public_projection',
          browserHostFallback: 'forbidden'
        },
        {
          schemaVersion: 1,
          capability: 'xiaohongshu.account.public_notes.v1',
          platform: 'xiaohongshu',
          title: '小红书公开博主笔记列表',
          inputMode: 'scroll_budget_only_no_caller_url',
          dispatchState: 'direct_canary_pending',
          captureMode: 'current_document_network_projection_plus_trusted_scroll',
          browserHostFallback: 'forbidden'
        },
        {
          schemaVersion: 1,
          capability: 'xiaohongshu.note.public_comment_replies.v1',
          platform: 'xiaohongshu',
          title: '小红书公开评论回复',
          inputMode: 'single_thread_budget_only_no_caller_identity',
          dispatchState: 'direct_ready',
          captureMode: 'network_archive_first_dom_hierarchy_fallback_trusted_click',
          browserHostFallback: 'forbidden'
        },
        descriptor({ capability: 'bilibili.transcript', dispatchState: 'trusted_interaction_migration_required' })
      ]
    })).toEqual([
      expect.objectContaining({ capability: 'bilibili.video_detail', dispatchState: 'direct_ready' }),
      expect.objectContaining({ capability: 'bilibili.native_search_batch', dispatchState: 'direct_ready' }),
      expect.objectContaining({ capability: 'bilibili.account_profile', dispatchState: 'direct_canary_pending' }),
      expect.objectContaining({
        capability: 'xiaohongshu.search.public_notes.v1',
        platform: 'xiaohongshu',
        dispatchState: 'direct_ready'
      }),
      expect.objectContaining({
        capability: 'xiaohongshu.account.public_notes.v1',
        platform: 'xiaohongshu',
        dispatchState: 'direct_canary_pending'
      }),
      expect.objectContaining({
        capability: 'xiaohongshu.note.public_comment_replies.v1',
        platform: 'xiaohongshu',
        dispatchState: 'direct_ready'
      })
    ]);
  });

  test('rejects malformed or duplicate direct descriptors rather than displaying untrusted catalog data', () => {
    expect(() => userBrowserGatewayDirectCapabilityCatalog({ schemaVersion: 1, capabilities: [] }))
      .toThrow('gateway_capability_catalog_invalid');
    expect(() => userBrowserGatewayDirectCapabilityCatalog({
      schemaVersion: 2,
      capabilities: [
        descriptor({ capability: 'bilibili.account_inventory' }),
        descriptor({ capability: 'bilibili.account_inventory' })
      ]
    })).toThrow('gateway_capability_catalog_invalid');
  });
});
