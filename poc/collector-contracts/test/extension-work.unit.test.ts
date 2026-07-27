import { describe, expect, test } from 'vitest';
import {
  extensionWorkSigningPayload,
  isExtensionWorkItem,
  isExtensionWorkResultForItem,
  type ExtensionWorkItem,
  type ExtensionWorkResult
} from '../src/index.js';

const item: ExtensionWorkItem = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: '11111111-1111-4111-8111-111111111111',
  operationId: '22222222-2222-4222-8222-222222222222',
  browserBindingId: '33333333-3333-4333-8333-333333333333',
  platform: 'bilibili',
  capability: 'bilibili.video_detail',
  executionTarget: 'collector_work_tab',
  issuedAt: '2026-07-25T00:00:00.000Z',
  expiresAt: '2026-07-25T00:01:00.000Z',
  input: {
    canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa',
    bvid: 'BV1qZSLBYEpa'
  },
  budget: {
    maximumPlatformNavigations: 1,
    maximumSemanticActions: 0,
    maximumResponseObservations: 0,
    maximumPayloadBytes: 98_304
  },
  gatewaySignature: 'a'.repeat(86)
};

const searchItem: ExtensionWorkItem = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: '44444444-4444-4444-8444-444444444444',
  operationId: '55555555-5555-4555-8555-555555555555',
  browserBindingId: '33333333-3333-4333-8333-333333333333',
  platform: 'bilibili',
  capability: 'bilibili.native_search',
  executionTarget: 'collector_work_tab',
  issuedAt: '2026-07-25T00:00:00.000Z',
  expiresAt: '2026-07-25T00:01:00.000Z',
  input: {
    query: 'DeepSeek',
    canonicalSearchUrl: 'https://search.bilibili.com/all?keyword=DeepSeek',
    resultType: 'comprehensive',
    sort: 'relevance',
    page: 1
  },
  budget: {
    maximumPlatformNavigations: 1,
    maximumSemanticActions: 0,
    maximumResponseObservations: 0,
    maximumPayloadBytes: 98_304
  },
  gatewaySignature: 'b'.repeat(86)
};

const accountProfileItem: ExtensionWorkItem = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: '66666666-6666-4666-8666-666666666666',
  operationId: '77777777-7777-4777-8777-777777777777',
  browserBindingId: '33333333-3333-4333-8333-333333333333',
  platform: 'bilibili',
  capability: 'bilibili.account_profile',
  executionTarget: 'collector_work_tab',
  issuedAt: '2026-07-25T00:00:00.000Z',
  expiresAt: '2026-07-25T00:01:00.000Z',
  input: {
    canonicalProfileUrl: 'https://space.bilibili.com/7481602',
    stableAccountId: '7481602'
  },
  budget: {
    maximumPlatformNavigations: 1,
    maximumSemanticActions: 0,
    maximumResponseObservations: 0,
    maximumPayloadBytes: 98_304
  },
  gatewaySignature: 'c'.repeat(86)
};

const accountInventoryItem: ExtensionWorkItem = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: '88888888-8888-4888-8888-888888888888',
  operationId: '99999999-9999-4999-8999-999999999999',
  browserBindingId: '33333333-3333-4333-8333-333333333333',
  platform: 'bilibili',
  capability: 'bilibili.account_inventory',
  executionTarget: 'collector_work_tab',
  issuedAt: '2026-07-25T00:00:00.000Z',
  expiresAt: '2026-07-25T00:01:00.000Z',
  input: {
    canonicalProfileUrl: 'https://space.bilibili.com/7481602',
    canonicalInventoryUrl: 'https://space.bilibili.com/7481602/upload/video',
    stableAccountId: '7481602'
  },
  budget: {
    maximumPlatformNavigations: 1,
    maximumSemanticActions: 0,
    maximumResponseObservations: 0,
    maximumPayloadBytes: 98_304
  },
  gatewaySignature: 'd'.repeat(86)
};

