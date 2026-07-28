import { describe, expect, test } from 'vitest';
import { isXiaohongshuValidationPageAdoptionRequest } from '../src/index.js';

const request = {
  schemaVersion: 1,
  profileId: 'xiaohongshu_validation',
  taskId: 'profile-recon',
  runId: '11111111-1111-4111-8111-111111111111',
  leaseDurationMs: 60_000
} as const;

describe('Xiaohongshu validation-page adoption contract', () => {
  test('cannot identify a URL, tab or selector from the caller', () => {
    expect(isXiaohongshuValidationPageAdoptionRequest(request)).toBe(true);
    for (const extra of [{ url: 'https://example.com' }, { tabId: 1 }, { selector: 'a' }]) {
      expect(isXiaohongshuValidationPageAdoptionRequest({ ...request, ...extra })).toBe(false);
    }
  });
});
