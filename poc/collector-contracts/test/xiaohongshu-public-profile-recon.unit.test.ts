import { describe, expect, test } from 'vitest';
import { isXiaohongshuPublicProfileReconRequest } from '../src/index.js';

const request = {
  schemaVersion: 1,
  profileId: 'xiaohongshu_validation',
  pageAlias: 'page-1',
  pageLeaseId: 'lease-1',
  runId: '11111111-1111-4111-8111-111111111111',
  expectedRecordVersion: 3,
  expectedDocumentGeneration: 2,
  actionId: '22222222-2222-4222-8222-222222222222',
  timeoutMs: 20_000
} as const;

describe('Xiaohongshu public-profile reconnaissance contract', () => {
  test('admits only fixed page-bound reconnaissance without caller browser controls', () => {
    expect(isXiaohongshuPublicProfileReconRequest(request)).toBe(true);
    expect(isXiaohongshuPublicProfileReconRequest({ ...request, expectedDocumentGeneration: 0 })).toBe(true);
    for (const extra of [
      { url: 'https://www.xiaohongshu.com/user/profile/x' },
      { selector: 'a' },
      { coordinate: { x: 1, y: 2 } },
      { script: 'document.body.innerHTML' },
      { tabId: 1 }
    ]) expect(isXiaohongshuPublicProfileReconRequest({ ...request, ...extra })).toBe(false);
  });
});
