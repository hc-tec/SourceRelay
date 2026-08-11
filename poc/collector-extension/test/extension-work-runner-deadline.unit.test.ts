import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ExtensionWorkItem, GatewayPairingRecord } from '@intelligence/collector-contracts';

const originalChrome = globalThis.chrome;

afterEach(() => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: originalChrome
  });
  vi.useRealTimers();
  vi.resetModules();
});

function nativeSearchWork(expiresAt: string): ExtensionWorkItem {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    workId: '11111111-1111-4111-8111-111111111111',
    operationId: '22222222-2222-4222-8222-222222222222',
    browserBindingId: '33333333-3333-4333-8333-333333333333',
    platform: 'bilibili',
    capability: 'bilibili.native_search',
    executionTarget: 'collector_work_tab',
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt,
    input: {
      query: '研发效能',
      canonicalSearchUrl: 'https://search.bilibili.com/all?keyword=%E7%A0%94%E5%8F%91%E6%95%88%E8%83%BD',
      resultType: 'comprehensive',
      sort: 'relevance',
      page: 1
    },
    budget: {
      maximumPlatformNavigations: 1,
      maximumSemanticActions: 0,
      maximumResponseObservations: 0,
      maximumPayloadBytes: 98_304
    },
    gatewaySignature: 'a'.repeat(86)
  };
}

function installChromeMock() {
  const tabs = new Map<number, { id: number; windowId: number; active: boolean; url: string }>([
    [1, { id: 1, windowId: 9, active: true, url: 'https://example.test/' }]
  ]);
  const sessionData = new Map<string, unknown>();
  const localData = new Map<string, unknown>();
  const reload = vi.fn();
  let nextTabId = 2;

  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      tabs: {
        create: vi.fn(async (properties: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab> => {
          const tab = { id: nextTabId++, windowId: 9, active: properties.active === true, url: properties.url ?? 'about:blank' };
          tabs.set(tab.id, tab);
          return { ...tab } as unknown as chrome.tabs.Tab;
        }),
        get: vi.fn(async (tabId: number): Promise<chrome.tabs.Tab> => {
          const tab = tabs.get(tabId);
          if (!tab) throw new Error('No tab with id');
          return { ...tab } as unknown as chrome.tabs.Tab;
        }),
        remove: vi.fn(async (tabId: number) => {
          tabs.delete(tabId);
        }),
        update: vi.fn(async (tabId: number, properties: chrome.tabs.UpdateProperties): Promise<chrome.tabs.Tab> => {
          const tab = tabs.get(tabId);
          if (!tab) throw new Error('No tab with id');
          if (properties.active === true) tab.active = true;
          if (typeof properties.url === 'string') tab.url = properties.url;
          return { ...tab } as unknown as chrome.tabs.Tab;
        }),
        onActivated: { addListener: vi.fn() },
        onRemoved: { addListener: vi.fn() },
        onMoved: { addListener: vi.fn() },
        onUpdated: { addListener: vi.fn() }
      },
      windows: {
        update: vi.fn(async () => ({ id: 9, focused: true }) as unknown as chrome.windows.Window),
        get: vi.fn(async () => ({ id: 9, focused: true }) as unknown as chrome.windows.Window)
      },
      storage: {
        session: {
          get: vi.fn(async (key: string) => ({ [key]: sessionData.get(key) })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(items)) sessionData.set(key, value);
          }),
          remove: vi.fn(async (key: string) => {
            sessionData.delete(key);
          })
        },
        local: {
          get: vi.fn(async (key: string) => ({ [key]: localData.get(key) })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(items)) localData.set(key, value);
          }),
          remove: vi.fn(async (key: string) => {
            localData.delete(key);
          })
        }
      },
      runtime: { reload },
      webNavigation: { getFrame: vi.fn(async () => null) },
      alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } }
    }
  });
  return { tabs, sessionData, reload };
}

describe('runner signed-deadline guard', () => {
  test('recovers a hung executor after the deadline without reloading the extension', async () => {
    vi.useFakeTimers();
    const { tabs, reload } = installChromeMock();
    (globalThis as unknown as { __COLLECTOR_EXTENSION_BUILD_FINGERPRINT__: string }).__COLLECTOR_EXTENSION_BUILD_FINGERPRINT__ = 'a'.repeat(64);
    const tabsModule = await import('../src/background/extension-work-tabs.js');
    const storage = await import('../src/background/extension-work-storage.js');
    const runner = await import('../src/background/extension-work-runner.js');

    const lease = await tabsModule.acquireExtensionWorkTab();
    const item = nativeSearchWork(new Date(Date.now() + 150).toISOString());
    await storage.saveActiveExtensionWork({
      schemaVersion: 1,
      item,
      phase: 'claimed',
      navigationIntentCount: 0,
      workTabAcquisition: lease.acquisition
    });

    const hungRunner = vi.fn(async () => new Promise<never>(() => undefined));
    const pending = runner.executeWithinSignedDeadline(
      item,
      { browserBindingId: item.browserBindingId } as GatewayPairingRecord,
      hungRunner as never
    );
    const assertion = pending.then((result) => {
      expect(result.state).toBe('stopped');
      expect(result.errorCode).toBe('extension_worker_interrupted_before_navigation');
      expect(reload).not.toHaveBeenCalled();
    });
    await vi.advanceTimersByTimeAsync(500);
    await assertion;

    // The held blank work-tab lease must be released without a reload.
    expect(tabs.has(lease.tabId)).toBe(false);
    expect((globalThis.chrome.tabs.remove as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(lease.tabId);
  });

  test('passes through a normal executor result before the deadline', async () => {
    const { reload } = installChromeMock();
    (globalThis as unknown as { __COLLECTOR_EXTENSION_BUILD_FINGERPRINT__: string }).__COLLECTOR_EXTENSION_BUILD_FINGERPRINT__ = 'a'.repeat(64);
    const runner = await import('../src/background/extension-work-runner.js');
    const item = nativeSearchWork(new Date(Date.now() + 60_000).toISOString());
    const fastRunner = vi.fn(async () => ({
      schemaVersion: 1,
      protocolVersion: 1,
      workId: item.workId,
      operationId: item.operationId,
      browserBindingId: item.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.native_search',
      executionTarget: 'collector_work_tab',
      state: 'completed',
      errorCode: null,
      terminalReason: 'search_ready',
      completedAt: new Date().toISOString(),
      navigation: { attempted: true, attemptCount: 1 },
      workTabAcquisition: 'created',
      workTabDisposition: 'idle_reusable',
      observation: null
    }));

    const result = await runner.executeWithinSignedDeadline(
      item,
      { browserBindingId: item.browserBindingId } as GatewayPairingRecord,
      fastRunner as never
    );
    expect(result.state).toBe('completed');
    expect(reload).not.toHaveBeenCalled();
  });
});