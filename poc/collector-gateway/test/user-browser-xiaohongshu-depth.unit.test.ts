// Xiaohongshu search depth tiers: the delegated caller picks a semantic tier
// and the registry resolves it into concrete numbers before the work item is
// built, so a long tool loop cannot silently degrade to the minimum budget.

import { describe, expect, test } from 'vitest';
import { USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION } from '@intelligence/collector-contracts';
import { userBrowserCollectorServiceRequestInput } from '../src/user-browser-collector-service-contract.js';

const envelope = (input: Record<string, unknown>) => ({
  schemaVersion: USER_BROWSER_COLLECTOR_SERVICE_SCHEMA_VERSION,
  clientRequestId: '22222222-2222-4222-8222-222222222222',
  browserBindingId: '33333333-3333-4333-8333-333333333333',
  platform: 'xiaohongshu',
  capability: 'xiaohongshu.search.public_notes.v1',
  executionTarget: 'existing_public_explore_tab',
  input
});

describe('xiaohongshu search depth tiers', () => {
  test('standard tier resolves to a 5-detail chunk with 2 comment scrolls', () => {
    const request = userBrowserCollectorServiceRequestInput(envelope({ query: '咖啡', depth: 'standard' })) as {
      input: Record<string, unknown>;
    };
    expect(request.input).toEqual({ query: '咖啡', maximumDetails: 5, comments: { maximumScrolls: 2 } });
  });

  test('deep tier resolves to a 5-detail chunk with 3 comment scrolls', () => {
    const request = userBrowserCollectorServiceRequestInput(envelope({ query: '咖啡', depth: 'deep' })) as {
      input: Record<string, unknown>;
    };
    expect(request.input).toEqual({ query: '咖啡', maximumDetails: 5, comments: { maximumScrolls: 3 } });
  });

  test('explicit maximumDetails wins over the tier slice', () => {
    const request = userBrowserCollectorServiceRequestInput(envelope({ query: '咖啡', depth: 'deep', maximumDetails: 4 })) as {
      input: Record<string, unknown>;
    };
    expect(request.input).toEqual({ query: '咖啡', maximumDetails: 4, comments: { maximumScrolls: 3 } });
  });

  test('rejects a depth chunk above the per-operation MV3-safe ceiling', () => {
    expect(() => userBrowserCollectorServiceRequestInput(envelope({ query: '咖啡', maximumDetails: 6 }))).toThrow();
    expect(() => userBrowserCollectorServiceRequestInput(envelope({ query: '咖啡', depth: 'deep', maximumDetails: 20 }))).toThrow();
  });

  test('rejects an unknown tier', () => {
    expect(() => userBrowserCollectorServiceRequestInput(envelope({ query: '咖啡', depth: 'shallow' }))).toThrow();
  });

  test('rejects a tier resolved against breadth-only details', () => {
    expect(() => userBrowserCollectorServiceRequestInput(envelope({ query: '咖啡', depth: 'deep', maximumDetails: 0 }))).toThrow();
  });

  test('depth is stripped from the work item input', () => {
    const request = userBrowserCollectorServiceRequestInput(envelope({ query: '咖啡', depth: 'deep' })) as {
      input: Record<string, unknown>;
    };
    expect(Object.keys(request.input)).not.toContain('depth');
  });
});
