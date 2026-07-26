import { describe, expect, test } from 'vitest';
import {
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
        dispatchState: 'direct_ready',
        browserHostFallback: 'forbidden'
      }),
      expect.objectContaining({
        capability: 'bilibili.account_inventory',
        dispatchState: 'direct_ready',
        browserHostFallback: 'forbidden'
      }),
      expect.objectContaining({
        capability: 'bilibili.transcript',
        dispatchState: 'trusted_interaction_migration_required',
        browserHostFallback: 'forbidden'
      }),
      expect.objectContaining({
        capability: 'bilibili.dynamic',
        dispatchState: 'direct_ready',
        captureMode: 'passive_dom_projection',
        browserHostFallback: 'forbidden'
      }),
      expect.objectContaining({
        capability: 'bilibili.collection_series.overview',
        dispatchState: 'direct_ready',
        captureMode: 'dom_and_fixed_network_metadata',
        browserHostFallback: 'forbidden'
      }),
      expect.objectContaining({
        capability: 'bilibili.collection_series.detail',
        dispatchState: 'direct_ready',
        captureMode: 'passive_dom_projection',
        browserHostFallback: 'forbidden'
      }),
      expect.objectContaining({
        capability: 'bilibili.danmaku',
        dispatchState: 'direct_ready',
        captureMode: 'passive_player_dom_projection',
        browserHostFallback: 'forbidden'
      })
    ]));
    expect(isDirectReadyUserBrowserBilibiliCapability('bilibili.video_detail')).toBe(true);
    expect(isDirectReadyUserBrowserBilibiliCapability('bilibili.account_profile')).toBe(true);
    expect(isDirectReadyUserBrowserBilibiliCapability('bilibili.account_inventory')).toBe(true);
    expect(isDirectReadyUserBrowserBilibiliCapability('bilibili.dynamic')).toBe(true);
    expect(isDirectReadyUserBrowserBilibiliCapability('bilibili.collection_series.overview')).toBe(true);
    expect(isDirectReadyUserBrowserBilibiliCapability('bilibili.collection_series.detail')).toBe(true);
    expect(isDirectReadyUserBrowserBilibiliCapability('bilibili.danmaku')).toBe(true);
    expect(isDirectReadyUserBrowserBilibiliCapability('bilibili.transcript')).toBe(false);
  });
});
