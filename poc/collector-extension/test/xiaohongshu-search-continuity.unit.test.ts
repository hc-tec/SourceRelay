import { describe, expect, test } from 'vitest';
import {
  isXiaohongshuSearchContinuityUrl,
  isXiaohongshuSearchResultOverlayPathname
} from '../src/background/extension-work-xiaohongshu-note-public-detail.js';

describe('Xiaohongshu search-surface continuity', () => {
  test('keeps accepting the bare search results routes', () => {
    expect(isXiaohongshuSearchContinuityUrl('https://www.xiaohongshu.com/search_result?keyword=x'))
      .toBe(true);
    expect(isXiaohongshuSearchContinuityUrl('https://www.xiaohongshu.com/search_result_ai/'))
      .toBe(true);
  });

  test('accepts the overlay route the platform navigates to while a note is open', () => {
    // Field failure (2026-09-07): after one rank's overlay opened, the
    // document moved to /search_result/<noteId>; the next detail operation
    // stopped in 8ms with xiaohongshu_public_search_tab_required because the
    // route shape was treated as a foreign page.
    expect(isXiaohongshuSearchContinuityUrl(
      'https://www.xiaohongshu.com/search_result/6a3f8ea900000000170084ca'
    )).toBe(true);
    expect(isXiaohongshuSearchContinuityUrl(
      'https://www.xiaohongshu.com/search_result_ai/6a3f8ea900000000170084ca'
    )).toBe(true);
    expect(isXiaohongshuSearchResultOverlayPathname('/search_result/6a3f8ea900000000170084ca'))
      .toBe(true);
  });

  test('still rejects non-search pages and foreign origins', () => {
    expect(isXiaohongshuSearchContinuityUrl('https://www.xiaohongshu.com/explore'))
      .toBe(false);
    expect(isXiaohongshuSearchContinuityUrl('https://www.xiaohongshu.com/user/profile/5ff0e6410000000001008400'))
      .toBe(false);
    expect(isXiaohongshuSearchContinuityUrl('https://evil.example.com/search_result/6a3f8ea900000000170084ca'))
      .toBe(false);
    expect(isXiaohongshuSearchContinuityUrl('not a url')).toBe(false);
  });

  test('rejects overlay-shaped paths with hostile segments', () => {
    expect(isXiaohongshuSearchResultOverlayPathname('/search_result/../user/profile/x'))
      .toBe(false);
    expect(isXiaohongshuSearchResultOverlayPathname('/search_result/')).toBe(false);
    expect(isXiaohongshuSearchResultOverlayPathname('/search_result')).toBe(false);
  });
});
