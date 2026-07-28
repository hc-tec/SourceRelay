import { describe, expect, test } from 'vitest';
import { isXiaohongshuTrustedSearchRequest } from '../src/index.js';

const valid = {
  schemaVersion: 1,
  profileId: 'xiaohongshu_validation',
  pageAlias: 'page-1',
  pageLeaseId: 'lease-123',
  runId: 'run-123',
  expectedRecordVersion: 3,
  expectedDocumentGeneration: 2,
  actionId: 'xiaohongshu-search-once',
  query: '咖啡',
  timeoutMs: 20_000
};

describe('Xiaohongshu trusted in-page search contract', () => {
  test('accepts the exact PageLease, query and bounded action budget', () => {
    expect(isXiaohongshuTrustedSearchRequest(valid)).toBe(true);
  });

  test('rejects every caller-controlled browser or navigation carrier', () => {
    for (const hidden of [
      { url: 'https://www.xiaohongshu.com/search_result_ai?keyword=x' },
      { selector: '#search-input' },
      { script: 'location.href = value' },
      { tabId: 11 },
      { documentId: 'document-1' },
      { coordinate: { x: 10, y: 20 } },
      { route: '/api/sns/web/v1/search/notes' }
    ]) {
      expect(isXiaohongshuTrustedSearchRequest({ ...valid, ...hidden })).toBe(false);
    }
  });

  test('rejects unsafe query and timing shapes', () => {
    expect(isXiaohongshuTrustedSearchRequest({ ...valid, query: ' 咖啡' })).toBe(false);
    expect(isXiaohongshuTrustedSearchRequest({ ...valid, query: '' })).toBe(false);
    expect(isXiaohongshuTrustedSearchRequest({ ...valid, query: 'x'.repeat(81) })).toBe(false);
    expect(isXiaohongshuTrustedSearchRequest({ ...valid, query: 'a\nb' })).toBe(false);
    expect(isXiaohongshuTrustedSearchRequest({ ...valid, timeoutMs: 60_000 })).toBe(false);
  });
});
