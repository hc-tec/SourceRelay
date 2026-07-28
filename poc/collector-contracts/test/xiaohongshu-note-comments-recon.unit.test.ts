import { describe, expect, test } from 'vitest';
import { isXiaohongshuNoteCommentsReconRequest } from '../src/xiaohongshu-note-comments-recon.js';

const request = {
  schemaVersion: 1,
  profileId: 'xiaohongshu_validation',
  pageAlias: 'public-search-1',
  pageLeaseId: '11111111-1111-4111-8111-111111111111',
  runId: '22222222-2222-4222-8222-222222222222',
  expectedRecordVersion: 8,
  expectedDocumentGeneration: 6,
  actionId: '33333333-3333-4333-8333-333333333333',
  timeoutMs: 25_000
};

describe('Xiaohongshu note-comments reconnaissance contract', () => {
  test('accepts only the fixed leased-page action envelope', () => {
    expect(isXiaohongshuNoteCommentsReconRequest(request)).toBe(true);
    for (const extra of [
      { url: 'https://www.xiaohongshu.com/explore/x' }, { selector: '.comments' },
      { coordinate: { x: 1, y: 2 } }, { tabId: 7 }, { script: 'scrollTop=999' }
    ]) expect(isXiaohongshuNoteCommentsReconRequest({ ...request, ...extra })).toBe(false);
  });
});
