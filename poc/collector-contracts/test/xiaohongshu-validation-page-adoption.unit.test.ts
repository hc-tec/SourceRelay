import { describe, expect, test } from 'vitest';
import {
  isXiaohongshuValidationPageAdoptionRequest,
  XIAOHONGSHU_VALIDATION_PAGE_ADOPTION_MAX_LEASE_MS
} from '../src/index.js';

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

  test('allows the bounded five-minute composed validation lease, but no more', () => {
    expect(isXiaohongshuValidationPageAdoptionRequest({
      ...request,
      leaseDurationMs: XIAOHONGSHU_VALIDATION_PAGE_ADOPTION_MAX_LEASE_MS
    })).toBe(true);
    expect(isXiaohongshuValidationPageAdoptionRequest({
      ...request,
      leaseDurationMs: XIAOHONGSHU_VALIDATION_PAGE_ADOPTION_MAX_LEASE_MS + 1
    })).toBe(false);
  });
});
