import {
  COLLECTION_RESULT,
  COLLECT_ACTIVE_TAB,
  COLLECT_VISIBLE_RESULTS,
  CONTENT_READY,
  START_NATIVE_SEARCH,
  isCollectActiveTabMessage,
  isCollectionResultMessage,
  isStartNativeSearchMessage,
  type VisibleCollectionResult
} from '../shared/protocol';
import { buildNativeSearchUrl } from '../shared/native-search';

function resultStorageKey(tabId: number): string {
  return `collector.visible-result.${tabId}`;
}

async function collectTab(tabId: number): Promise<VisibleCollectionResult> {
  const response = await chrome.tabs.sendMessage(tabId, { type: COLLECT_VISIBLE_RESULTS });
  if (!response?.ok || !response.result) {
    throw new Error('The page did not return a visible-result collection payload.');
  }
  return response.result as VisibleCollectionResult;
}

async function collectActiveTab(): Promise<VisibleCollectionResult> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('No active tab is available for visible-result collection.');
  return collectTab(tab.id);
}

function testFixtureNavigationUrl(platform: Parameters<typeof buildNativeSearchUrl>[0], nativeUrl: URL, fixtureBaseUrl?: string): string {
  if (!__COLLECTOR_TEST_BUILD__ || !fixtureBaseUrl) return nativeUrl.href;
  const base = new URL(fixtureBaseUrl);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1') {
    throw new Error('The extension test fixture must use a loopback HTTP URL.');
  }
  const target = new URL(`/${platform}`, base);
  target.searchParams.set('native_url', nativeUrl.href);
  return target.href;
}

async function startNativeSearch(
  platform: Parameters<typeof buildNativeSearchUrl>[0],
  query: string,
  fixtureBaseUrl?: string
) {
  const nativeUrl = buildNativeSearchUrl(platform, query);
  const navigationUrl = testFixtureNavigationUrl(platform, nativeUrl, fixtureBaseUrl);
  const tab = await chrome.tabs.create({ url: navigationUrl, active: false });
  if (!tab.id) throw new Error('Chrome did not create a tab for the platform-native search task.');
  return { tabId: tab.id, nativeUrl: nativeUrl.href, navigationUrl };
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isCollectionResultMessage(message)) {
    const tabId = sender.tab?.id;
    if (typeof tabId === 'number') {
      void chrome.storage.session.set({ [resultStorageKey(tabId)]: message.result });
    }
    sendResponse({ ok: true });
    return false;
  }

  if (isCollectActiveTabMessage(message)) {
    void collectActiveTab().then(
      (result) => sendResponse({ ok: true, result }),
      (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    );
    return true;
  }

  if (isStartNativeSearchMessage(message)) {
    void startNativeSearch(message.platform, message.query, message.testFixtureBaseUrl).then(
      (task) => sendResponse({ ok: true, task }),
      (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    );
    return true;
  }

  if (message && typeof message === 'object' && (message as { type?: unknown }).type === CONTENT_READY) {
    const tabId = sender.tab?.id;
    if (typeof tabId === 'number') {
      void collectTab(tabId).catch(() => undefined);
    }
    sendResponse({ ok: true });
  }
  return false;
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'collect-visible-results') return;
  void collectActiveTab().catch(() => undefined);
});

chrome.action.onClicked.addListener(() => {
  void collectActiveTab().catch(() => undefined);
});

// This explicit reference keeps the public protocol surface visible in the
// bundled service worker and makes it easy for the E2E harness to verify the
// same message route a user-triggered command will use.
void COLLECT_ACTIVE_TAB;
void START_NATIVE_SEARCH;
