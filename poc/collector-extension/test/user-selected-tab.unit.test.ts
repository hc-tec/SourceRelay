import { afterEach, describe, expect, test, vi } from 'vitest';

const originalChrome = globalThis.chrome;
const inventoryUrl = 'https://space.bilibili.com/7481602/upload/video';
const discussionUrl = 'https://www.bilibili.com/video/BV1qZSLBYEpa';

afterEach(() => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: originalChrome
  });
  vi.resetModules();
});

function installChromeMock(input: { documentId?: string; tabUrl?: string } = {}) {
  const session = new Map<string, unknown>();
  let tabUrl = input.tabUrl ?? inventoryUrl;
  let documentId = input.documentId ?? 'document-1';
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
  const query = vi.fn(async () => [{ id: 11, windowId: 22, active: true, incognito: false, url: tabUrl }]);
  const get = vi.fn(async () => ({ id: 11, windowId: 22, active: true, incognito: false, status: 'complete', url: tabUrl }));
  const getFrame = vi.fn(async () => ({
    documentId,
    frameId: 0,
    parentFrameId: -1,
    processId: 1,
    url: tabUrl,
    errorOccurred: false
  }));
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      storage: { session: sessionArea },
      tabs: { query, get },
      webNavigation: { getFrame }
    } as unknown as typeof chrome
  });
  return {
    session,
    query,
    get,
    getFrame,
    replaceDocument(next: { documentId?: string; url?: string }) {
      documentId = next.documentId ?? documentId;
      tabUrl = next.url ?? tabUrl;
    }
  };
}

describe('user-selected Bilibili inventory tab lease', () => {
  test('records one explicit active document and consumes it once without browser control APIs', async () => {
    const chrome = installChromeMock();
    const selection = await import('../src/background/user-selected-tab.js');

    await expect(selection.selectCurrentBilibiliAccountInventoryTab()).resolves.toMatchObject({
      state: 'available'
    });
    await expect(selection.getSelectedBilibiliAccountInventoryTabSummary()).resolves.toMatchObject({
      state: 'available'
    });
    await expect(selection.takeSelectedBilibiliAccountInventoryTab(inventoryUrl)).resolves.toMatchObject({
      kind: 'ready',
      lease: { canonicalInventoryUrl: inventoryUrl, documentId: 'document-1' }
    });
    await expect(selection.takeSelectedBilibiliAccountInventoryTab(inventoryUrl)).resolves.toEqual({
      kind: 'stopped',
      errorCode: 'user_selected_tab_required',
      disposition: 'selection_unavailable'
    });
    expect(chrome.query).toHaveBeenCalledTimes(1);
    expect(chrome.get).toHaveBeenCalledTimes(1);
    expect(chrome.getFrame).toHaveBeenCalledTimes(2);
    expect((globalThis.chrome as unknown as Record<string, unknown>).scripting).toBeUndefined();
  });

  test('does not permit a target mismatch or a same-URL document replacement to be reused', async () => {
    const chrome = installChromeMock();
    const selection = await import('../src/background/user-selected-tab.js');

    await selection.selectCurrentBilibiliAccountInventoryTab();
    await expect(selection.takeSelectedBilibiliAccountInventoryTab('https://space.bilibili.com/1/upload/video')).resolves.toMatchObject({
      kind: 'stopped', errorCode: 'user_selected_tab_target_mismatch', disposition: 'target_mismatch'
    });

    await selection.selectCurrentBilibiliAccountInventoryTab();
    chrome.replaceDocument({ documentId: 'document-2' });
    await expect(selection.takeSelectedBilibiliAccountInventoryTab(inventoryUrl)).resolves.toMatchObject({
      kind: 'stopped', errorCode: 'user_selected_tab_document_changed', disposition: 'document_changed'
    });
  });

  test('rejects a current tab outside the single approved inventory document shape', async () => {
    installChromeMock({ tabUrl: 'https://space.bilibili.com/7481602/dynamic' });
    const selection = await import('../src/background/user-selected-tab.js');
    await expect(selection.selectCurrentBilibiliAccountInventoryTab())
      .rejects.toThrow('user_selected_tab_target_not_supported');
  });
});

describe('user-selected Bilibili video discussion tab lease', () => {
  test('detects a background leased tab without naming or selecting another tab', async () => {
    const executor = await import('../src/background/extension-work-bilibili-discussion-user-selected-tab.js');
    expect(executor.discussionTabNeedsForeground({ active: true }, { focused: true })).toBe(false);
    expect(executor.discussionTabNeedsForeground({ active: false }, { focused: true })).toBe(true);
    expect(executor.discussionTabNeedsForeground({ active: true }, { focused: false })).toBe(true);
    expect(executor.discussionTabNeedsForeground({ active: true }, null)).toBe(true);
  });

  test('records a user-visible video document and consumes it once without browser control APIs', async () => {
    const chrome = installChromeMock({ tabUrl: discussionUrl });
    const selection = await import('../src/background/user-selected-bilibili-video-discussion-tab.js');

    await expect(selection.selectCurrentBilibiliVideoDiscussionTab()).resolves.toMatchObject({ state: 'available' });
    await expect(selection.getSelectedBilibiliVideoDiscussionTabSummary()).resolves.toMatchObject({ state: 'available' });
    await expect(selection.takeSelectedBilibiliVideoDiscussionTab(discussionUrl)).resolves.toMatchObject({
      kind: 'ready',
      lease: { canonicalVideoUrl: discussionUrl, bvid: 'BV1qZSLBYEpa', documentId: 'document-1' }
    });
    await expect(selection.takeSelectedBilibiliVideoDiscussionTab(discussionUrl)).resolves.toEqual({
      kind: 'stopped',
      errorCode: 'user_selected_tab_required',
      disposition: 'selection_unavailable'
    });
    expect(chrome.query).toHaveBeenCalledTimes(1);
    expect(chrome.get).toHaveBeenCalledTimes(1);
    expect(chrome.getFrame).toHaveBeenCalledTimes(2);
    expect((globalThis.chrome as unknown as Record<string, unknown>).scripting).toBeUndefined();
  });

  test('does not permit a target mismatch or same-URL document replacement to be reused', async () => {
    const chrome = installChromeMock({ tabUrl: discussionUrl });
    const selection = await import('../src/background/user-selected-bilibili-video-discussion-tab.js');

    await selection.selectCurrentBilibiliVideoDiscussionTab();
    await expect(selection.takeSelectedBilibiliVideoDiscussionTab('https://www.bilibili.com/video/BV1xx411c7mD'))
      .resolves.toMatchObject({ kind: 'stopped', errorCode: 'user_selected_tab_target_mismatch', disposition: 'target_mismatch' });

    await selection.selectCurrentBilibiliVideoDiscussionTab();
    chrome.replaceDocument({ documentId: 'document-2' });
    await expect(selection.takeSelectedBilibiliVideoDiscussionTab(discussionUrl))
      .resolves.toMatchObject({ kind: 'stopped', errorCode: 'user_selected_tab_document_changed', disposition: 'document_changed' });
  });

  test('rejects a current tab outside the exact public Bilibili video document shape', async () => {
    installChromeMock({ tabUrl: 'https://www.bilibili.com/read/cv1' });
    const selection = await import('../src/background/user-selected-bilibili-video-discussion-tab.js');
    await expect(selection.selectCurrentBilibiliVideoDiscussionTab())
      .rejects.toThrow('user_selected_tab_target_not_supported');
  });
});
