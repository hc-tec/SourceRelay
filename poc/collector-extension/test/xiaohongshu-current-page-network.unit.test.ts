import { afterEach, describe, expect, test, vi } from 'vitest';

const originalChrome = globalThis.chrome;
const exploreUrl = 'https://www.xiaohongshu.com/explore';

afterEach(() => {
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: originalChrome });
  vi.resetModules();
});

/**
 * These are state-machine tests only. They do not stand in for a Xiaohongshu
 * page, XHR, Gateway response or live-platform proof; that evidence must come
 * from the isolated visible-browser run.
 */
function installChromeMock() {
  const session = new Map<string, unknown>();
  const beforeNavigate: Array<(details: unknown) => void> = [];
  const committed: Array<(details: unknown) => void> = [];
  const errored: Array<(details: unknown) => void> = [];
  const removed: Array<(tabId: number) => void> = [];
  const completed: Array<(details: unknown) => void> = [];
  const sessionArea = {
    get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
      if (keys === null || keys === undefined) return Object.fromEntries(session);
      if (typeof keys === 'string') return { [keys]: session.get(keys) };
      if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, session.get(key)]));
      return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, session.get(key) ?? fallback]));
    }),
    set: vi.fn(async (values: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(values)) session.set(key, structuredClone(value));
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) session.delete(key);
    })
  };
  const request = vi.fn(async () => true);
  const contains = vi.fn(async () => true);
  const removeNetworkListener = vi.fn();
  const executeScript = vi.fn(async () => [{
    frameId: 0,
    result: { pathname: '/search_result', title: '公开搜索', visibleText: '公开可见的搜索结果' }
  }]);
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      permissions: { request, contains },
      storage: { session: sessionArea },
      tabs: {
        query: vi.fn(async () => [{
          id: 11, windowId: 22, active: true, incognito: false, status: 'complete', url: exploreUrl
        }]),
        onRemoved: { addListener: (listener: (tabId: number) => void) => removed.push(listener) }
      },
      webNavigation: {
        getFrame: vi.fn(async () => ({ documentId: 'document-1', url: exploreUrl })),
        onBeforeNavigate: { addListener: (listener: (details: unknown) => void) => beforeNavigate.push(listener) },
        onCommitted: { addListener: (listener: (details: unknown) => void) => committed.push(listener) },
        onErrorOccurred: { addListener: (listener: (details: unknown) => void) => errored.push(listener) }
      },
      webRequest: {
        onCompleted: {
          addListener: (listener: (details: unknown) => void) => completed.push(listener),
          removeListener: removeNetworkListener
        }
      },
      scripting: { executeScript }
    } as unknown as typeof chrome
  });
  return {
    request, contains, executeScript, beforeNavigate, committed, errored, removed, completed, removeNetworkListener
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('Xiaohongshu current-page network pre-arm state machine', () => {
  test('requires a popup gesture, creates one next-document lease, and never controls the page', async () => {
    const chrome = installChromeMock();
    const subject = await import('../src/background/xiaohongshu-current-page-network.js');

    await expect(subject.armNextXiaohongshuCurrentPageNetworkDocument()).resolves.toMatchObject({
      state: 'armed_next_document',
      publicSurface: null
    });
    expect(chrome.request).toHaveBeenCalledWith({
      permissions: ['webRequest'],
      origins: ['https://www.xiaohongshu.com/*']
    });
    expect((globalThis.chrome as unknown as Record<string, unknown>).tabs).not.toHaveProperty('update');
    expect((globalThis.chrome as unknown as Record<string, unknown>).scripting).toHaveProperty('executeScript');
    expect(chrome.executeScript).not.toHaveBeenCalled();
    expect(chrome.completed).toHaveLength(0);

    await expect(subject.readXiaohongshuCurrentPageNetworkObservation()).resolves.toMatchObject({
      selection: { state: 'armed_next_document', publicSurface: null },
      observation: {
        observerState: 'not_armed',
        responseBodiesRead: false,
        rawPayloadBytesRead: 0
      }
    });
  });

  test('retains only bounded category counts after a person-triggered same-tab document change', async () => {
    const chrome = installChromeMock();
    const subject = await import('../src/background/xiaohongshu-current-page-network.js');
    subject.initialiseXiaohongshuCurrentPageNetworkObserver();
    await subject.armNextXiaohongshuCurrentPageNetworkDocument();

    chrome.beforeNavigate[0]?.({ tabId: 11, frameId: 0, url: 'https://www.xiaohongshu.com/search_result?keyword=private-query' });
    await settle();
    chrome.committed[0]?.({ tabId: 11, frameId: 0, documentId: 'document-2', url: 'https://www.xiaohongshu.com/search_result?keyword=private-query' });
    await settle();
    chrome.completed[0]?.({
      tabId: 11,
      type: 'xmlhttprequest',
      url: 'https://www.xiaohongshu.com/website-login/captcha?token=private-value'
    });
    await settle();

    const result = await subject.readXiaohongshuCurrentPageNetworkObservation();
    expect(result).toMatchObject({
      selection: { state: 'observing', publicSurface: 'search' },
      observation: {
        observerState: 'armed_same_document',
        publicContentRouteCount: 0,
        excludedRouteCounts: { securityOrRisk: 1 },
        responseBodiesRead: false,
        rawPayloadBytesRead: 0
      }
    });
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain('private-query');
    expect(serialised).not.toContain('private-value');
    expect(serialised).not.toContain('website-login');
  });

  test('stops and removes the only network listener when the observed document changes again', async () => {
    const chrome = installChromeMock();
    const subject = await import('../src/background/xiaohongshu-current-page-network.js');
    subject.initialiseXiaohongshuCurrentPageNetworkObserver();
    await subject.armNextXiaohongshuCurrentPageNetworkDocument();

    chrome.beforeNavigate[0]?.({ tabId: 11, frameId: 0, url: 'https://www.xiaohongshu.com/search_result?keyword=public' });
    await settle();
    chrome.committed[0]?.({ tabId: 11, frameId: 0, documentId: 'document-2', url: 'https://www.xiaohongshu.com/search_result?keyword=public' });
    await settle();
    chrome.beforeNavigate[0]?.({ tabId: 11, frameId: 0, url: 'https://www.xiaohongshu.com/settings' });
    await settle();

    await expect(subject.getXiaohongshuCurrentPageNetworkSelectionSummary()).resolves.toMatchObject({
      state: 'stopped', publicSurface: 'search'
    });
    expect(chrome.removeNetworkListener).toHaveBeenCalledTimes(1);
  });
});
