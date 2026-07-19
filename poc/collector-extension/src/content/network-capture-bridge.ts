import {
  NETWORK_CAPTURE_OBSERVER_READY,
  NETWORK_CAPTURE_OBSERVED,
  NETWORK_CAPTURE_WINDOW_CHANNEL,
  NETWORK_CAPTURE_WINDOW_OBSERVED,
  sanitiseNetworkCaptureObservation
} from '../shared/network-capture';
import { NETWORK_CAPTURE_BRIDGE_READY_MESSAGE } from '../shared/protocol';

const observerReadyAttribute = 'collectorNetworkCaptureObserver';

let forwardQueue = Promise.resolve();
let armedUntil = 0;
let observerReady = false;
let armedRouteIds: string[] = [];

function publishObserverReadyIfArmed(): void {
  if (observerReady && Date.now() < armedUntil) {
    document.documentElement.dataset[observerReadyAttribute] = 'ready';
  }
}

function isBridgeMessage(value: unknown): value is { channel: string; type: string; observation?: unknown } {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { channel?: unknown }).channel === NETWORK_CAPTURE_WINDOW_CHANNEL &&
      typeof (value as { type?: unknown }).type === 'string'
  );
}

window.addEventListener('message', (event) => {
  // MAIN-world scripts share a Window with page code.  Treat every event as
  // hostile input even when source/origin match, then apply the same route and
  // redaction policy a second time before it can reach chrome.runtime.
  if (event.source !== window || event.origin !== window.location.origin || !isBridgeMessage(event.data)) return;

  if (event.data.type === NETWORK_CAPTURE_OBSERVER_READY) {
    observerReady = true;
    publishObserverReadyIfArmed();
    return;
  }
  if (event.data.type !== NETWORK_CAPTURE_WINDOW_OBSERVED || Date.now() >= armedUntil) return;

  const observation = sanitiseNetworkCaptureObservation(event.data.observation, armedRouteIds);
  if (!observation) return;

  forwardQueue = forwardQueue
    .catch(() => undefined)
    .then(() => Date.now() < armedUntil ? chrome.runtime.sendMessage({ type: NETWORK_CAPTURE_OBSERVED, observation }) : undefined)
    .catch(() => undefined);
});

async function armNetworkCaptureIfAuthorised(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: NETWORK_CAPTURE_BRIDGE_READY_MESSAGE });
  if (
    !response?.ok ||
    response.armed !== true ||
    typeof response.expiresAt !== 'number' ||
    response.expiresAt <= Date.now() ||
    !Array.isArray(response.routeIds) ||
    !response.routeIds.every((routeId: unknown) => typeof routeId === 'string')
  ) return;
  // The Worker only returns armed after chrome.scripting has injected the
  // fixed observer into this exact tab/document.  Keep an isolated-world TTL
  // gate as well, so queued page messages stop before reaching the Worker.
  armedUntil = response.expiresAt;
  armedRouteIds = [...response.routeIds];
  publishObserverReadyIfArmed();
}

void armNetworkCaptureIfAuthorised().catch(() => undefined);
