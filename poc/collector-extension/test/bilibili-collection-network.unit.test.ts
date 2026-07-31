import { describe, expect, test } from 'vitest';
import {
  boundedCollectionOverviewNetworkArmExpiry
} from '../src/background/extension-work-bilibili-collection-network.js';

describe('Bilibili collection overview network-arm deadline', () => {
  const now = Date.UTC(2026, 6, 31, 12, 0, 0);

  test('clips a two-minute work lease to the short-lived arm budget', () => {
    const workExpiresAt = new Date(now + 120_000).toISOString();

    expect(boundedCollectionOverviewNetworkArmExpiry(workExpiresAt, now)).toBe(now + 55_000);
  });

  test('preserves an earlier work expiry', () => {
    const workExpiresAt = new Date(now + 12_000).toISOString();

    expect(boundedCollectionOverviewNetworkArmExpiry(workExpiresAt, now)).toBe(now + 12_000);
  });

  test('returns an invalid deadline for malformed input', () => {
    expect(Number.isNaN(boundedCollectionOverviewNetworkArmExpiry('not-a-date', now))).toBe(true);
  });
});
