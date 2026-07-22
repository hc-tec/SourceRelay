import { BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_SCHEMA_VERSION } from '@intelligence/collector-contracts';
import { describe, expect, test } from 'vitest';
import { bilibiliAccountVideoPageClickResponse } from '../src/browser-host-runtime.js';

function response(schemaVersion: number = BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_SCHEMA_VERSION): unknown {
  return {
    schemaVersion,
    clickAttempted: true,
    pageAlias: 'page-1',
    actionId: 'advance_account_video_page_2',
    before: {},
    after: {},
    network: {}
  };
}

describe('Browser Host pagination wire response', () => {
  test('accepts the current trusted-page-click schema rather than the retired page-two schema', () => {
    expect(bilibiliAccountVideoPageClickResponse(response())).toMatchObject({
      schemaVersion: BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_SCHEMA_VERSION,
      clickAttempted: true,
      actionId: 'advance_account_video_page_2'
    });
  });

  test('rejects a stale result before a caller can treat the click as a normal data failure', () => {
    expect(() => bilibiliAccountVideoPageClickResponse(response(1))).toThrow(
      'browser_host_bilibili_page_click_response_invalid'
    );
  });
});
