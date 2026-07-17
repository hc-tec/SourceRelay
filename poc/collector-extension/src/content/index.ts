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

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isCollectVisibleResultsMessage(message)) return;
  const result = collect();
  void chrome.runtime.sendMessage({ type: COLLECTION_RESULT, result }).catch(() => undefined);
  sendResponse({ ok: true, result });
  return false;
});

document.documentElement.dataset.collectorExtensionReady = 'true';
void chrome.runtime.sendMessage({ type: CONTENT_READY, pageUrl: window.location.href }).catch(() => undefined);

// Keep the command string referenced by the content bundle, so an accidental
// protocol rename cannot leave the service worker and content script silently
// out of sync.
void COLLECT_VISIBLE_RESULTS;
