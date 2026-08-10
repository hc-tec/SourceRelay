import { describe, expect, test } from 'vitest';
import { canonicalBilibiliAccountVideoInventoryUrl } from '../src/shared/bilibili-account-video-inventory-url.js';
import { canonicalBilibiliVideoUrl } from '../src/shared/bilibili-video-url.js';
import { normaliseLoopbackGatewayOrigin } from '../src/shared/control-plane.js';
import {
  resolveDetailStrategy,
  resolveNativeSearchStrategy,
  strategiesFor,
  strategyProvenance
} from '../src/shared/strategy-registry.js';

describe('Extension canonical URL and loopback boundaries', () => {
  test('accepts only a canonical Bilibili video identity and discards the one allowed observed-document query', () => {
    const canonical = 'https://www.bilibili.com/video/BV1qZSLBYEpa';
    expect(canonicalBilibiliVideoUrl(canonical)).toBe(canonical);
    expect(canonicalBilibiliVideoUrl(`${canonical}?from=search`)).toBeNull();
    expect(canonicalBilibiliVideoUrl(`${canonical}#comments`)).toBeNull();
    expect(canonicalBilibiliVideoUrl('https://user:secret@www.bilibili.com/video/BV1qZSLBYEpa')).toBeNull();
    expect(canonicalBilibiliVideoUrl(
      `${canonical}?vd_source=0123456789abcdef0123456789abcdef`,
      'observed_document'
    )).toBe(canonical);
    expect(canonicalBilibiliVideoUrl(`${canonical}?vd_source=not-a-digest`, 'observed_document')).toBeNull();
  });

  test('keeps account inventory input strict but discards platform-added observed-document query values', () => {
    const canonical = 'https://space.bilibili.com/7481602/upload/video';
    expect(canonicalBilibiliAccountVideoInventoryUrl(canonical)).toBe(canonical);
    expect(canonicalBilibiliAccountVideoInventoryUrl(`${canonical}?from=space`)).toBeNull();
    expect(canonicalBilibiliAccountVideoInventoryUrl(`${canonical}?from=space`, 'observed_document')).toBe(canonical);
    expect(canonicalBilibiliAccountVideoInventoryUrl(`${canonical}#tab`, 'observed_document')).toBeNull();
    expect(canonicalBilibiliAccountVideoInventoryUrl('https://www.bilibili.com/7481602/upload/video')).toBeNull();
  });

  test('admits only a ported HTTP loopback origin with no credentials, path, query, or fragment', () => {
    expect(normaliseLoopbackGatewayOrigin('http://127.0.0.1:38123')).toBe('http://127.0.0.1:38123');
    expect(normaliseLoopbackGatewayOrigin('http://[::1]:38123')).toBe('http://[::1]:38123');
    expect(normaliseLoopbackGatewayOrigin('http://localhost:38123')).toBeNull();
    expect(normaliseLoopbackGatewayOrigin('https://127.0.0.1:38123')).toBeNull();
    expect(normaliseLoopbackGatewayOrigin('http://127.0.0.1:80')).toBeNull();
    expect(normaliseLoopbackGatewayOrigin('http://user:secret@127.0.0.1:38123')).toBeNull();
    expect(normaliseLoopbackGatewayOrigin('http://127.0.0.1:38123/v1/status')).toBeNull();
  });
});

describe('Static strategy registry boundary', () => {
  test('exposes compiled strategies without granting response capture or unbounded detail capability', () => {
    const bilibiliSearch = resolveNativeSearchStrategy('bilibili');
    expect(bilibiliSearch).toMatchObject({
      strategyId: 'bilibili.search.breadth.dom.v2',
      version: '0.2.0',
      maturity: 'build_ready',
      approvedResponseRouteIds: []
    });
    expect(strategyProvenance(bilibiliSearch)).toMatchObject({
      platform: 'bilibili',
      evidenceObjectives: ['breadth_search'],
      acquisition: ['native_navigation', 'visible_dom']
    });
    expect(strategiesFor('xiaohongshu', 'breadth_search')).toEqual([
      expect.objectContaining({
        strategyId: 'xiaohongshu.search.public_notes.v1',
        version: '0.1.0',
        maturity: 'build_ready',
        surface: 'native_search',
        acquisition: ['native_navigation', 'visible_dom', 'bounded_interaction'],
        browser: expect.objectContaining({
          requiredHostPermissions: ['https://www.xiaohongshu.com/*'],
          optionalHostPermissions: []
        }),
        approvedResponseRouteIds: []
      })
    ]);
    expect(strategiesFor('xiaohongshu', 'account_archive')).toEqual([
      expect.objectContaining({
        strategyId: 'xiaohongshu.account.public_notes.v1',
        surface: 'account_listing',
        bounds: expect.objectContaining({ maxRecords: 200, maxReadOnlyActions: 20 })
      })
    ]);
    expect(strategiesFor('xiaohongshu', 'discussion_sample')).toHaveLength(2);
    expect(strategiesFor('bilibili', 'account_context')).toEqual([
      expect.objectContaining({
        strategyId: 'bilibili.account.profile.dom.v2',
        maturity: 'build_ready',
        surface: 'account_profile',
        acquisition: ['native_navigation', 'visible_dom'],
        approvedResponseRouteIds: []
      })
    ]);
    expect(strategiesFor('bilibili', 'account_archive')).toEqual([
      expect.objectContaining({
        strategyId: 'bilibili.account.video-inventory.dom.v1',
        maturity: 'build_ready',
        surface: 'account_listing',
        acquisition: ['native_navigation', 'visible_dom'],
        bounds: expect.objectContaining({
          maxRecords: 40,
          maxReadOnlyActions: 0,
          firstRenderedPageOnly: true
        })
      })
    ]);
    expect(resolveDetailStrategy('bilibili')).toMatchObject({
      strategyId: 'bilibili.video.detail.dom.v2',
      version: '0.4.0',
      maturity: 'build_ready',
      approvedResponseRouteIds: []
    });
    expect(resolveDetailStrategy('xiaohongshu')).toMatchObject({
      strategyId: 'xiaohongshu.note.public_detail.v1',
      version: '0.1.0',
      maturity: 'build_ready',
      approvedResponseRouteIds: []
    });
    expect(() => resolveDetailStrategy('zhihu')).toThrow('No static detail strategy is registered for zhihu.');
  });
});
