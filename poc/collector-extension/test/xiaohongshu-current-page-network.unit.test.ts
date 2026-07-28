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
  const executeScript = vi.fn(async (): Promise<Array<{ frameId: number; result: unknown }>> => [{
    frameId: 0,
    result: { pathname: '/search_result', title: '公开搜索', visibleText: '公开可见的搜索结果' }
  }]);
  const managedTab = {
    id: 11, windowId: 22, active: true, incognito: false, status: 'complete', url: exploreUrl
  };
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      permissions: { request, contains },
      storage: { session: sessionArea },
      tabs: {
        query: vi.fn(async () => [managedTab]),
        get: vi.fn(async (tabId: number) => tabId === managedTab.id ? managedTab : undefined),
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
    request, contains, executeScript, beforeNavigate, committed, errored, removed, completed,
    removeNetworkListener, managedTab
  };
}

const managedRequest = {
  schemaVersion: 2,
  profileId: 'xiaohongshu_validation',
  pageAlias: 'page-1',
  pageLeaseId: 'lease-123',
  expectedRecordVersion: 1,
  runId: 'run-123'
} as const;

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
      permissionState: 'permission_granted',
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
      permissionState: 'permission_granted',
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

  test('reports a missing optional permission without opening a prompt or touching a page', async () => {
    const chrome = installChromeMock();
    chrome.contains.mockResolvedValue(false);
    const subject = await import('../src/background/xiaohongshu-current-page-network.js');

    await expect(subject.readXiaohongshuCurrentPageNetworkObservation()).resolves.toMatchObject({
      permissionState: 'permission_required',
      selection: { state: 'not_selected', publicSurface: null }
    });
    expect(chrome.request).not.toHaveBeenCalled();
    expect(chrome.executeScript).not.toHaveBeenCalled();
    expect(chrome.completed).toHaveLength(0);
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

  test('arms the exact managed tab using existing permission without invoking a prompt', async () => {
    const chrome = installChromeMock();
    const subject = await import('../src/background/xiaohongshu-current-page-network.js');

    await expect(subject.armXiaohongshuManagedPageNetworkObserver(11, managedRequest)).resolves.toMatchObject({
      type: 'xiaohongshu_managed_page_network_observer_armed',
      pageAlias: 'page-1',
      runId: 'run-123',
      permissionState: 'permission_granted',
      selection: { state: 'observing', publicSurface: 'explore' }
    });
    expect(chrome.contains).toHaveBeenCalled();
    expect(chrome.request).not.toHaveBeenCalled();
    expect(globalThis.chrome.tabs.get).toHaveBeenCalledWith(11);
  });

  test('managed arm reports missing permission without touching the tab or prompting', async () => {
    const chrome = installChromeMock();
    chrome.contains.mockResolvedValue(false);
    const subject = await import('../src/background/xiaohongshu-current-page-network.js');

    await expect(subject.armXiaohongshuManagedPageNetworkObserver(11, managedRequest)).resolves.toMatchObject({
      permissionState: 'permission_required',
      selection: { state: 'not_selected' }
    });
    expect(chrome.request).not.toHaveBeenCalled();
    expect(globalThis.chrome.tabs.get).not.toHaveBeenCalled();
  });

  test('reads only the exact managed tab and run after the next document binds', async () => {
    const chrome = installChromeMock();
    const subject = await import('../src/background/xiaohongshu-current-page-network.js');
    subject.initialiseXiaohongshuCurrentPageNetworkObserver();
    await subject.armXiaohongshuManagedPageNetworkObserver(11, managedRequest);
    chrome.beforeNavigate[0]?.({ tabId: 11, frameId: 0, url: 'https://www.xiaohongshu.com/search_result?keyword=public' });
    await settle();
    chrome.committed[0]?.({ tabId: 11, frameId: 0, documentId: 'document-2', url: 'https://www.xiaohongshu.com/search_result?keyword=public' });
    await settle();
    // Xiaohongshu may traverse another allowed public top-level document in
    // the same managed page.goto chain. Managed runs follow it; popup arms do
    // not gain this relaxation.
    chrome.beforeNavigate[0]?.({ tabId: 11, frameId: 0, url: 'https://www.xiaohongshu.com/search_result?keyword=public' });
    await settle();
    chrome.committed[0]?.({ tabId: 11, frameId: 0, documentId: 'document-3', url: 'https://www.xiaohongshu.com/search_result?keyword=public' });
    await settle();
    chrome.completed[0]?.({
      tabId: 11,
      type: 'xmlhttprequest',
      url: 'https://www.xiaohongshu.com/api/sns/web/v1/search/notes'
    });
    await settle();

    await expect(subject.readXiaohongshuManagedPageNetworkObservation(11, managedRequest)).resolves.toMatchObject({
      type: 'xiaohongshu_managed_page_network_observation',
      pageAlias: 'page-1',
      runId: 'run-123',
      selection: { state: 'observing', publicSurface: 'search' },
      observation: { excludedRouteCounts: { other: 1 } }
    });
    await expect(subject.readXiaohongshuManagedPageNetworkObservation(12, managedRequest))
      .rejects.toThrow('xiaohongshu_managed_page_network_binding_mismatch');
    await expect(subject.readXiaohongshuManagedPageNetworkObservation(11, { ...managedRequest, runId: 'run-456' }))
      .rejects.toThrow('xiaohongshu_managed_page_network_binding_mismatch');
  });

  test('binds a Network detail projection to the selected note identity', async () => {
    const chrome = installChromeMock();
    const subject = await import('../src/background/xiaohongshu-current-page-network.js');
    subject.initialiseXiaohongshuCurrentPageNetworkObserver();
    await subject.armXiaohongshuManagedPageNetworkObserver(11, managedRequest);
    chrome.beforeNavigate[0]?.({
      tabId: 11,
      frameId: 0,
      url: 'https://www.xiaohongshu.com/search_result?keyword=public'
    });
    await settle();
    chrome.committed[0]?.({
      tabId: 11,
      frameId: 0,
      documentId: 'document-2',
      url: 'https://www.xiaohongshu.com/search_result?keyword=public'
    });
    await settle();
    chrome.executeScript.mockResolvedValueOnce([{
      frameId: 0,
      result: {
        selectedNoteId: 'selected-note',
        matchedPayloadCount: 2,
        bodyBytesRead: 4_096,
        details: [
          {
            noteId: 'different-note',
            publicText: '错误笔记正文',
            authorNickname: '错误作者',
            interactionText: '错误互动'
          },
          {
            noteId: 'selected-note',
            publicText: '目标笔记正文',
            authorNickname: '目标作者',
            interactionText: '目标互动'
          }
        ]
      }
    }]);

    await expect(subject.readXiaohongshuExistingSearchNoteDetailNetworkProjection(11, 'run-123'))
      .resolves.toEqual({
        matchedPayloadCount: 2,
        bodyBytesRead: 4_096,
        detail: {
          publicText: '目标笔记正文',
          authorNickname: '目标作者',
          interactionText: '目标互动'
        }
      });
  });

  test('does not return another note detail when the selected identity is absent', async () => {
    const chrome = installChromeMock();
    const subject = await import('../src/background/xiaohongshu-current-page-network.js');
    subject.initialiseXiaohongshuCurrentPageNetworkObserver();
    await subject.armXiaohongshuManagedPageNetworkObserver(11, managedRequest);
    chrome.beforeNavigate[0]?.({
      tabId: 11,
      frameId: 0,
      url: 'https://www.xiaohongshu.com/search_result?keyword=public'
    });
    await settle();
    chrome.committed[0]?.({
      tabId: 11,
      frameId: 0,
      documentId: 'document-2',
      url: 'https://www.xiaohongshu.com/search_result?keyword=public'
    });
    await settle();
    chrome.executeScript.mockResolvedValueOnce([{
      frameId: 0,
      result: {
        selectedNoteId: 'selected-note',
        matchedPayloadCount: 1,
        bodyBytesRead: 2_048,
        details: [{
          noteId: 'different-note',
          publicText: '不能错配的正文',
          authorNickname: '其他作者',
          interactionText: '其他互动'
        }]
      }
    }]);

    await expect(subject.readXiaohongshuExistingSearchNoteDetailNetworkProjection(11, 'run-123'))
      .resolves.toEqual({ matchedPayloadCount: 1, bodyBytesRead: 2_048, detail: null });
  });

  test('does not overwrite or consume a popup-created active selection', async () => {
    installChromeMock();
    const subject = await import('../src/background/xiaohongshu-current-page-network.js');
    await subject.armNextXiaohongshuCurrentPageNetworkDocument();
    await expect(subject.armXiaohongshuManagedPageNetworkObserver(11, managedRequest))
      .rejects.toThrow('xiaohongshu_current_page_network_selection_active');
    await expect(subject.readXiaohongshuManagedPageNetworkObservation(11, managedRequest))
      .rejects.toThrow('xiaohongshu_managed_page_network_binding_mismatch');
  });
});
