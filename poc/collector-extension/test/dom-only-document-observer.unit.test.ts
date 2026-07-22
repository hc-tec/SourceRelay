import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  BILIBILI_VIDEO_DETAIL_STRATEGY_ID,
  type CollectorBindStrategyObserverCommand,
  type CollectorReadStrategyObservationCommand,
  type StrategyObserverBindingRequest
} from '@intelligence/collector-contracts';
import { createDomOnlyDocumentObserver } from '../src/background/strategies/dom-only-document-observer';

type VideoDetailBinding = Extract<StrategyObserverBindingRequest, {
  strategyId: typeof BILIBILI_VIDEO_DETAIL_STRATEGY_ID;
}>;

const tabId = 71;
const canonicalUrl = 'https://www.bilibili.com/video/BV1qZSLBYEpa';
const bindingId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const leaseId = '33333333-3333-4333-8333-333333333333';

interface StoredBindingForAssertion {
  schemaVersion: number;
  documentId: string | null;
  documentBindCount: number;
}

function binding(): VideoDetailBinding {
  return {
    schemaVersion: 1,
    profileId: '44444444-4444-4444-8444-444444444444',
    pageAlias: 'page-1',
    pageLeaseId: leaseId,
    expectedRecordVersion: 1,
    runId,
    observerBindingId: bindingId,
    strategyId: BILIBILI_VIDEO_DETAIL_STRATEGY_ID,
    target: { canonicalUrl, bvid: 'BV1qZSLBYEpa' },
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    maximumResponseObservations: 0,
    maximumPayloadBytes: 8_192,
    documentBindingMode: 'next_navigation_only'
  };
}

function bindCommand(): CollectorBindStrategyObserverCommand {
  return {
    type: 'collector_bind_strategy_observer',
    tabId,
    nextDocumentGeneration: 1,
    binding: binding()
  };
}

function readCommand(): CollectorReadStrategyObservationCommand {
  return {
    type: 'collector_read_strategy_observation',
    tabId,
    documentGeneration: 2,
    routeGeneration: 0,
    request: {
      schemaVersion: 1,
      profileId: '44444444-4444-4444-8444-444444444444',
      pageAlias: 'page-1',
      pageLeaseId: leaseId,
      expectedRecordVersion: 2,
      runId,
      observerBindingId: bindingId,
      strategyId: BILIBILI_VIDEO_DETAIL_STRATEGY_ID,
      deadlineMs: 1_000
    }
  };
}

function keyForBinding(): string {
  return `test.dom-only.${bindingId}`;
}

