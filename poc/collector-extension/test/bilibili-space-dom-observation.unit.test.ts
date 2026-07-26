import { describe, expect, test } from 'vitest';
import {
  BILIBILI_SPACE_DOM_OBSERVATION_MAX_MS,
  boundedBilibiliSpaceDomObservationDeadline
} from '../src/background/extension-work-bilibili-space-observation.js';

describe('Bilibili space DOM observation deadline', () => {
  const now = Date.UTC(2026, 6, 26, 6, 0, 0);

  test('permits a bounded passive render window when the signed work remains valid', () => {
    const expiry = new Date(now + 60_000).toISOString();

    expect(boundedBilibiliSpaceDomObservationDeadline(expiry, now))
      .toBe(now + BILIBILI_SPACE_DOM_OBSERVATION_MAX_MS);
  });

  test('never extends a signed work item past its own expiry', () => {
    const expiry = new Date(now + 12_000).toISOString();

    expect(boundedBilibiliSpaceDomObservationDeadline(expiry, now)).toBe(now + 12_000);
  });

  test('fails closed for an invalid expiry rather than creating an unbounded wait', () => {
    expect(boundedBilibiliSpaceDomObservationDeadline('not-a-timestamp', now)).toBe(now);
  });
});
