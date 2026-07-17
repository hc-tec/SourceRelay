import {
  COLLECTION_RESULT,
  COLLECT_ACTIVE_TAB,
  COLLECT_VISIBLE_RESULTS,
  CONTENT_READY,
  NETWORK_CAPTURE_BRIDGE_READY_MESSAGE,
  NETWORK_CAPTURE_OBSERVED,
  START_NATIVE_SEARCH,
  isCollectActiveTabMessage,
  isCollectionResultMessage,
  isNetworkCaptureBridgeReadyMessage,
  isNetworkCaptureObservedMessage,
  isStartNativeSearchMessage,
  type VisibleCollectionResult
} from '../shared/protocol';
import { buildNativeSearchUrl, nativeSearchPlatform } from '../shared/native-search';
import {
  NETWORK_CAPTURE_MAX_PER_PAGE,
  sanitiseNetworkCaptureObservation,
  type NetworkCaptureObservation
} from '../shared/network-capture';

function resultStorageKey(tabId: number): string {
  return `collector.visible-result.${tabId}`;
}

function networkCaptureStorageKey(tabId: number): string {
  return `collector.network-captures.${tabId}`;
}

function networkCaptureArmStorageKey(tabId: number): string {
  return `collector.network-capture-arm.${tabId}`;
}

interface NetworkCaptureArm {
  platform: Parameters<typeof buildNativeSearchUrl>[0];
  navigationUrlDigest: string;
  documentId?: string;
  expiresAt: number;
}

interface BoundNetworkCaptureArm extends NetworkCaptureArm {
  documentId: string;
}

const NETWORK_CAPTURE_ARM_TTL_MS = 2 * 60 * 1000;

async function navigationUrlDigest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function armNetworkCapture(
  tabId: number,
  platform: Parameters<typeof buildNativeSearchUrl>[0],
  navigationUrl: string
): Promise<void> {
  const arm: NetworkCaptureArm = {
    platform,
    navigationUrlDigest: await navigationUrlDigest(navigationUrl),
    expiresAt: Date.now() + NETWORK_CAPTURE_ARM_TTL_MS
  };
  await chrome.storage.session.set({ [networkCaptureArmStorageKey(tabId)]: arm });
}

async function getActiveNetworkCaptureArm(tabId: number): Promise<NetworkCaptureArm | null> {
  const key = networkCaptureArmStorageKey(tabId);
  const candidate = (await chrome.storage.session.get(key))[key] as Partial<NetworkCaptureArm> | undefined;
  const documentId =
    candidate?.documentId === undefined
      ? undefined
      : typeof candidate.documentId === 'string' && candidate.documentId.length > 0
        ? candidate.documentId
        : null;
  if (
    candidate &&
    (candidate.platform === 'bilibili' ||
      candidate.platform === 'zhihu' ||
      candidate.platform === 'weibo' ||
      candidate.platform === 'xiaohongshu') &&
    typeof candidate.navigationUrlDigest === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate.navigationUrlDigest) &&
    typeof candidate.expiresAt === 'number' &&
    Number.isFinite(candidate.expiresAt) &&
    candidate.expiresAt > Date.now() &&
    documentId !== null
  ) {
    return {
      platform: candidate.platform,
      navigationUrlDigest: candidate.navigationUrlDigest,
      expiresAt: candidate.expiresAt,
      ...(documentId === undefined ? {} : { documentId })
    };
  }
  await chrome.storage.session.remove(key);
  return null;
}

function senderUrlMatchesArmPlatform(senderUrl: string, arm: NetworkCaptureArm): boolean {
  try {
    const url = new URL(senderUrl);
    if (__COLLECTOR_TEST_BUILD__ && url.protocol === 'http:' && url.hostname === '127.0.0.1') return true;
    return nativeSearchPlatform(url) === arm.platform;
  } catch {
    return false;
  }
}

async function activeArmForNavigation(tabId: number, senderUrl: string | undefined): Promise<NetworkCaptureArm | null> {
  if (!senderUrl) return null;
  const arm = await getActiveNetworkCaptureArm(tabId);
  if (!arm || !senderUrlMatchesArmPlatform(senderUrl, arm)) return null;
  return (await navigationUrlDigest(senderUrl)) === arm.navigationUrlDigest ? arm : null;
}