describe('DOM-only document observer', () => {
  const originalChrome = globalThis.chrome;

  afterEach(() => {
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: originalChrome
    });
  });

  test('keeps its document-start bridge armed and reconciles a same-target replacement', async () => {
    const session = new Map<string, unknown>();
    let currentTabUrl = 'about:blank';
    let currentDocumentId = 'document-a';
    let messageListener: ((
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void
    ) => boolean | void) | null = null;
    const unregisterContentScripts = vi.fn(async () => undefined);
    const registerContentScripts = vi.fn(async () => undefined);
    const getRegisteredContentScripts = vi.fn(async () => [{
      id: `test-dom-only-${bindingId.replace(/-/g, '')}`
    }]);
    const capture = vi.fn(async ({ documentId }: { documentId: string }) => ({ documentId }));

    const sessionArea = {
      get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
        if (keys === null || keys === undefined) return Object.fromEntries(session);
        if (typeof keys === 'string') return { [keys]: session.get(keys) };
        if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, session.get(key)]));
        return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, session.get(key) ?? fallback]));
      }),
      set: vi.fn(async (values: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(values)) session.set(key, value);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) session.delete(key);
      })
    };

    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        storage: { session: sessionArea },
        permissions: { contains: vi.fn(async () => true) },
        tabs: { get: vi.fn(async () => ({ id: tabId, url: currentTabUrl })) },
        scripting: {
          unregisterContentScripts,
          registerContentScripts,
          getRegisteredContentScripts,
          executeScript: vi.fn(async () => [])
        },
        webNavigation: {
          getFrame: vi.fn(async () => ({
            documentId: currentDocumentId,
            frameId: 0,
            url: currentTabUrl,
            documentLifecycle: 'active',
            errorOccurred: false,
            parentFrameId: -1,
            processId: 1
          }))
        },
        runtime: {
          onMessage: {
            addListener: (listener: typeof messageListener) => {
              messageListener = listener;
            }
          }
        }
      } as unknown as typeof chrome
    });

    const observer = createDomOnlyDocumentObserver<VideoDetailBinding, { documentId: string }>({
      strategyId: BILIBILI_VIDEO_DETAIL_STRATEGY_ID,
      errorPrefix: 'test_dom_only',
      storageKeyPrefix: 'test.dom-only.',
      contentScriptIdPrefix: 'test-dom-only-',
      contentScriptMatches: ['https://www.bilibili.com/video/*'],
      contentScriptJs: 'test-document-bridge.js',
      requiredOrigins: ['https://www.bilibili.com/*'],
      documentReadyMessage: 'test_document_ready',
      isDocumentReadyMessage: (value) => (value as { type?: unknown })?.type === 'test_document_ready',
      canonicalTargetUrl: (value) => value.target.canonicalUrl,
      canonicalObservedUrl: (value) => value.replace(/\/$/, '') === canonicalUrl ? canonicalUrl : null,
      capture,
      isReady: () => true,
      toPayload: ({ documentId, dom }) => ({ documentId, dom })
    });

    observer.initialiseDocumentBridge();
    await observer.bind(bindCommand());
    const unregistrationsAfterBind = unregisterContentScripts.mock.calls.length;
    expect(registerContentScripts).toHaveBeenCalledTimes(1);

    currentTabUrl = canonicalUrl;
    const bridgeResponse = await new Promise<unknown>((resolve) => {
      expect(messageListener?.({ type: 'test_document_ready' }, {
        tab: { id: tabId } as chrome.tabs.Tab, frameId: 0, documentId: 'document-a', url: canonicalUrl
      }, resolve)).toBe(true);
    });
    expect(bridgeResponse).toEqual({ ok: true, bound: true });
    expect(session.get(keyForBinding())).toMatchObject<StoredBindingForAssertion>({
      schemaVersion: 3,
      documentId: 'document-a',
      documentBindCount: 1
    });

    // The source has committed a second main document at the same canonical
    // URL.  No synthetic page is involved here: this proves the extension's
    // storage and Chrome-frame reconciliation contract in isolation.
    currentDocumentId = 'document-b';
    const observation = await observer.read(readCommand());

    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ tabId, documentId: 'document-b' }));
    expect(observation.documentGeneration).toBe(2);
    expect(session.get(keyForBinding())).toMatchObject<StoredBindingForAssertion>({
      schemaVersion: 3,
      documentId: 'document-b',
      documentBindCount: 2
    });
    await expect(observer.diagnose({
      type: 'collector_read_strategy_binding_diagnostics',
      tabId,
      observerBindingId: bindingId,
      strategyId: BILIBILI_VIDEO_DETAIL_STRATEGY_ID
    })).resolves.toEqual({
      schemaVersion: 1,
      type: 'collector_strategy_binding_diagnostics',
      strategyId: BILIBILI_VIDEO_DETAIL_STRATEGY_ID,
      observerBindingId: bindingId,
      bindingState: 'active',
      documentBindingState: 'bound',
      documentBindCount: 2,
      bridgeRegistration: 'registered',
      currentMainFrameState: 'matches_bound_document'
    });
    // The bridge remains registered across the first document handoff; its
    // cleanup is owned by binding expiry or a subsequent task, never by the
    // first document-start message.
    expect(unregisterContentScripts.mock.calls.length).toBe(unregistrationsAfterBind);
  });
});
