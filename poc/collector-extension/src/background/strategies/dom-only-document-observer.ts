import {
  STRATEGY_OBSERVATION_SCHEMA_VERSION,
  type BridgeJsonValue,
  type CollectorBindStrategyObserverCommand,
  type CollectorReadStrategyObservationCommand,
  type StrategyObservationResult,
  type StrategyObserverBindingRequest,
  type StrategyObserverBindingResult
} from '@intelligence/collector-contracts';
import { clearStrategyBindingsForTab } from '../strategy-binding-state';

interface StoredDomOnlyBinding<TBinding extends StrategyObserverBindingRequest> {
  schemaVersion: 2;
  tabId: number;
  nextDocumentGeneration: number;
  contentScriptId: string;
  documentId: string | null;
  documentBoundAt: number | null;
  excludedDocumentId: string | null;
  binding: TBinding;
}

export interface DomOnlyDocumentObserverConfig<
  TBinding extends StrategyObserverBindingRequest,
  TDomSnapshot
> {
  strategyId: TBinding['strategyId'];
  errorPrefix: string;
  storageKeyPrefix: string;
  contentScriptIdPrefix: string;
  contentScriptMatches: string[];
  contentScriptJs: string;
  requiredOrigins: string[];
  documentReadyMessage: string;
  isDocumentReadyMessage: (value: unknown) => boolean;
  canonicalTargetUrl: (binding: TBinding) => string;
  canonicalObservedUrl: (value: string) => string | null;
  capture: (input: {
    tabId: number;
    documentId: string;
    binding: TBinding;
  }) => Promise<TDomSnapshot>;
  /**
   * A source-specific first-render settle window. This is not an interaction
   * delay or retry: it prevents a document-start binding from treating a
   * title and an empty player shell as the finished visible first screen.
   */
  minimumDocumentSettleMs?: number;
  isReady: (snapshot: TDomSnapshot, binding: TBinding) => boolean;
  toPayload: (input: {
    documentId: string;
    binding: TBinding;
    dom: TDomSnapshot;
  }) => BridgeJsonValue;
}

export interface DomOnlyDocumentObserver<TBinding extends StrategyObserverBindingRequest> {
  initialiseDocumentBridge(): void;
  bind(command: CollectorBindStrategyObserverCommand): Promise<StrategyObserverBindingResult>;
  read(command: CollectorReadStrategyObservationCommand): Promise<StrategyObservationResult>;
  cleanupExpiredBindings(): Promise<void>;
}

/**
 * Shared mechanics for a source-specific DOM-only strategy. The config fixes
 * every URL matcher, document-start bridge and projection callback at compile
 * time; no caller can pass a selector, JavaScript expression or Network arm.
 */
export function createDomOnlyDocumentObserver<
  TBinding extends StrategyObserverBindingRequest,
  TDomSnapshot