async function bindArmToDocument(
  tabId: number,
  senderUrl: string | undefined,
  documentId: string | undefined
): Promise<BoundNetworkCaptureArm | null> {
  if (!documentId) return null;
  const arm = await activeArmForNavigation(tabId, senderUrl);
  if (!arm || (arm.documentId !== undefined && arm.documentId !== documentId)) return null;
  const bound: BoundNetworkCaptureArm = { ...arm, documentId };
  await chrome.storage.session.set({ [networkCaptureArmStorageKey(tabId)]: bound });
  return bound;
}

async function activeBoundArmForSender(
  tabId: number,
  senderUrl: string | undefined,
  documentId: string | undefined
): Promise<BoundNetworkCaptureArm | null> {
  if (!documentId) return null;
  const arm = await activeArmForNavigation(tabId, senderUrl);
  return arm?.documentId === documentId ? { ...arm, documentId } : null;
}

async function storeNetworkCapture(tabId: number, candidate: unknown): Promise<{ stored: boolean }> {
  const observation = sanitiseNetworkCaptureObservation(candidate);
  if (!observation) return { stored: false };

  const key = networkCaptureStorageKey(tabId);
  const current = (await chrome.storage.session.get(key))[key];
  const captures = Array.isArray(current)
    ? current
        .map((value) => sanitiseNetworkCaptureObservation(value))
        .filter((value): value is NetworkCaptureObservation => value !== null)
        .slice(0, NETWORK_CAPTURE_MAX_PER_PAGE)
    : [];
  if (captures.length >= NETWORK_CAPTURE_MAX_PER_PAGE) return { stored: false };

  captures.push(observation);
  await chrome.storage.session.set({ [key]: captures });
  return { stored: true };
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
  // Create an inert tab first, arm that exact tab ID, then navigate.  This
  // removes the document_start race without ever enabling capture for an
  // unrelated page or a user-opened search tab.
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  if (!tab.id) throw new Error('Chrome did not create a tab for the platform-native search task.');
  await armNetworkCapture(tab.id, platform, navigationUrl);
  await chrome.tabs.update(tab.id, { url: navigationUrl });
  return { tabId: tab.id, nativeUrl: nativeUrl.href, navigationUrl };
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isNetworkCaptureBridgeReadyMessage(message)) {
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number' || sender.frameId !== 0) {
      sendResponse({ ok: true, armed: false });
      return false;
    }
    void bindArmToDocument(tabId, sender.url, sender.documentId).then(
      async (arm) => {
        if (!arm) {
          sendResponse({ ok: true, armed: false });
          return;
        }
        try {
          // The observer is not a static MAIN-world content script. It enters
          // only this already-arm-validated top-level document, so a page
          // cannot activate response reading by forging postMessage events.
          await chrome.scripting.executeScript({
            target: { tabId, documentIds: [arm.documentId] },
            world: 'MAIN',
            func: (expiresAt: number) => {
              Object.defineProperty(window, '__personalIntelligenceNetworkCaptureExpiresAt', {
                value: expiresAt,
                writable: false,
                configurable: true
              });
            },
            args: [arm.expiresAt],
            injectImmediately: true
          });
          await chrome.scripting.executeScript({
            target: { tabId, documentIds: [arm.documentId] },
            world: 'MAIN',
            files: ['main-world-network-observer.js'],
            injectImmediately: true
          });
          sendResponse({ ok: true, armed: true, expiresAt: arm.expiresAt });
        } catch {
          sendResponse({ ok: true, armed: false });
        }
      },
      () => sendResponse({ ok: true, armed: false })
    );
    return true;
  }

  if (isNetworkCaptureObservedMessage(message)) {
    const tabId = sender.tab?.id;
    if (
      typeof tabId !== 'number' ||
      sender.frameId !== 0 ||
      !sender.url
    ) {
      sendResponse({ ok: false, error: 'network_capture_source_rejected' });
      return false;
    }
    void activeBoundArmForSender(tabId, sender.url, sender.documentId).then(
      (arm) => arm?.platform === message.observation.platform ? storeNetworkCapture(tabId, message.observation) : { stored: false },
      () => ({ stored: false })
    ).then(
      (result) => sendResponse({ ok: true, ...result }),
      () => sendResponse({ ok: false, error: 'network_capture_storage_failed' })
    );
    return true;
  }

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
void NETWORK_CAPTURE_OBSERVED;
void NETWORK_CAPTURE_BRIDGE_READY_MESSAGE;

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove([
    resultStorageKey(tabId),
    networkCaptureStorageKey(tabId),
    networkCaptureArmStorageKey(tabId)
  ]);
});
