import { nativeSearchPlatform } from '../shared/native-search';
import {
  NETWORK_CAPTURE_MAX_PER_PAGE,
  NETWORK_CAPTURE_OBSERVER_READY,
  NETWORK_CAPTURE_WINDOW_CHANNEL,
  NETWORK_CAPTURE_WINDOW_OBSERVED,
  createNetworkCaptureFromText,
  createNetworkCaptureRejection,
  findNetworkCaptureRoute,
  isJsonContentType,
  type NetworkCaptureObservation
} from '../shared/network-capture';
import type { SupportedPlatform } from '../shared/collection-contracts';

const observerInstalledAttribute = 'collectorNetworkCaptureObserverInstalled';
const observerExpiryProperty = '__personalIntelligenceNetworkCaptureExpiresAt';
const observerPlatformProperty = '__personalIntelligenceNetworkCapturePlatform';
const observerRouteIdsProperty = '__personalIntelligenceNetworkCaptureRouteIds';

interface RequestMetadata {
  url: string;
  method: string;
}

function queryKeyNames(value: string): string[] {
  try {
    const url = new URL(value);
    const keys = new Set<string>();
    url.searchParams.forEach((_entry, key) => {
      if (key.length > 0 && key.length <= 100) keys.add(key.replace(/[^A-Za-z0-9_.\-\[\]]/g, '_'));
    });
    return [...keys].sort();
  } catch {
    return [];
  }
}

async function withBodyEvidence(
  observation: NetworkCaptureObservation | null,
  responseText: string,
  responseUrl: string
): Promise<NetworkCaptureObservation | null> {
  if (!observation) return null;
  const bytes = new TextEncoder().encode(responseText);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const bodySha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return {
    ...observation,
    bodyBytes: bytes.byteLength,
    bodySha256,
    queryKeyNames: queryKeyNames(responseUrl)
  };
}

function platformForCurrentPage(): SupportedPlatform | null {
  const url = new URL(window.location.href);
  const nativePlatform = nativeSearchPlatform(url);
  if (nativePlatform !== 'unsupported') return nativePlatform;
  const platform = (window as Window & { [observerPlatformProperty]?: unknown })[observerPlatformProperty];
  if (
    platform === 'bilibili' &&
    url.protocol === 'https:' &&
    ((url.hostname === 'www.bilibili.com' && /^\/video\/BV[0-9A-Za-z]{10}\/?$/.test(url.pathname)) ||
      (url.hostname === 'space.bilibili.com' && /^\/\d{1,20}\/dynamic\/?$/.test(url.pathname)))
  ) return 'bilibili';
  return null;
}

function isPotentialCapturePage(): boolean {
  return platformForCurrentPage() !== null;
}

function isCaptureWindowActive(): boolean {
  const expiry = (window as Window & { [observerExpiryProperty]?: unknown })[observerExpiryProperty];
  return typeof expiry === 'number' && Number.isFinite(expiry) && Date.now() < expiry;
}

function activeRouteIds(): readonly string[] {
  const value = (window as Window & { [observerRouteIdsProperty]?: unknown })[observerRouteIdsProperty];
  return Array.isArray(value) && value.every((routeId) => typeof routeId === 'string') ? value : [];
}

function requestUrl(input: RequestInfo | URL): string | null {
  try {
    if (typeof input === 'string') return new URL(input, window.location.href).href;
    if (input instanceof Request) return input.url;
    return new URL(input.toString(), window.location.href).href;
  } catch {
    return null;
  }
}

function requestMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (init?.method) return init.method;
  return input instanceof Request ? input.method : 'GET';
}

