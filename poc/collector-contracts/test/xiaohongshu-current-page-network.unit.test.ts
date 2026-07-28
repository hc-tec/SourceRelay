import { describe, expect, test } from 'vitest';
import {
  XIAOHONGSHU_CURRENT_PAGE_NETWORK_BUDGET,
  XIAOHONGSHU_CURRENT_PAGE_NETWORK_CAPABILITY,
  XIAOHONGSHU_CURRENT_PAGE_NETWORK_POLICY,
  classifyXiaohongshuCurrentPageRisk,
  isXiaohongshuCurrentPageNetworkMetadataObservation,
  isXiaohongshuCurrentPageNetworkRequest
} from '../src/index.js';

describe('Xiaohongshu current-page network policy contract', () => {
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
      schemaVersion: 1,
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
});
