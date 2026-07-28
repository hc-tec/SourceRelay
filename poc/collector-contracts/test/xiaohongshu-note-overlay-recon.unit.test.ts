import { describe, expect, test } from 'vitest';
import { isXiaohongshuNoteOverlayReconRequest } from '../src/xiaohongshu-note-overlay-recon.js';

const request = {
  schemaVersion: 1,
  profileId: 'xiaohongshu_validation',
  pageAlias: 'public-search-1',
  pageLeaseId: '11111111-1111-4111-8111-111111111111',
  runId: '22222222-2222-4222-8222-222222222222',
  expectedRecordVersion: 4,
  expectedDocumentGeneration: 1,
  actionId: '33333333-3333-4333-8333-333333333333',
  timeoutMs: 25_000
};

describe('Xiaohongshu note-overlay reconnaissance contract', () => {
  test('accepts only the fixed leased-page action envelope', () => {
    expect(isXiaohongshuNoteOverlayReconRequest(request)).toBe(true);
    for (const extra of [
      { url: 'https://www.xiaohongshu.com/explore/secret' },
      { selector: 'section.note-item' },
      { coordinate: { x: 1, y: 2 } },
      { tabId: 7 },
      { script: 'document.body' }
    ]) expect(isXiaohongshuNoteOverlayReconRequest({ ...request, ...extra })).toBe(false);
  });

  test('rejects invalid budgets and caller-controlled identifiers', () => {
    expect(isXiaohongshuNoteOverlayReconRequest({ ...request, timeoutMs: 4_999 })).toBe(false);
    expect(isXiaohongshuNoteOverlayReconRequest({ ...request, timeoutMs: 30_001 })).toBe(false);
    expect(isXiaohongshuNoteOverlayReconRequest({ ...request, pageAlias: '../escape' })).toBe(false);
  });
});
