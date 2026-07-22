import {
  BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_MAX_TARGET_PAGE,
  BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_SCHEMA_VERSION,
  type BilibiliAccountVideoPageClickRequest
} from '@intelligence/collector-contracts';
import { describe, expect, test } from 'vitest';
import { validateTrustedBilibiliAccountVideoPageClickRequest } from '../src/page-ledger/trusted-bilibili-account-video-page-click.js';

function request(overrides: Partial<BilibiliAccountVideoPageClickRequest> = {}): BilibiliAccountVideoPageClickRequest {
  return {
    schemaVersion: BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_SCHEMA_VERSION,
    profileId: '11111111-1111-4111-8111-111111111111',
    pageAlias: 'managed-page-1',
    pageLeaseId: '22222222-2222-4222-8222-222222222222',
    runId: '33333333-3333-4333-8333-333333333333',
    expectedRecordVersion: 5,
    expectedDocumentGeneration: 2,
    actionId: 'advance_account_video_page_3',
    expectedActivePage: 2,
    targetPage: 3,
    timeoutMs: 5_000,
    ...overrides
  };
}

describe('Trusted Bilibili account-video pagination action', () => {
  test('admits only one adjacent page advance within the fixed source-specific bound', () => {
    expect(() => validateTrustedBilibiliAccountVideoPageClickRequest(request())).not.toThrow();
    expect(() => validateTrustedBilibiliAccountVideoPageClickRequest(request({
      expectedActivePage: BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_MAX_TARGET_PAGE - 1,
      targetPage: BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_MAX_TARGET_PAGE
    }))).not.toThrow();
  });

  test('rejects skips, backwards targets, and attempts beyond the Host hard bound before browser input', () => {
    expect(() => validateTrustedBilibiliAccountVideoPageClickRequest(request({ targetPage: 4 }))).toThrow(
      'bilibili_page_click_target_rejected'
    );
    expect(() => validateTrustedBilibiliAccountVideoPageClickRequest(request({ targetPage: 2 }))).toThrow(
      'bilibili_page_click_target_rejected'
    );
    expect(() => validateTrustedBilibiliAccountVideoPageClickRequest(request({
      expectedActivePage: BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_MAX_TARGET_PAGE,
      targetPage: BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_MAX_TARGET_PAGE + 1
    }))).toThrow('bilibili_page_click_target_rejected');
  });
});
