import {
  NETWORK_CAPTURE_BRIDGE_READY_MESSAGE,
  NETWORK_CAPTURE_OBSERVED,
  type NetworkCaptureObservedMessage
} from '../shared/network-capture';
import {
  activeBoundNetworkCaptureArmForSender,
  bindNetworkCaptureArmToDocument,
  storeNetworkCapture
} from './network-capture-runtime';

let initialised = false;

export function initialiseNetworkObserverController(): void {
  if (initialised) return;
  initialised = true;
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (message && typeof message === 'object' &&
      (message as { type?: unknown }).type === NETWORK_CAPTURE_BRIDGE_READY_MESSAGE) {
      const tabId = sender.tab?.id;
      if (typeof tabId !== 'number' || sender.frameId !== 0) {
        sendResponse({ ok: true, armed: false });
        return false;
      }
      void bindNetworkCaptureArmToDocument(tabId, sender.url, sender.documentId).then(async (arm) => {
        if (!arm) return { ok: true, armed: false };
        if (arm.contentScriptId) {
          await chrome.scripting.unregisterContentScripts({ ids: [arm.contentScriptId] }).catch(() => undefined);
        }
        await chrome.scripting.executeScript({
          target: { tabId, documentIds: [arm.documentId] },
          world: 'MAIN',
          func: (expiresAt: number, platform: string, routeIds: readonly string[]) => {
            Object.defineProperty(window, '__personalIntelligenceNetworkCaptureExpiresAt', {
              value: expiresAt,
              writable: false,
              configurable: true
            });
            Object.defineProperty(window, '__personalIntelligenceNetworkCapturePlatform', {
              value: platform,
              writable: false,
              configurable: true
            });
            Object.defineProperty(window, '__personalIntelligenceNetworkCaptureRouteIds', {
              value: [...routeIds],
              writable: false,
              configurable: true
            });
          },
          args: [arm.expiresAt, arm.platform, arm.routeIds],
          injectImmediately: true
        });
        await chrome.scripting.executeScript({
          target: { tabId, documentIds: [arm.documentId] },
          world: 'MAIN',
          files: ['main-world-network-observer.js'],
          injectImmediately: true
        });
        return { ok: true, armed: true, expiresAt: arm.expiresAt, routeIds: arm.routeIds };
      }).then(
        sendResponse,
        () => sendResponse({ ok: true, armed: false })
      );
      return true;
    }

    if (isNetworkCaptureObservedMessage(message)) {
      const tabId = sender.tab?.id;
      if (typeof tabId !== 'number' || sender.frameId !== 0 || !sender.url) {
        sendResponse({ ok: false, error: 'network_capture_source_rejected' });
        return false;
      }
      void activeBoundNetworkCaptureArmForSender(tabId, sender.url, sender.documentId).then(
        (arm) => arm?.platform === message.observation.platform
          ? storeNetworkCapture(tabId, message.observation, arm)
          : { stored: false }
      ).then(
        (result) => sendResponse({ ok: true, ...result }),
        () => sendResponse({ ok: false, error: 'network_capture_storage_failed' })
      );
      return true;
    }
    return false;
  });
}

function isNetworkCaptureObservedMessage(value: unknown): value is NetworkCaptureObservedMessage {
  return Boolean(value && typeof value === 'object' &&
    (value as { type?: unknown }).type === NETWORK_CAPTURE_OBSERVED &&
    (value as { observation?: unknown }).observation);
}
