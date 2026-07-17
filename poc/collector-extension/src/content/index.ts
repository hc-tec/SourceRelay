import { collectVisibleSearchResults } from './adapters';
import {
  COLLECTION_RESULT,
  COLLECT_VISIBLE_RESULTS,
  CONTENT_READY,
  isCollectVisibleResultsMessage
} from '../shared/protocol';

function collect(): ReturnType<typeof collectVisibleSearchResults> {
  return collectVisibleSearchResults(document, window.location);
}

function safePageUrl(): string {
  const url = new URL(window.location.href);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.href;
}

async function waitForRenderedPageState(): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (collect().pageState !== 'layout_unrecognized') return;
    await new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        observer.disconnect();
        clearTimeout(timeout);
        resolve();
      });
      const timeout = setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 500);
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    });
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isCollectVisibleResultsMessage(message)) return;
  const result = collect();
  void chrome.runtime.sendMessage({ type: COLLECTION_RESULT, result }).catch(() => undefined);
  sendResponse({ ok: true, result });
  return false;
});

document.documentElement.dataset.collectorExtensionReady = 'true';
void waitForRenderedPageState()
  .then(() => chrome.runtime.sendMessage({ type: CONTENT_READY, pageUrl: safePageUrl() }))
  .catch(() => undefined);

// Keep the command string referenced by the content bundle, so an accidental
// protocol rename cannot leave the service worker and content script silently
// out of sync.
void COLLECT_VISIBLE_RESULTS;
