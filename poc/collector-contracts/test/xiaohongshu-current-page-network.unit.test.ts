import { describe, expect, test } from 'vitest';
import {
  XIAOHONGSHU_CURRENT_PAGE_NETWORK_BUDGET,
  XIAOHONGSHU_CURRENT_PAGE_NETWORK_CAPABILITY,
  XIAOHONGSHU_CURRENT_PAGE_NETWORK_POLICY,
  classifyXiaohongshuCurrentPageRisk,
  isXiaohongshuCurrentPageNetworkObservationResult,
  isXiaohongshuCurrentPageNetworkMetadataObservation,
  isXiaohongshuCurrentPageNetworkRequest,
  isXiaohongshuManagedPageNetworkObservationResult,
  isXiaohongshuManagedPageNetworkObserverArmResult,
  isXiaohongshuManagedPageNetworkObserverRequest,
  isXiaohongshuManagedProfileNotesProjectionResult,
  isXiaohongshuManagedSearchProjectionResult,
  canonicalXiaohongshuPublicProfileUrl,
  xiaohongshuCurrentPageNetworkPublicSurface
} from '../src/index.js';

describe('Xiaohongshu current-page network policy contract', () => {
  test('validates a profile link without rewriting its short-lived query signature', () => {
    const profileUrl = 'https://www.xiaohongshu.com/user/profile/abc123?xsec_token=a%2Fb%3Dc&xsec_source=pc';
    expect(canonicalXiaohongshuPublicProfileUrl(profileUrl)).toBe(profileUrl);
    expect(canonicalXiaohongshuPublicProfileUrl(` ${profileUrl}`)).toBeNull();
  });

  test('makes the initial capability current-page-only and permanently actionless', () => {
    expect(XIAOHONGSHU_CURRENT_PAGE_NETWORK_POLICY).toMatchObject({
      platform: 'xiaohongshu',
      capability: XIAOHONGSHU_CURRENT_PAGE_NETWORK_CAPABILITY,
      executionTarget: 'user_selected_tab',
      accountScopedSurfaces: 'forbidden',
      requiresExplicitCurrentPageSelection: true,
      requiresPrearmedSameDocumentObserver: true,
      responseBodies: 'not_read'
    });
    expect(XIAOHONGSHU_CURRENT_PAGE_NETWORK_BUDGET).toEqual({
      maximumPlatformNavigations: 0,
      maximumPageReloads: 0,
      maximumPageInitiatedNewDocuments: 0,
      maximumSemanticActions: 0,
      maximumNetworkResponseBodies: 0,
      maximumNetworkMetadataObservations: 24,
      maximumRawPayloadBytes: 0
    });
  });

  test('accepts no caller-controlled URL, selector, route, tab or action carrier', () => {
    const valid = {
      schemaVersion: 2,
      platform: 'xiaohongshu',
      capability: XIAOHONGSHU_CURRENT_PAGE_NETWORK_CAPABILITY,
      executionTarget: 'user_selected_tab',
      input: {}
    };
    expect(isXiaohongshuCurrentPageNetworkRequest(valid)).toBe(true);
    expect(isXiaohongshuCurrentPageNetworkRequest({
      ...valid,
      input: { canonicalUrl: 'https://www.xiaohongshu.com/explore' }
    })).toBe(false);
    expect(isXiaohongshuCurrentPageNetworkRequest({ ...valid, selector: '.note-card' })).toBe(false);
    expect(isXiaohongshuCurrentPageNetworkRequest({ ...valid, executionTarget: 'collector_work_tab' })).toBe(false);
  });

  test('permits only body-free, categorised metadata observations', () => {
    const observation = {
      observerState: 'armed_same_document',
      publicContentRouteCount: 0,
      excludedRouteCounts: {
        authenticationOrIdentity: 2,
        securityOrRisk: 3,
        configurationOrTelemetry: 4,
        other: 0
      },
      responseBodiesRead: false,
      rawPayloadBytesRead: 0,
      risk: {
        loginRequired: true,
        verificationRequired: false,
        rateLimited: false,
        sourceUnavailable: false
      }
    };
    expect(isXiaohongshuCurrentPageNetworkMetadataObservation(observation)).toBe(true);
    expect(isXiaohongshuCurrentPageNetworkMetadataObservation({
      ...observation,
      responseBodiesRead: true
    })).toBe(false);
    expect(isXiaohongshuCurrentPageNetworkMetadataObservation({
      ...observation,
      rawPayloadBytesRead: 1
    })).toBe(false);
    expect(isXiaohongshuCurrentPageNetworkMetadataObservation({
      ...observation,
      route: '/api/sns/web/v1/anything'
    })).toBe(false);
    expect(isXiaohongshuCurrentPageNetworkMetadataObservation({
      ...observation,
      excludedRouteCounts: {
        authenticationOrIdentity: 24,
        securityOrRisk: 1,
        configurationOrTelemetry: 0,
        other: 0
      }
    })).toBe(false);
  });

  test('stops on the observed verification route without mistaking SMS login copy for a captcha', () => {
    expect(classifyXiaohongshuCurrentPageRisk({
      pathname: '/website-login/captcha',
      title: '安全验证',
      visibleText: '为保护账号安全，请使用已登录该账号的小红书 APP 扫码验证身份'
    })).toEqual({
      loginRequired: false,
      verificationRequired: true,
      rateLimited: false,
      sourceUnavailable: false
    });
    expect(classifyXiaohongshuCurrentPageRisk({
      pathname: '/explore',
      title: '小红书 - 你的生活兴趣社区',
      visibleText: '手机号登录 获取验证码 登录后推荐更懂你的笔记'
    })).toEqual({
      loginRequired: true,
      verificationRequired: false,
      rateLimited: false,
      sourceUnavailable: false
    });
  });

  test('does not mistake public risk-control content for a platform rate limit', () => {
    expect(classifyXiaohongshuCurrentPageRisk({
      pathname: '/search_result_ai',
      title: '人工智能 - 小红书搜索',
      visibleText: '人工智能在金融风控、风险识别和客户服务中的应用'
    }).rateLimited).toBe(false);
    expect(classifyXiaohongshuCurrentPageRisk({
      pathname: '/search_result',
      title: '小红书搜索',
      visibleText: '请求过于频繁，请稍后再试'
    }).rateLimited).toBe(true);
  });

  test('recognises only the initial public Explore or search surface without retaining URL data', () => {
    expect(xiaohongshuCurrentPageNetworkPublicSurface('https://www.xiaohongshu.com/explore')).toBe('explore');
    expect(xiaohongshuCurrentPageNetworkPublicSurface('https://www.xiaohongshu.com/search_result?keyword=%E6%B5%8B%E8%AF%95'))
      .toBe('search');
    expect(xiaohongshuCurrentPageNetworkPublicSurface('https://www.xiaohongshu.com/search_result_ai?keyword=%E6%B5%8B%E8%AF%95'))
      .toBe('search');
    expect(xiaohongshuCurrentPageNetworkPublicSurface('https://www.xiaohongshu.com/explore/abc123')).toBeNull();
    expect(xiaohongshuCurrentPageNetworkPublicSurface('https://www.xiaohongshu.com/settings')).toBeNull();
    expect(xiaohongshuCurrentPageNetworkPublicSurface('https://api.xiaohongshu.com/explore')).toBeNull();
  });

  test('admits only a de-sensitised selected-page metadata result', () => {
    const result = {
      schemaVersion: 2,
      type: 'xiaohongshu_current_page_network_observation',
      permissionState: 'permission_granted',
      selection: {
        state: 'observing',
        publicSurface: 'explore',
        selectedAt: '2026-07-28T00:00:00.000Z',
        expiresAt: '2026-07-28T00:01:00.000Z'
      },
      observation: {
        observerState: 'armed_same_document',
        publicContentRouteCount: 0,
        excludedRouteCounts: {
          authenticationOrIdentity: 0,
          securityOrRisk: 1,
          configurationOrTelemetry: 0,
          other: 2
        },
        responseBodiesRead: false,
        rawPayloadBytesRead: 0,
        risk: {
          loginRequired: false,
          verificationRequired: false,
          rateLimited: false,
          sourceUnavailable: false
        }
      }
    };
    expect(isXiaohongshuCurrentPageNetworkObservationResult(result)).toBe(true);
    expect(isXiaohongshuCurrentPageNetworkObservationResult({
      ...result,
      tabId: 99
    })).toBe(false);
    expect(isXiaohongshuCurrentPageNetworkObservationResult({
      ...result,
      permissionState: 'granted'
    })).toBe(false);
    expect(isXiaohongshuCurrentPageNetworkObservationResult({
      ...result,
      selection: { ...result.selection, canonicalUrl: 'https://www.xiaohongshu.com/explore' }
    })).toBe(false);
    expect(isXiaohongshuCurrentPageNetworkObservationResult({
      ...result,
      selection: { state: 'not_selected', publicSurface: null, selectedAt: '2026-07-28T00:00:00.000Z', expiresAt: null }
    })).toBe(false);
  });

  test('binds managed validation only by exact PageLease identity', () => {
    const request = {
      schemaVersion: 2,
      profileId: 'xiaohongshu_validation',
      pageAlias: 'page-1',
      pageLeaseId: 'lease-123',
      expectedRecordVersion: 1,
      runId: 'run-123'
    };
    expect(isXiaohongshuManagedPageNetworkObserverRequest(request)).toBe(true);
    for (const hiddenCarrier of [
      { url: 'https://www.xiaohongshu.com/explore' },
      { tabId: 11 },
      { selector: '.note-card' },
      { script: 'location.reload()' },
      { route: '/api/sns/web/v1/search/notes' }
    ]) {
      expect(isXiaohongshuManagedPageNetworkObserverRequest({ ...request, ...hiddenCarrier })).toBe(false);
    }
  });

  test('admits correlated managed arm and observation results without browser identity', () => {
    const selection = {
      state: 'armed_next_document',
      publicSurface: null,
      selectedAt: '2026-07-28T00:00:00.000Z',
      expiresAt: '2026-07-28T00:01:00.000Z'
    };
    const arm = {
      schemaVersion: 2,
      type: 'xiaohongshu_managed_page_network_observer_armed',
      pageAlias: 'page-1',
      runId: 'run-123',
      permissionState: 'permission_granted',
      selection
    };
    expect(isXiaohongshuManagedPageNetworkObserverArmResult(arm)).toBe(true);
    expect(isXiaohongshuManagedPageNetworkObserverArmResult({ ...arm, tabId: 11 })).toBe(false);
    const observation = {
      ...arm,
      type: 'xiaohongshu_managed_page_network_observation',
      observation: {
        observerState: 'not_armed',
        publicContentRouteCount: 0,
        excludedRouteCounts: {
          authenticationOrIdentity: 0,
          securityOrRisk: 0,
          configurationOrTelemetry: 0,
          other: 0
        },
        responseBodiesRead: false,
        rawPayloadBytesRead: 0,
        risk: {
          loginRequired: false,
          verificationRequired: false,
          rateLimited: false,
          sourceUnavailable: false
        }
      }
    };
    expect(isXiaohongshuManagedPageNetworkObservationResult(observation)).toBe(true);
    expect(isXiaohongshuManagedPageNetworkObservationResult({ ...observation, documentId: 'private' })).toBe(false);
  });

  test('admits only bounded URL-free public Xiaohongshu search projections', () => {
    const result = {
      schemaVersion: 2,
      type: 'xiaohongshu_managed_search_projection',
      pageAlias: 'page-1',
      runId: 'run-123',
      matchedPayloadCount: 1,
      bodyBytesRead: 4096,
      rawPayloadStored: false,
      responseUrlsStored: false,
      items: [{
        rank: 1,
        noteId: 'public-note-id',
        title: '公开笔记标题',
        contentType: 'normal',
        authorId: 'public-author-id',
        authorNickname: '公开昵称',
        likedCountText: '123'
      }]
    };
    expect(isXiaohongshuManagedSearchProjectionResult(result)).toBe(true);
    expect(isXiaohongshuManagedSearchProjectionResult({
      ...result,
      responseUrl: 'https://www.xiaohongshu.com/search_result_ai?keyword=private'
    })).toBe(false);
    expect(isXiaohongshuManagedSearchProjectionResult({
      ...result,
      items: [{ ...result.items[0], xsecToken: 'private' }]
    })).toBe(false);
  });

  test('accepts additive public detail projections without admitting route or credential fields', () => {
    const result = {
      schemaVersion: 2,
      type: 'xiaohongshu_managed_search_projection',
      pageAlias: 'page-1',
      runId: 'run-123',
      matchedPayloadCount: 1,
      bodyBytesRead: 4096,
      rawPayloadStored: false,
      responseUrlsStored: false,
      items: [{
        rank: 1,
        noteId: 'public-note-id',
        title: '公开笔记标题',
        contentType: 'normal',
        authorId: 'public-author-id',
        authorNickname: '公开昵称',
        likedCountText: '123'
      }],
      details: [{
        noteId: 'public-note-id',
        publicText: '公开正文与描述',
        authorNickname: '公开昵称',
        interactionText: '赞 123 收藏 45'
      }]
    };
    expect(isXiaohongshuManagedSearchProjectionResult(result)).toBe(true);
    expect(isXiaohongshuManagedSearchProjectionResult({
      ...result,
      details: [{ ...result.details[0], responseUrl: 'https://www.xiaohongshu.com/api/private' }]
    })).toBe(false);
    expect(isXiaohongshuManagedSearchProjectionResult({
      ...result,
      details: [{ ...result.details[0], publicText: '' }]
    })).toBe(false);
  });

  test('keeps profile-link inventory at its larger bounded projection while search stays first-page bounded', () => {
    const item = {
      rank: 1,
      noteId: 'profile-note-1',
      title: '公开主页笔记',
      contentType: 'normal',
      authorId: 'public-author-id',
      authorNickname: '公开昵称',
      likedCountText: '123'
    };
    const profile = {
      schemaVersion: 2,
      type: 'xiaohongshu_managed_profile_notes_projection',
      pageAlias: 'profile-work',
      runId: 'profile-work',
      matchedPayloadCount: 1,
      bodyBytesRead: 4096,
      rawPayloadStored: false,
      responseUrlsStored: false,
      items: Array.from({ length: 200 }, (_, index) => ({ ...item,
        rank: index + 1, noteId: `profile-note-${index + 1}` }))
    };
    expect(isXiaohongshuManagedProfileNotesProjectionResult(profile)).toBe(true);
    expect(isXiaohongshuManagedProfileNotesProjectionResult({
      ...profile,
      items: [...profile.items, { ...item, rank: 201, noteId: 'profile-note-201' }]
    })).toBe(false);
    expect(isXiaohongshuManagedSearchProjectionResult({
      schemaVersion: 2,
      type: 'xiaohongshu_managed_search_projection',
      pageAlias: 'search-work',
      runId: 'search-work',
      matchedPayloadCount: 1,
      bodyBytesRead: 4096,
      rawPayloadStored: false,
      responseUrlsStored: false,
      items: Array.from({ length: 41 }, (_, index) => ({ ...item,
        rank: index + 1, noteId: `search-note-${index + 1}` }))
    })).toBe(false);
  });

});
