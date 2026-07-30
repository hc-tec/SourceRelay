import { describe, expect, test } from 'vitest';
import { listUserBrowserCapabilities } from '../src/user-browser-capabilities.js';
import {
  isUserBrowserExecutableCapability,
  listUserBrowserExecutableCapabilities,
  USER_BROWSER_CAPABILITY_REGISTRY
} from '../src/user-browser-capability-registry.js';
import {
  isUserBrowserArtifactCapability,
  listUserBrowserArtifactCapabilities
} from '../src/user-browser-artifact-reader-registry.js';

function directCatalogNames(): string[] {
  return listUserBrowserCapabilities()
    .filter((entry) => entry.dispatchState === 'direct_ready')
    .map((entry) => entry.capability);
}

describe('user-owned-browser capability registries', () => {
  test('dispatch registry covers exactly every direct-ready catalog capability', () => {
    const direct = new Set(directCatalogNames());
    const registered = new Set(listUserBrowserExecutableCapabilities());

    expect(registered).toEqual(direct);
    expect(Object.keys(USER_BROWSER_CAPABILITY_REGISTRY)).toHaveLength(15);
    for (const capability of direct) {
      expect(isUserBrowserExecutableCapability(capability)).toBe(true);
      expect(USER_BROWSER_CAPABILITY_REGISTRY[capability as keyof typeof USER_BROWSER_CAPABILITY_REGISTRY].capability)
        .toBe(capability);
    }
  });

  test('artifact registry has the same public boundary and no catalog-only fallback', () => {
    const direct = new Set(directCatalogNames());
    expect(new Set(listUserBrowserArtifactCapabilities())).toEqual(direct);

    expect(isUserBrowserArtifactCapability('xiaohongshu.current_page.network_metadata')).toBe(false);
    expect(isUserBrowserArtifactCapability('bilibili.account_inventory.pagination')).toBe(false);
    expect(isUserBrowserArtifactCapability('bilibili.transcript')).toBe(false);
  });
});