>(config: DomOnlyDocumentObserverConfig<TBinding, TDomSnapshot>): DomOnlyDocumentObserver<TBinding> {
  const minimumDocumentSettleMs = config.minimumDocumentSettleMs ?? 0;
  if (!Number.isSafeInteger(minimumDocumentSettleMs) || minimumDocumentSettleMs < 0 || minimumDocumentSettleMs > 10_000) {
    throw new Error(`${config.errorPrefix}_document_settle_window_invalid`);
  }
  let documentBridgeInitialised = false;
  const error = (suffix: string): string => `${config.errorPrefix}_${suffix}`;
  const bindingStorageKey = (observerBindingId: string): string =>
    `${config.storageKeyPrefix}${observerBindingId}`;

  async function storedBinding(observerBindingId: string): Promise<StoredDomOnlyBinding<TBinding> | null> {
    const key = bindingStorageKey(observerBindingId);
    const value = (await chrome.storage.session.get(key))[key] as StoredDomOnlyBinding<TBinding> | undefined;
    return value?.schemaVersion === 2 &&
      value.binding?.observerBindingId === observerBindingId &&
      (value.documentId === null || (typeof value.documentId === 'string' && Number.isSafeInteger(value.documentBoundAt))) &&
      value.binding.strategyId === config.strategyId &&
      Date.parse(value.binding.expiresAt) > Date.now()
      ? value
      : null;
  }

  async function storedBindingForTab(tabId: number): Promise<StoredDomOnlyBinding<TBinding> | null> {
    const values = await chrome.storage.session.get(null);
    for (const [key, value] of Object.entries(values)) {
      if (!key.startsWith(config.storageKeyPrefix)) continue;
      const candidate = value as StoredDomOnlyBinding<TBinding>;
      if (
        candidate.schemaVersion === 2 &&
        candidate.tabId === tabId &&
        candidate.documentId === null &&
        candidate.binding?.strategyId === config.strategyId &&
        Date.parse(candidate.binding?.expiresAt) > Date.now()
      ) return candidate;
    }
    return null;
  }

  function matchesReadContext(
    stored: StoredDomOnlyBinding<TBinding> | null,
    command: CollectorReadStrategyObservationCommand
  ): stored is StoredDomOnlyBinding<TBinding> {
    return Boolean(
      stored &&
      stored.tabId === command.tabId &&
      stored.binding.pageLeaseId === command.request.pageLeaseId &&
      stored.binding.runId === command.request.runId &&
      stored.binding.pageAlias === command.request.pageAlias &&
      stored.binding.strategyId === command.request.strategyId &&
      command.documentGeneration >= stored.nextDocumentGeneration
    );
  }

  async function bindDocument(
    tabId: number,
    senderUrl: string | undefined,
    documentId: string
  ): Promise<boolean> {
    const stored = await storedBindingForTab(tabId);
    if (
      !stored ||
      // A binding owns one exact main-frame document. A late duplicate
      // document_start signal must not replace that document identity.
      stored.documentId !== null ||
      // A retained exact-target tab can be navigated again by a new run. In
      // that case, a delayed bridge message from the old document must never
      // satisfy the binding intended for the next document.
      stored.excludedDocumentId === documentId ||
      config.canonicalObservedUrl(senderUrl ?? '') !== config.canonicalTargetUrl(stored.binding)
    ) return false;
    const updated: StoredDomOnlyBinding<TBinding> = { ...stored, documentId, documentBoundAt: Date.now() };
    await chrome.storage.session.set({ [bindingStorageKey(updated.binding.observerBindingId)]: updated });
    await chrome.scripting.unregisterContentScripts({ ids: [updated.contentScriptId] }).catch(() => undefined);
    return true;
  }

  /**
   * Some real sites replace their main frame once more after the first
   * DOMContentLoaded while remaining on the same canonical URL. A one-shot
   * document-start message then belongs to a page that no longer exists.
   *
   * Reconcile only with Chrome's own current main-frame document identity,
   * after rechecking the exact tab and canonical target. This never accepts a
   * caller-supplied document id, runs no page DOM projection, and performs no
   * platform action. It also preserves `excludedDocumentId` for a retained
   * tab whose next navigation was explicitly required.
   */
  async function reconcileCurrentDocument(
    stored: StoredDomOnlyBinding<TBinding>
  ): Promise<StoredDomOnlyBinding<TBinding>> {
    const tab = await chrome.tabs.get(stored.tabId);
    const observedUrl = tab.url ? config.canonicalObservedUrl(tab.url) : null;
    const expectedUrl = config.canonicalTargetUrl(stored.binding);
    if (observedUrl !== expectedUrl) {
      if (stored.documentId !== null) throw new Error(error('document_context_changed'));
      return stored;
    }
    const currentDocument = (await chrome.scripting.executeScript({
      target: { tabId: stored.tabId },
      world: 'ISOLATED',
      func: (): null => null
    })).find((result) => result.frameId === 0) ?? null;
    if (!currentDocument?.documentId || currentDocument.documentId === stored.excludedDocumentId ||
      currentDocument.documentId === stored.documentId) return stored;
    const updated: StoredDomOnlyBinding<TBinding> = {
      ...stored,
      documentId: currentDocument.documentId,
      documentBoundAt: Date.now()
    };
    await chrome.storage.session.set({ [bindingStorageKey(updated.binding.observerBindingId)]: updated });
    return updated;
  }

  function initialiseDocumentBridge(): void {
    if (documentBridgeInitialised) return;
    documentBridgeInitialised = true;
    chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
      if (!config.isDocumentReadyMessage(message)) return false;
      const tabId = sender.tab?.id;
      if (typeof tabId !== 'number' || sender.frameId !== 0 || !sender.documentId) {
        sendResponse({ ok: true, bound: false });
        return false;
      }
      void bindDocument(tabId, sender.url, sender.documentId).then(
        (bound) => sendResponse({ ok: true, bound }),
        () => sendResponse({ ok: true, bound: false })
      );
      return true;
    });
  }

  async function cleanupExpiredBindings(): Promise<void> {
    const values = await chrome.storage.session.get(null);
    const expiredKeys: string[] = [];
    const expiredScriptIds: string[] = [];
    for (const [key, value] of Object.entries(values)) {
      if (!key.startsWith(config.storageKeyPrefix)) continue;
      const candidate = value as Partial<StoredDomOnlyBinding<TBinding>>;
      if (typeof candidate.binding?.expiresAt === 'string' && Date.parse(candidate.binding.expiresAt) > Date.now()) {
        continue;
      }
      expiredKeys.push(key);
      if (typeof candidate.contentScriptId === 'string') expiredScriptIds.push(candidate.contentScriptId);
    }
    if (expiredScriptIds.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [...new Set(expiredScriptIds)] }).catch(() => undefined);
    }
    if (expiredKeys.length > 0) await chrome.storage.session.remove(expiredKeys);
  }

  async function bind(command: CollectorBindStrategyObserverCommand): Promise<StrategyObserverBindingResult> {
    const binding = command.binding as TBinding;
    if (binding.strategyId !== config.strategyId) throw new Error(error('id_rejected'));
    if (binding.maximumResponseObservations !== 0) throw new Error(error('response_budget_rejected'));
    await cleanupExpiredBindings();
    const permissionsReady = await chrome.permissions.contains({ origins: config.requiredOrigins });
    if (!permissionsReady) throw new Error(error('permission_missing'));
    const tab = await chrome.tabs.get(command.tabId);
    if (
      tab.url &&
      tab.url !== 'about:blank' &&
      config.canonicalObservedUrl(tab.url) !== config.canonicalTargetUrl(binding)
    ) throw new Error(error('tab_context_rejected'));
    const nextNavigationOnly = binding.documentBindingMode === 'next_navigation_only';
    let excludedDocumentId: string | null = null;
    if (nextNavigationOnly && tab.url && tab.url !== 'about:blank') {
      const currentDocument = (await chrome.scripting.executeScript({
        target: { tabId: command.tabId },
        world: 'ISOLATED',
        func: (): null => null
      })).find((result) => result.frameId === 0) ?? null;
      if (!currentDocument?.documentId) throw new Error(error('current_document_identity_unavailable'));
      excludedDocumentId = currentDocument.documentId;
    }
    await clearStrategyBindingsForTab(command.tabId);
    const contentScriptId = `${config.contentScriptIdPrefix}${binding.observerBindingId.replace(/-/g, '')}`;
    await chrome.scripting.unregisterContentScripts({ ids: [contentScriptId] }).catch(() => undefined);
    await chrome.scripting.registerContentScripts([{
      id: contentScriptId,
      matches: config.contentScriptMatches,
      js: [config.contentScriptJs],
      runAt: 'document_start',
      allFrames: false,
      persistAcrossSessions: false,
      world: 'ISOLATED'
    }]);
    const stored: StoredDomOnlyBinding<TBinding> = {
      schemaVersion: 2,
      tabId: command.tabId,
      nextDocumentGeneration: command.nextDocumentGeneration,
      contentScriptId,
      documentId: null,
      documentBoundAt: null,
      excludedDocumentId,
      binding: structuredClone(binding)
    };
    await chrome.storage.session.set({ [bindingStorageKey(binding.observerBindingId)]: stored });

    // A retained exact target does not re-run a newly registered document-start
    // script. This fixed handshake is safe only when the caller has explicitly
    // allowed the current document; a run that will navigate must wait for the
    // next document-start signal instead.
    if (!nextNavigationOnly && tab.url && config.canonicalObservedUrl(tab.url) === config.canonicalTargetUrl(binding)) {
      await chrome.scripting.executeScript({
        target: { tabId: command.tabId },
        world: 'ISOLATED',
        func: (messageType: string) => void chrome.runtime.sendMessage({ type: messageType }).catch(() => undefined),
        args: [config.documentReadyMessage],
        injectImmediately: true
      });
    }
    return {
      schemaVersion: STRATEGY_OBSERVATION_SCHEMA_VERSION,
      type: 'collector_strategy_observer_binding',
      strategyId: binding.strategyId,
      observerBindingId: binding.observerBindingId,
      pageAlias: binding.pageAlias,
      state: 'ready',
      nextDocumentGeneration: command.nextDocumentGeneration,
      expiresAt: binding.expiresAt
    };
  }

  async function read(command: CollectorReadStrategyObservationCommand): Promise<StrategyObservationResult> {
    if (command.request.strategyId !== config.strategyId) throw new Error(error('id_rejected'));
    const deadline = Date.now() + command.request.deadlineMs;
    let stored = await storedBinding(command.request.observerBindingId);
    if (!matchesReadContext(stored, command)) throw new Error(error('binding_context_rejected'));
    let dom: TDomSnapshot | null = null;
    do {
      stored = await storedBinding(command.request.observerBindingId);
      if (!matchesReadContext(stored, command)) throw new Error(error('binding_context_rejected'));
      stored = await reconcileCurrentDocument(stored);
      if (!stored.documentId) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      const earliestCaptureAt = (stored.documentBoundAt ?? Date.now()) + minimumDocumentSettleMs;
      if (Date.now() < earliestCaptureAt) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(250, earliestCaptureAt - Date.now())));
        continue;
      }
      dom = await config.capture({ tabId: command.tabId, documentId: stored.documentId, binding: stored.binding });
      if (config.isReady(dom, stored.binding)) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    if (!stored?.documentId) throw new Error(error('document_not_bound'));
    if (!dom) throw new Error(error('dom_unavailable'));
    const payload = config.toPayload({ documentId: stored.documentId, binding: stored.binding, dom });
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    if (payloadBytes > stored.binding.maximumPayloadBytes) {
      throw new Error(error('observation_payload_too_large'));
    }
    return {
      schemaVersion: STRATEGY_OBSERVATION_SCHEMA_VERSION,
      type: 'collector_strategy_observation',
      strategyId: config.strategyId,
      observerBindingId: stored.binding.observerBindingId,
      pageAlias: stored.binding.pageAlias,
      documentGeneration: command.documentGeneration,
      routeGeneration: command.routeGeneration,
      capturedAt: new Date().toISOString(),
      payloadBytes,
      payload
    };
  }

  return { initialiseDocumentBridge, bind, read, cleanupExpiredBindings };
}
