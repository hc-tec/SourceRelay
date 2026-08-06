import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ExtensionWorkItem } from '@intelligence/collector-contracts';

const originalChrome = globalThis.chrome;

afterEach(() => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: originalChrome
  });
  vi.resetModules();
});

function videoDetailWork(): Extract<ExtensionWorkItem, { capability: 'bilibili.video_detail' }> {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    workId: '11111111-1111-4111-8111-111111111111',
    operationId: '22222222-2222-4222-8222-222222222222',
    browserBindingId: '33333333-3333-4333-8333-333333333333',
    platform: 'bilibili',
    capability: 'bilibili.video_detail',
    executionTarget: 'collector_work_tab',
    issuedAt: '2026-07-27T00:00:00.000Z',
    expiresAt: '2099-07-27T00:00:00.000Z',
    input: {
      canonicalVideoUrl: 'https://www.bilibili.com/video/BV1qZSLBYEpa',
      bvid: 'BV1qZSLBYEpa'
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

interface MockTab {
  id: number;
  windowId: number;
  active: boolean;
  url: string;
}

function installChromeTabsMock(input: { foregroundAvailable?: boolean } = {}) {
  const tabs = new Map<number, MockTab>([
    [1, { id: 1, windowId: 9, active: true, url: 'https://example.test/' }]
  ]);
  const activatedListeners: Array<(info: chrome.tabs.TabActiveInfo) => void> = [];
  const removedListeners: Array<(tabId: number) => void> = [];
  const movedListeners: Array<(tabId: number) => void> = [];
  const updatedListeners: Array<(tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => void> = [];
  const sessionData = new Map<string, unknown>();
  let nextTabId = 2;
  let windowFocused = false;

  const copy = (tab: MockTab): chrome.tabs.Tab => ({ ...tab } as unknown as chrome.tabs.Tab);
  const activate = (tabId: number) => {
    const tab = tabs.get(tabId);
    if (!tab) throw new Error('no_such_tab');
    for (const candidate of tabs.values()) {
      if (candidate.windowId === tab.windowId) candidate.active = candidate.id === tab.id;
    }
    for (const listener of activatedListeners) listener({ tabId: tab.id, windowId: tab.windowId });
  };
  const update = vi.fn(async (tabId: number, properties: chrome.tabs.UpdateProperties): Promise<chrome.tabs.Tab> => {
    const tab = tabs.get(tabId);
    if (!tab) throw new Error('No tab with id');
    if (properties.active === true) {
      if (input.foregroundAvailable === false) return copy(tab);
      activate(tabId);
    }
    if (typeof properties.url === 'string') {
      tab.url = properties.url;
      for (const listener of updatedListeners) listener(tab.id, { url: tab.url });
    }
    return copy(tab);
  });
  const windowsUpdate = vi.fn(async (windowId: number, properties: chrome.windows.UpdateInfo): Promise<chrome.windows.Window> => {
    if (windowId !== 9) throw new Error('no_such_window');
    if (properties.focused === true) {
      if (input.foregroundAvailable === false) return { id: windowId, focused: false } as chrome.windows.Window;
      windowFocused = true;
    }
    return { id: windowId, focused: windowFocused } as chrome.windows.Window;
  });
  const windowsGet = vi.fn(async (windowId: number): Promise<chrome.windows.Window> => ({
    id: windowId,
    focused: windowId === 9 && windowFocused
  }) as chrome.windows.Window);

  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      tabs: {
        create: vi.fn(async (properties: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab> => {
          const tab: MockTab = {
            id: nextTabId++,
            windowId: 9,
            active: properties.active === true,
            url: properties.url ?? 'about:blank'
          };
          tabs.set(tab.id, tab);
          if (tab.active) activate(tab.id);
          return copy(tab);
        }),
        get: vi.fn(async (tabId: number): Promise<chrome.tabs.Tab> => {
          const tab = tabs.get(tabId);
          if (!tab) throw new Error('No tab with id');
          return copy(tab);
        }),
        remove: vi.fn(async (tabId: number) => {
          tabs.delete(tabId);
          for (const listener of removedListeners) listener(tabId);
        }),
        update,
        onActivated: { addListener: (listener: (info: chrome.tabs.TabActiveInfo) => void) => activatedListeners.push(listener) },
        onRemoved: { addListener: (listener: (tabId: number) => void) => removedListeners.push(listener) },
        onMoved: { addListener: (listener: (tabId: number) => void) => movedListeners.push(listener) },
        onUpdated: {
          addListener: (listener: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => void) => updatedListeners.push(listener)
        }
      },
      windows: { update: windowsUpdate, get: windowsGet },
      storage: {
        session: {
          get: vi.fn(async (key?: string | string[]) => {
            if (typeof key === 'string') return { [key]: sessionData.get(key) };
            if (Array.isArray(key)) return Object.fromEntries(key.map((entry) => [entry, sessionData.get(entry)]));
            return Object.fromEntries(sessionData.entries());
          }),
          set: vi.fn(async (value: Record<string, unknown>) => {
            for (const [key, entry] of Object.entries(value)) sessionData.set(key, structuredClone(entry));
          }),
          remove: vi.fn(async (key: string | string[]) => {
            for (const entry of Array.isArray(key) ? key : [key]) sessionData.delete(entry);
          })
        }
      }
    } as unknown as typeof chrome
  });

  return {
    tabs,
    update,
    windowsUpdate,
    windowsGet,
    sessionData,
    activate,
    remove(tabId: number) {
      tabs.delete(tabId);
      for (const listener of removedListeners) listener(tabId);
    },
    move(tabId: number) {
      for (const listener of movedListeners) listener(tabId);
    }
  };
}

describe('extension-owned work-tab navigation identity', () => {
  test('permits only source-level canonical redirects for a signed target', async () => {
    const { isExpectedExtensionWorkNavigation } = await import('../src/background/extension-work-tabs.js');
    expect(isExpectedExtensionWorkNavigation(
      'https://www.bilibili.com/video/BV1qZSLBYEpa',
      'https://www.bilibili.com/video/BV1qZSLBYEpa/'
    )).toBe(true);
    expect(isExpectedExtensionWorkNavigation(
      'https://search.bilibili.com/all?keyword=DeepSeek',
      'https://search.bilibili.com/all?keyword=DeepSeek&o=1&vt=2'
    )).toBe(true);
    expect(isExpectedExtensionWorkNavigation(
      'https://space.bilibili.com/7481602',
      'https://space.bilibili.com/7481602/?spm_id_from=333.1007.0.0'
    )).toBe(true);
    expect(isExpectedExtensionWorkNavigation(
      'https://space.bilibili.com/7481602/upload/video',
      'https://space.bilibili.com/7481602/upload/video/?spm_id_from=333.999.0.0'
    )).toBe(true);
  });

  test('rejects a different query, off-platform destination, and unrelated page', async () => {
    const { isExpectedExtensionWorkNavigation } = await import('../src/background/extension-work-tabs.js');
    const expected = 'https://search.bilibili.com/all?keyword=DeepSeek';
    expect(isExpectedExtensionWorkNavigation(expected, 'https://search.bilibili.com/all?keyword=other')).toBe(false);
    expect(isExpectedExtensionWorkNavigation(expected, 'https://www.bilibili.com/video/BV1qZSLBYEpa')).toBe(false);
    expect(isExpectedExtensionWorkNavigation(expected, 'https://example.invalid/all?keyword=DeepSeek')).toBe(false);
    expect(isExpectedExtensionWorkNavigation(
      'https://space.bilibili.com/7481602/upload/video',
      'https://space.bilibili.com/7481602/upload/opus'
    )).toBe(false);
  });
});

describe('extension-owned work-tab foreground lifecycle', () => {
  test('foregrounds only its current lease before recording and sending the canonical navigation', async () => {
    const browser = installChromeTabsMock();
    const {
      acquireExtensionWorkTab,
      currentExtensionWorkTabLossCause,
      navigateExtensionWorkTabOnce,
      readExtensionWorkTab
    } = await import(
      '../src/background/extension-work-tabs.js'
    );
    const lease = await acquireExtensionWorkTab();
    expect(browser.tabs.get(lease.tabId)?.active).toBe(false);
    const order: string[] = [];

    await navigateExtensionWorkTabOnce(lease, videoDetailWork(), async () => {
      order.push('intent');
    });

    expect(order).toEqual(['intent']);
    expect(browser.update.mock.calls.map(([, properties]) => properties)).toEqual([
      { active: true },
      { url: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }
    ]);
    expect(browser.windowsUpdate).toHaveBeenCalledWith(9, { focused: true });
    expect(browser.windowsGet).toHaveBeenCalledWith(9);
    await expect(readExtensionWorkTab(lease)).resolves.toMatchObject({
      id: lease.tabId,
      active: true,
      url: 'https://www.bilibili.com/video/BV1qZSLBYEpa'
    });
    expect(currentExtensionWorkTabLossCause()).toBeNull();
  });

  test('keeps the lease when Chromium repeats the internally initiated same-tab activation', async () => {
    const browser = installChromeTabsMock();
    const {
      acquireExtensionWorkTab,
      currentExtensionWorkTabLossCause,
      navigateExtensionWorkTabOnce,
      readExtensionWorkTab
    } = await import(
      '../src/background/extension-work-tabs.js'
    );
    const lease = await acquireExtensionWorkTab();
    await navigateExtensionWorkTabOnce(lease, videoDetailWork());

    browser.activate(lease.tabId);

    await expect(readExtensionWorkTab(lease)).resolves.toMatchObject({
      id: lease.tabId,
      active: true,
      url: 'https://www.bilibili.com/video/BV1qZSLBYEpa'
    });
    expect(currentExtensionWorkTabLossCause()).toBeNull();
  });

  test('does not record or send a platform navigation when foregrounding is unavailable', async () => {
    const browser = installChromeTabsMock({ foregroundAvailable: false });
    const { acquireExtensionWorkTab, navigateExtensionWorkTabOnce } = await import('../src/background/extension-work-tabs.js');
    const lease = await acquireExtensionWorkTab();
    const intent = vi.fn(async () => undefined);

    await expect(navigateExtensionWorkTabOnce(lease, videoDetailWork(), intent))
      .rejects.toThrow('work_tab_foreground_unavailable');

    expect(intent).not.toHaveBeenCalled();
    expect(browser.update).toHaveBeenCalledTimes(0);
    expect(browser.windowsUpdate).toHaveBeenCalledTimes(1);
    expect(browser.windowsUpdate).toHaveBeenLastCalledWith(9, { focused: true });
    expect(browser.tabs.get(lease.tabId)?.url).toBe('about:blank');
  });

  test('stops the lease without reclaiming focus when the person switches away', async () => {
    const browser = installChromeTabsMock();
    const {
      acquireExtensionWorkTab,
      currentExtensionWorkTabLossCause,
      navigateExtensionWorkTabOnce,
      readExtensionWorkTab
    } = await import(
      '../src/background/extension-work-tabs.js'
    );
    const lease = await acquireExtensionWorkTab();
    await navigateExtensionWorkTabOnce(lease, videoDetailWork());

    browser.activate(1);

    await expect(readExtensionWorkTab(lease)).rejects.toThrow('work_tab_user_taken_over');
    expect(currentExtensionWorkTabLossCause()).toBe('another_tab_activated');
    expect(browser.update.mock.calls.map(([, properties]) => properties)).toEqual([
      { active: true },
      { url: 'https://www.bilibili.com/video/BV1qZSLBYEpa' }
    ]);
  });

  test('does not keep polling a tab that became backgrounded without an activation event', async () => {
    const browser = installChromeTabsMock();
    const {
      acquireExtensionWorkTab,
      currentExtensionWorkTabLossCause,
      navigateExtensionWorkTabOnce,
      readExtensionWorkTab
    } = await import(
      '../src/background/extension-work-tabs.js'
    );
    const lease = await acquireExtensionWorkTab();
    await navigateExtensionWorkTabOnce(lease, videoDetailWork());
    const tab = browser.tabs.get(lease.tabId);
    if (!tab) throw new Error('test_work_tab_missing');
    tab.active = false;

    await expect(readExtensionWorkTab(lease)).rejects.toThrow('work_tab_user_taken_over');
    expect(currentExtensionWorkTabLossCause()).toBe('tab_became_inactive');
  });

  test('restores the extension-owned idle tab after an MV3 worker restart', async () => {
    const browser = installChromeTabsMock();
    const first = await import('../src/background/extension-work-tabs.js');
    const firstLease = await first.acquireExtensionWorkTab();
    expect(firstLease.acquisition).toBe('created');
    expect(first.releaseExtensionWorkTab(firstLease)).toBe('idle_reusable');
    await new Promise((resolve) => setTimeout(resolve, 0));

    vi.resetModules();
    const second = await import('../src/background/extension-work-tabs.js');
    const secondLease = await second.acquireExtensionWorkTab();

    expect(secondLease.acquisition).toBe('reused');
    expect(secondLease.tabId).toBe(firstLease.tabId);
    expect((globalThis.chrome.tabs.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect(browser.sessionData.size).toBe(1);
  });

  test('reuses a normally released foreground tab instead of treating it as user takeover', async () => {
    const browser = installChromeTabsMock();
    const first = await import('../src/background/extension-work-tabs.js');
    const firstLease = await first.acquireExtensionWorkTab();
    await first.navigateExtensionWorkTabOnce(firstLease, videoDetailWork());
    expect(browser.tabs.get(firstLease.tabId)?.active).toBe(true);
    expect(first.releaseExtensionWorkTab(firstLease)).toBe('idle_reusable');

    const secondLease = await first.acquireExtensionWorkTab();

    expect(secondLease.acquisition).toBe('reused');
    expect(secondLease.tabId).toBe(firstLease.tabId);
    expect((globalThis.chrome.tabs.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  test('restores a normally released foreground tab after an MV3 worker restart', async () => {
    const browser = installChromeTabsMock();
    const first = await import('../src/background/extension-work-tabs.js');
    const firstLease = await first.acquireExtensionWorkTab();
    await first.navigateExtensionWorkTabOnce(firstLease, videoDetailWork());
    expect(first.releaseExtensionWorkTab(firstLease)).toBe('idle_reusable');
    await new Promise((resolve) => setTimeout(resolve, 0));

    vi.resetModules();
    const second = await import('../src/background/extension-work-tabs.js');
    const secondLease = await second.acquireExtensionWorkTab();

    expect(secondLease.acquisition).toBe('reused');
    expect(secondLease.tabId).toBe(firstLease.tabId);
    expect(browser.tabs.get(firstLease.tabId)?.active).toBe(true);
    expect((globalThis.chrome.tabs.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  test('keeps an idle work tab reusable after the person switches to another tab', async () => {
    const browser = installChromeTabsMock();
    const tabs = await import('../src/background/extension-work-tabs.js');
    const lease = await tabs.acquireExtensionWorkTab();
    await tabs.navigateExtensionWorkTabOnce(lease, videoDetailWork());
    expect(tabs.releaseExtensionWorkTab(lease)).toBe('idle_reusable');

    browser.activate(1);

    const reused = await tabs.acquireExtensionWorkTab();
    expect(reused.acquisition).toBe('reused');
    expect(tabs.currentExtensionWorkTabLossCause()).toBeNull();
    expect((globalThis.chrome.tabs.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  test('closes an interrupted pre-navigation blank tab instead of retaining an orphan', async () => {
    const browser = installChromeTabsMock();
    const first = await import('../src/background/extension-work-tabs.js');
    const firstLease = await first.acquireExtensionWorkTab();
    expect(firstLease.acquisition).toBe('created');
    await new Promise((resolve) => setTimeout(resolve, 0));

    vi.resetModules();
    const second = await import('../src/background/extension-work-tabs.js');
    await expect(second.recoverInterruptedExtensionWorkTab({
      workTabAcquisition: 'created',
      navigationIntentCount: 0
    })).resolves.toBe('closed_or_missing');

    expect(browser.tabs.has(firstLease.tabId)).toBe(false);
    expect((globalThis.chrome.tabs.remove as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(firstLease.tabId);
    expect(browser.sessionData.size).toBe(1);
  });

  test('clears a stale leased blank tab before the next queued work item', async () => {
    const browser = installChromeTabsMock();
    const first = await import('../src/background/extension-work-tabs.js');
    const firstLease = await first.acquireExtensionWorkTab();
    await new Promise((resolve) => setTimeout(resolve, 0));

    vi.resetModules();
    const second = await import('../src/background/extension-work-tabs.js');
    await second.recoverOrphanedExtensionWorkTabs();

    expect(browser.tabs.has(firstLease.tabId)).toBe(false);
    expect((globalThis.chrome.tabs.remove as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(firstLease.tabId);
  });

  test('does not open a replacement after the user takes over a retained work tab', async () => {
    const browser = installChromeTabsMock();
    const tabs = await import('../src/background/extension-work-tabs.js');
    const lease = await tabs.acquireExtensionWorkTab();
    expect(tabs.abandonExtensionWorkTab(lease)).toBe('retained_not_reusable');

    await expect(tabs.acquireExtensionWorkTab()).rejects.toThrow('work_tab_user_taken_over');
    expect(browser.tabs.size).toBe(2);
    expect((globalThis.chrome.tabs.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });
});
