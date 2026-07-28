import { describe, expect, test } from 'vitest';
import { parseXiaohongshuCurrentPageNetworkRecord } from '../src/background/xiaohongshu-current-page-network-state.js';

const base = {
  schemaVersion: 1, tabId: 1, windowId: 2, managedRunId: 'run-1', initialDocumentId: 'document-1',
  documentId: 'document-1', state: 'observing', selectedAt: '2026-07-28T12:00:00.000Z',
  expiresAt: '2026-07-28T12:01:00.000Z', navigationStarted: false, stopReason: null,
  observedRouteCount: 0, excludedRouteCounts: { authenticationOrIdentity: 0, securityOrRisk: 0,
    configurationOrTelemetry: 0, other: 0 },
  risk: { loginRequired: false, verificationRequired: false, rateLimited: false, sourceUnavailable: false }
};

describe('Xiaohongshu current-page observer persistence', () => {
  test.each(['explore', 'search', 'public_profile', 'public_note_detail'] as const)(
    'restores the admitted %s surface instead of silently dropping the observer binding', (publicSurface) => {
      expect(parseXiaohongshuCurrentPageNetworkRecord({ ...base, publicSurface }))
        .toMatchObject({ publicSurface, managedRunId: 'run-1', documentId: 'document-1' });
    });
});
