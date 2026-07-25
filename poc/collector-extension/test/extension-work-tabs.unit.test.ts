import { describe, expect, test } from 'vitest';
import { isExpectedExtensionWorkNavigation } from '../src/background/extension-work-tabs.js';

describe('extension-owned work-tab navigation identity', () => {
  test('permits only source-level canonical redirects for a signed target', () => {
    expect(isExpectedExtensionWorkNavigation(
      'https://www.bilibili.com/video/BV1qZSLBYEpa',
      'https://www.bilibili.com/video/BV1qZSLBYEpa/'
    )).toBe(true);
    expect(isExpectedExtensionWorkNavigation(
      'https://search.bilibili.com/all?keyword=DeepSeek',
      'https://search.bilibili.com/all?keyword=DeepSeek&o=1&vt=2'
    )).toBe(true);
    expect(isExpectedExtensionWorkNavigation(
      'https://space.bilibili.com/7481602',
      'https://space.bilibili.com/7481602/?spm_id_from=333.1007.0.0'
    )).toBe(true);
    expect(isExpectedExtensionWorkNavigation(
      'https://space.bilibili.com/7481602/upload/video',
      'https://space.bilibili.com/7481602/upload/video/?spm_id_from=333.999.0.0'
    )).toBe(true);
  });

  test('rejects a different query, off-platform destination, and unrelated page', () => {
    const expected = 'https://search.bilibili.com/all?keyword=DeepSeek';
    expect(isExpectedExtensionWorkNavigation(expected, 'https://search.bilibili.com/all?keyword=other')).toBe(false);
    expect(isExpectedExtensionWorkNavigation(expected, 'https://www.bilibili.com/video/BV1qZSLBYEpa')).toBe(false);
    expect(isExpectedExtensionWorkNavigation(expected, 'https://example.invalid/all?keyword=DeepSeek')).toBe(false);
    expect(isExpectedExtensionWorkNavigation(
      'https://space.bilibili.com/7481602/upload/video',
      'https://space.bilibili.com/7481602/upload/opus'
    )).toBe(false);
  });
});
