import { describe, expect, test } from 'vitest';
import {
  isDirectCanaryPendingUserBrowserBilibiliCapability,
  isDirectReadyUserBrowserBilibiliCapability,
  listUserBrowserBilibiliCapabilities
} from '../src/user-browser-bilibili-capabilities.js';

describe('user-owned browser Bilibili capability catalog', () => {
  test('registers every existing Bilibili implementation without turning legacy code into a fallback', () => {
    const catalog = listUserBrowserBilibiliCapabilities();
    expect(catalog).toHaveLength(12);
    expect(catalog).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: 'bilibili.account_profile',
        dispatchState: 'direct_canary_pending',
        browserHostFallback: 'forbidden'
      }),
      expect.objectContaining({
        capability: 'bilibili.account_inventory',
        dispatchState: 'direct_canary_pending',
        browserHostFallback: 'forbidden'
      }),
      expect.objectContaining({
        capability: 'bilibili.transcript',
        dispatchState: 'trusted_interaction_migration_required',
        browserHostFallback: 'forbidden'
      })
    ]));
    expect(isDirectReadyUserBrowserBilibiliCapability('bilibili.video_detail')).toBe(true);
    expect(isDirectReadyUserBrowserBilibiliCapability('bilibili.account_profile')).toBe(false);
    expect(isDirectCanaryPendingUserBrowserBilibiliCapability('bilibili.account_profile')).toBe(true);
    expect(isDirectCanaryPendingUserBrowserBilibiliCapability('bilibili.transcript')).toBe(false);
  });
});