const accountInventorySelectedTabItem: ExtensionWorkItem = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  browserBindingId: '33333333-3333-4333-8333-333333333333',
  platform: 'bilibili',
  capability: 'bilibili.account_inventory',
  executionTarget: 'user_selected_tab',
  issuedAt: '2026-07-25T00:00:00.000Z',
  expiresAt: '2026-07-25T00:01:00.000Z',
  input: {
    canonicalProfileUrl: 'https://space.bilibili.com/7481602',
    canonicalInventoryUrl: 'https://space.bilibili.com/7481602/upload/video',
    stableAccountId: '7481602'
  },
  budget: {
    maximumPlatformNavigations: 0,
    maximumSemanticActions: 0,
    maximumResponseObservations: 0,
    maximumPayloadBytes: 98_304
  },
  gatewaySignature: 'e'.repeat(86)
};

const discussionSelectedTabItem: ExtensionWorkItem = {
  schemaVersion: 1,
  protocolVersion: 1,
  workId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  operationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  browserBindingId: '33333333-3333-4333-8333-333333333333',
  platform: 'bilibili',
  capability: 'bilibili.discussion',
  executionTarget: 'user_selected_tab',
  issuedAt: '2026-07-25T00:00:00.000Z',
  expiresAt: '2026-07-25T00:01:00.000Z',
  input: {
    canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa',
    bvid: 'BV1qZSLBYEpa'
  },
  budget: {
    maximumPlatformNavigations: 0,
    maximumSemanticActions: 0,
    maximumResponseObservations: 0,
    maximumPayloadBytes: 98_304
  },
  gatewaySignature: 'f'.repeat(86)
};

