import { collectVisiblePageResult } from './adapters';
import {
  COLLECTION_RESULT,
  COLLECT_VISIBLE_RESULTS,
  CONTENT_READY,
  isCollectVisibleResultsMessage,
  isProbeContentInstallationMessage
} from '../shared/protocol';

function collect(): ReturnType<typeof collectVisiblePageResult> {
  return collectVisiblePageResult(document, window.location);
}

function safePageUrl(): string {
  const url = new URL(window.location.href);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.href;
}

function resultReadyForDelivery(result: ReturnType<typeof collect>): boolean {
  if (result.pageState !== 'layout_unrecognized' && result.pageState !== 'results_visible') return true;
  if (result.operation === 'breadth_search') return result.pageState === 'results_visible';
  return Boolean(
    result.detail?.publishedText &&
    result.detail.visibleMetrics.length >= 2 &&
    (result.detail.description || result.detail.creator)
  );
}

async function announceRenderedPageState(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const result = collect();
      if (resultReadyForDelivery(result)) {
        const response = await chrome.runtime.sendMessage({ type: COLLECTION_RESULT, result });
        if (response?.ok === true) return;
      }
    } catch {
      // The page or MV3 worker may be crossing a lifecycle boundary. Observe
      // the next rendered state instead of permanently abandoning this stage.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  // Keep the readiness protocol as a final compatibility signal for an
  // admitted validation surface whose result-push handler was unavailable.
  await chrome.runtime.sendMessage({ type: CONTENT_READY, pageUrl: safePageUrl() }).catch(() => undefined);
}

if (document.documentElement.dataset.collectorExtensionReady !== 'true') {
  // The worker may deliberately retry the same fixed bundle when a page keeps
  // loading indefinitely. Set the marker before registering anything so two
  // near-simultaneous injections cannot create duplicate listeners or Evidence.
  document.documentElement.dataset.collectorExtensionReady = 'true';
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (isProbeContentInstallationMessage(message)) {
      sendResponse({ ok: true, installed: true, pageUrl: safePageUrl() });
      return false;
    }
    if (!isCollectVisibleResultsMessage(message)) return;
    const result = collect();
    sendResponse({ ok: true, result });
    return false;
  });

  void announceRenderedPageState().catch(() => undefined);
}

// Keep the command string referenced by the content bundle, so an accidental
// protocol rename cannot leave the service worker and content script silently
// out of sync.
void COLLECT_VISIBLE_RESULTS;