function parseDeclaredLength(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function readResponseTextWithinLimit(response: Response, maximumBodyBytes: number): Promise<string | null> {
  const declaredLength = parseDeclaredLength(response.headers.get('content-length'));
  if (declaredLength !== null && declaredLength > maximumBodyBytes) return null;

  const clone = response.clone();
  if (!clone.body) return null;
  const reader = clone.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBodyBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function installObserver(): void {
  if (!isCaptureWindowActive() || !isPotentialCapturePage() || document.documentElement.dataset[observerInstalledAttribute] === 'true') return;
  document.documentElement.dataset[observerInstalledAttribute] = 'true';

  const postMessage = window.postMessage.bind(window);
  let emittedCount = 0;

  function emit(observation: NetworkCaptureObservation | null): void {
    if (!observation) return;
    postMessage(
      {
        channel: NETWORK_CAPTURE_WINDOW_CHANNEL,
        type: NETWORK_CAPTURE_WINDOW_OBSERVED,
        observation
      },
      window.location.origin
    );
  }

  async function observeResponse(response: Response, metadata: RequestMetadata): Promise<void> {
    const platform = platformForCurrentPage();
    const responseUrl = response.url || metadata.url;
    if (!isCaptureWindowActive() || !platform || !responseUrl || emittedCount >= NETWORK_CAPTURE_MAX_PER_PAGE) return;
    const route = findNetworkCaptureRoute(platform, responseUrl, activeRouteIds());
    if (!route) return;
    emittedCount += 1;

    const input = {
      platform,
      route,
      method: metadata.method,
      responseUrl,
      contentType: response.headers.get('content-type'),
      httpStatus: response.status
    };
    if (response.status < 200 || response.status >= 300) {
      emit(createNetworkCaptureRejection(input, 'response_status_not_allowed'));
      return;
    }
    if (!isJsonContentType(input.contentType)) {
      emit(createNetworkCaptureRejection(input, 'mime_not_allowed'));
      return;
    }
    const text = await readResponseTextWithinLimit(response, route.maximumBodyBytes);
    emit(text === null
      ? createNetworkCaptureRejection(input, 'payload_too_large')
      : await withBodyEvidence(createNetworkCaptureFromText(input, text), text, responseUrl));
  }

  const originalFetch = window.fetch;
  function observedFetch(
    this: typeof window,
    input: RequestInfo | URL,
    init: RequestInit | undefined = undefined
  ): Promise<Response> {
    const result = arguments.length === 1 ? originalFetch.call(this, input) : originalFetch.call(this, input, init);
    if (!isCaptureWindowActive()) return result;
    const url = requestUrl(input);
    if (url) {
      const metadata = { url, method: requestMethod(input, init) };
      void result.then((response) => observeResponse(response, metadata)).catch(() => undefined);
    }
    return result;
  }
  window.fetch = observedFetch as typeof window.fetch;

  const xhrMetadata = new WeakMap<XMLHttpRequest, RequestMetadata>();
  const originalOpen = XMLHttpRequest.prototype.open as (
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ) => void;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function observedXhrOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async: boolean | undefined = undefined,
    username: string | null | undefined = undefined,
    password: string | null | undefined = undefined
  ): void {
    try {
      xhrMetadata.set(this, { url: new URL(String(url), window.location.href).href, method });
    } catch {
      xhrMetadata.delete(this);
    }
    // Web IDL treats an explicitly passed `undefined` differently from an
    // omitted optional argument in some Chromium paths.  Preserve the page's
    // original arity so a normal asynchronous `xhr.open(method, url)` never
    // becomes an accidental synchronous request.
    if (arguments.length <= 2) return originalOpen.call(this, method, url);
    if (arguments.length === 3) return originalOpen.call(this, method, url, async);
    if (arguments.length === 4) return originalOpen.call(this, method, url, async, username);
    return originalOpen.call(this, method, url, async, username, password);
  };
  XMLHttpRequest.prototype.send = function observedXhrSend(
    this: XMLHttpRequest,
    body: Document | XMLHttpRequestBodyInit | null | undefined = undefined
  ): void {
    this.addEventListener(
      'loadend',
      () => {
        const metadata = xhrMetadata.get(this);
        if (!metadata) return;
        if (!isCaptureWindowActive()) return;
        const platform = platformForCurrentPage();
        const responseUrl = this.responseURL || metadata.url;
        if (!platform || emittedCount >= NETWORK_CAPTURE_MAX_PER_PAGE) return;
        const route = findNetworkCaptureRoute(platform, responseUrl, activeRouteIds());
        if (!route) return;
        emittedCount += 1;

        const input = {
          platform,
          route,
          method: metadata.method,
          responseUrl,
          contentType: this.getResponseHeader('content-type'),
          httpStatus: this.status
        };
        if (this.status < 200 || this.status >= 300) {
          emit(createNetworkCaptureRejection(input, 'response_status_not_allowed'));
          return;
        }
        if (!isJsonContentType(input.contentType)) {
          emit(createNetworkCaptureRejection(input, 'mime_not_allowed'));
          return;
        }
        try {
          const text = this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText;
          if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > route.maximumBodyBytes) {
            emit(createNetworkCaptureRejection(input, 'payload_too_large'));
            return;
          }
          void withBodyEvidence(createNetworkCaptureFromText(input, text), text, responseUrl).then(emit);
        } catch {
          emit(createNetworkCaptureRejection(input, 'unreadable_response'));
        }
      },
      { once: true }
    );
    if (arguments.length === 0) return originalSend.call(this);
    return originalSend.call(this, body);
  };

  postMessage(
    { channel: NETWORK_CAPTURE_WINDOW_CHANNEL, type: NETWORK_CAPTURE_OBSERVER_READY },
    window.location.origin
  );
}

// This file is dynamically injected only after the isolated bridge and
// service worker confirm an arm for this exact top-level navigation. It must
// not expose a page-message switch that would let an unarmed page turn on
// response cloning.
installObserver();