describe('direct extension work contract', () => {
  test('signs a fixed typed work item without allowing arbitrary carrier fields', () => {
    expect(isExtensionWorkItem(item)).toBe(true);
    expect(extensionWorkSigningPayload(item)).not.toContain('gatewaySignature');
    expect(isExtensionWorkItem({ ...item, selector: 'body' })).toBe(false);
    expect(isExtensionWorkItem({
      ...item,
      input: { ...item.input, canonicalVideoUrl: `${item.input.canonicalVideoUrl}?from=unsafe` }
    })).toBe(false);
  });

  test('accepts a completed projection only when it remains bound to the claimed item and one navigation', () => {
    const result: ExtensionWorkResult = {
      schemaVersion: 1,
      protocolVersion: 1,
      workId: item.workId,
      operationId: item.operationId,
      browserBindingId: item.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.video_detail',
      executionTarget: 'collector_work_tab',
      state: 'completed',
      errorCode: null,
      terminalReason: 'detail_ready',
      completedAt: '2026-07-25T00:00:20.000Z',
      navigation: { attempted: true, attemptCount: 1 },
      workTabAcquisition: 'created',
      workTabDisposition: 'idle_reusable',
      observation: {
        bvid: item.input.bvid,
        title: '公开页面标题',
        metadataVisibleText: null,
        description: null,
        creator: null,
        tagTexts: ['AI'],
        episodeSummaryText: null,
        titleVisible: true,
        playerVisible: true,
        chargeExclusiveTrialVisible: false,
        loginOverlayVisible: false,
        risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
      }
    };
    expect(isExtensionWorkResultForItem(result, item)).toBe(true);
    expect(isExtensionWorkResultForItem({
      ...result,
      navigation: { attempted: true, attemptCount: 0 }
    }, item)).toBe(false);
    expect(isExtensionWorkResultForItem({
      ...result,
      observation: { ...result.observation!, bvid: 'BV1xx411c7mD' }
    }, item)).toBe(false);
  });

  test('keeps native search to its fixed comprehensive first-page DOM capability', () => {
    expect(isExtensionWorkItem(searchItem)).toBe(true);
    expect(isExtensionWorkItem({
      ...searchItem,
      input: { ...searchItem.input, page: 2 }
    })).toBe(false);
    expect(isExtensionWorkItem({
      ...searchItem,
      input: { ...searchItem.input, sort: 'newest' }
    })).toBe(false);
    expect(isExtensionWorkItem({ ...searchItem, selector: '.search-page' })).toBe(false);

    const result: ExtensionWorkResult = {
      schemaVersion: 1,
      protocolVersion: 1,
      workId: searchItem.workId,
      operationId: searchItem.operationId,
      browserBindingId: searchItem.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.native_search',
      executionTarget: 'collector_work_tab',
      state: 'completed',
      errorCode: null,
      terminalReason: 'search_ready',
      completedAt: '2026-07-25T00:00:20.000Z',
      navigation: { attempted: true, attemptCount: 1 },
      workTabAcquisition: 'created',
      workTabDisposition: 'idle_reusable',
      observation: {
        searchInputVisible: true,
        resultListVisible: true,
        emptyStateVisible: false,
        resultType: 'comprehensive',
        sort: 'relevance',
        page: 1,
        semanticResultCardCount: 1,
        cards: [{
          bvid: 'BV1qZSLBYEpa',
          title: '公开视频',
          visibleText: '公开视频 创作者',
          thumbnailUrl: null
        }],
        loginOverlayVisible: false,
        risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
      }
    };
    expect(isExtensionWorkResultForItem(result, searchItem)).toBe(true);
    expect(isExtensionWorkResultForItem({
      ...result,
      terminalReason: 'search_empty'
    }, searchItem)).toBe(false);
  });

  test('binds public profile and inventory work to one exact MID and one derived first page', () => {
    expect(isExtensionWorkItem(accountProfileItem)).toBe(true);
    expect(isExtensionWorkItem(accountInventoryItem)).toBe(true);
    expect(isExtensionWorkItem({
      ...accountInventoryItem,
      input: { ...accountInventoryItem.input, canonicalInventoryUrl: 'https://space.bilibili.com/7481602/upload/video?p=2' }
    })).toBe(false);
    expect(isExtensionWorkItem({
      ...accountProfileItem,
      input: { ...accountProfileItem.input, stableAccountId: '1' }
    })).toBe(false);

    const profileResult: ExtensionWorkResult = {
      schemaVersion: 1,
      protocolVersion: 1,
      workId: accountProfileItem.workId,
      operationId: accountProfileItem.operationId,
      browserBindingId: accountProfileItem.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.account_profile',
      executionTarget: 'collector_work_tab',
      state: 'completed',
      errorCode: null,
      terminalReason: 'profile_ready',
      completedAt: '2026-07-25T00:00:20.000Z',
      navigation: { attempted: true, attemptCount: 1 },
      workTabAcquisition: 'created',
      workTabDisposition: 'idle_reusable',
      observation: {
        stableAccountId: '7481602',
        displayName: '公开 UP 主',
        visibleDescription: null,
        avatarUrl: null,
        bannerUrl: null,
        textBadges: [],
        imageBadges: [],
        statistics: [],
        navigation: [],
        announcementText: null,
        chargeText: null,
        highlights: [],
        profileHeaderVisible: true,
        loginOverlayVisible: false,
        risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
      }
    };
    expect(isExtensionWorkResultForItem(profileResult, accountProfileItem)).toBe(true);

    const inventoryResult: ExtensionWorkResult = {
      schemaVersion: 1,
      protocolVersion: 1,
      workId: accountInventoryItem.workId,
      operationId: accountInventoryItem.operationId,
      browserBindingId: accountInventoryItem.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.account_inventory',
      executionTarget: 'collector_work_tab',
      state: 'completed',
      errorCode: null,
      terminalReason: 'inventory_ready',
      completedAt: '2026-07-25T00:00:20.000Z',
      navigation: { attempted: true, attemptCount: 1 },
      workTabAcquisition: 'created',
      workTabDisposition: 'idle_reusable',
      observation: {
        stableAccountId: '7481602',
        videoListVisible: true,
        cards: [{
          bvid: 'BV1qZSLBYEpa',
          title: '公开视频',
          visibleText: '公开视频 创作者',
          thumbnailUrl: null
        }],
        loginOverlayVisible: false,
        risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
      }
    };
    expect(isExtensionWorkResultForItem(inventoryResult, accountInventoryItem)).toBe(true);
    expect(isExtensionWorkResultForItem({
      ...inventoryResult,
      observation: { ...inventoryResult.observation!, stableAccountId: '1' }
    }, accountInventoryItem)).toBe(false);
  });

  test('allows an explicitly selected inventory tab only as zero-navigation, zero-action work', () => {
    expect(isExtensionWorkItem(accountInventorySelectedTabItem)).toBe(true);
    expect(isExtensionWorkItem({
      ...accountInventorySelectedTabItem,
      budget: { ...accountInventorySelectedTabItem.budget, maximumPlatformNavigations: 1 }
    })).toBe(false);
    expect(isExtensionWorkItem({
      ...accountInventorySelectedTabItem,
      tabId: 42
    })).toBe(false);
    expect(isExtensionWorkItem({
      ...accountProfileItem,
      executionTarget: 'user_selected_tab'
    })).toBe(false);

    const result: ExtensionWorkResult = {
      schemaVersion: 1,
      protocolVersion: 1,
      workId: accountInventorySelectedTabItem.workId,
      operationId: accountInventorySelectedTabItem.operationId,
      browserBindingId: accountInventorySelectedTabItem.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.account_inventory',
      executionTarget: 'user_selected_tab',
      state: 'completed',
      errorCode: null,
      terminalReason: 'inventory_ready',
      completedAt: '2026-07-25T00:00:20.000Z',
      navigation: { attempted: false, attemptCount: 0 },
      userSelectedTabDisposition: 'observed',
      observation: {
        stableAccountId: '7481602',
        videoListVisible: true,
        cards: [{
          bvid: 'BV1qZSLBYEpa',
          title: '公开视频',
          visibleText: '公开视频 创作者',
          thumbnailUrl: null
        }],
        loginOverlayVisible: false,
        risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
      }
    };
    expect(isExtensionWorkResultForItem(result, accountInventorySelectedTabItem)).toBe(true);
    expect(isExtensionWorkResultForItem({
      ...result,
      navigation: { attempted: true, attemptCount: 1 }
    }, accountInventorySelectedTabItem)).toBe(false);
    expect(isExtensionWorkResultForItem({
      ...result,
      userSelectedTabDisposition: 'document_changed'
    }, accountInventorySelectedTabItem)).toBe(false);
  });

  test('allows an explicitly selected loaded discussion document only as a bounded passive projection', () => {
    expect(isExtensionWorkItem(discussionSelectedTabItem)).toBe(true);
    expect(isExtensionWorkItem({
      ...discussionSelectedTabItem,
      executionTarget: 'collector_work_tab'
    })).toBe(false);
    expect(isExtensionWorkItem({
      ...discussionSelectedTabItem,
      budget: { ...discussionSelectedTabItem.budget, maximumSemanticActions: 1 }
    })).toBe(false);
    expect(isExtensionWorkItem({ ...discussionSelectedTabItem, tabId: 42 })).toBe(false);

    const result: ExtensionWorkResult = {
      schemaVersion: 1,
      protocolVersion: 1,
      workId: discussionSelectedTabItem.workId,
      operationId: discussionSelectedTabItem.operationId,
      browserBindingId: discussionSelectedTabItem.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.discussion',
      executionTarget: 'user_selected_tab',
      state: 'completed',
      errorCode: null,
      terminalReason: 'discussion_ready',
      completedAt: '2026-07-25T00:00:20.000Z',
      navigation: { attempted: false, attemptCount: 0 },
      userSelectedTabDisposition: 'observed',
      observation: {
        bvid: 'BV1qZSLBYEpa',
        commentHostPresent: true,
        commentHostVisible: true,
        commentHostInViewport: true,
        commentContentState: 'ready',
        rootCommentTexts: ['已渲染的公开根评论'],
        sortControls: { hotVisible: true, latestVisible: true, latestState: 'inactive' },
        loginGateVisible: false,
        risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
      }
    };
    expect(isExtensionWorkResultForItem(result, discussionSelectedTabItem)).toBe(true);
    expect(isExtensionWorkResultForItem({
      ...result,
      navigation: { attempted: true, attemptCount: 1 }
    }, discussionSelectedTabItem)).toBe(false);
    expect(isExtensionWorkResultForItem({
      ...result,
      observation: { ...result.observation!, commentHostInViewport: false }
    }, discussionSelectedTabItem)).toBe(false);
    expect(isExtensionWorkResultForItem({
      ...result,
      observation: { ...result.observation!, bvid: 'BV1xx411c7mD' }
    }, discussionSelectedTabItem)).toBe(false);
  });
});
