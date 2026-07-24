import {
  BILIBILI_COLLECTION_SERIES_STRATEGY_ID,
  STRATEGY_OBSERVATION_SCHEMA_VERSION,
  type BridgeJsonValue,
  type CollectorBindStrategyObserverCommand,
  type CollectorReadStrategyObservationCommand,
  type StrategyObservationResult,
  type StrategyObserverBindingRequest,
  type StrategyObserverBindingResult
} from '@intelligence/collector-contracts';
import {
  bilibiliCollectionSeriesResearchRouteIds,
  type NetworkCaptureObservation
} from '../../shared/network-capture';
import {
  armNetworkCapture,
  getActiveNetworkCaptureArm,
  readNetworkCaptures
} from '../network-capture-runtime';
import {
  clearStrategyBindingsForTab,
  COLLECTION_SERIES_OBSERVER_BINDING_STORAGE_PREFIX
} from '../strategy-binding-state';
import {
  captureBilibiliCollectionSeriesDom,
  type BilibiliCollectionSeriesDomSnapshot
} from './bilibili-collection-series-dom-projection';

type CollectionSeriesBinding = Extract<StrategyObserverBindingRequest, {
  strategyId: typeof BILIBILI_COLLECTION_SERIES_STRATEGY_ID;
}>;

interface StoredBinding {
  schemaVersion: 1;
  tabId: number;
  nextDocumentGeneration: number;
  contentScriptId: string;
  binding: CollectionSeriesBinding;
}

function key(observerBindingId: string): string {
  return `${COLLECTION_SERIES_OBSERVER_BINDING_STORAGE_PREFIX}${observerBindingId}`;
}

function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const match = url.protocol === 'https:' && url.hostname === 'space.bilibili.com'
      ? url.pathname.match(/^\/(\d{1,20})\/lists\/?$/)
      : null;
    return match?.[1] ? `https://space.bilibili.com/${match[1]}/lists` : null;
  } catch {
    return null;
  }
}

async function storedBinding(observerBindingId: string): Promise<StoredBinding | null> {
  const value = (await chrome.storage.session.get(key(observerBindingId)))[key(observerBindingId)] as StoredBinding | undefined;
  return value?.schemaVersion === 1 && value.binding?.observerBindingId === observerBindingId &&
    Date.parse(value.binding.expiresAt) > Date.now()
    ? value
    : null;
}

export async function bindBilibiliCollectionSeriesObserver(
  command: CollectorBindStrategyObserverCommand
): Promise<StrategyObserverBindingResult> {
  const { binding, tabId } = command;
  if (binding.strategyId !== BILIBILI_COLLECTION_SERIES_STRATEGY_ID) {
    throw new Error('collection_series_strategy_id_rejected');
  }
  if (binding.maximumResponseObservations !== 1) {
    throw new Error('collection_series_strategy_response_budget_rejected');
  }
  const permissionsReady = await chrome.permissions.contains({
    origins: ['https://space.bilibili.com/*', 'https://api.bilibili.com/*']
  });
  if (!permissionsReady) throw new Error('collection_series_strategy_permission_missing');
  const tab = await chrome.tabs.get(tabId);
  if (tab.url && tab.url !== 'about:blank' && canonicalUrl(tab.url) !== binding.target.canonicalUrl) {
    throw new Error('collection_series_strategy_tab_context_rejected');
  }
  await clearStrategyBindingsForTab(tabId);
  const contentScriptId = `collector-collection-series-${binding.observerBindingId.replace(/-/g, '')}`;
  await chrome.scripting.unregisterContentScripts({ ids: [contentScriptId] }).catch(() => undefined);
  await chrome.scripting.registerContentScripts([{
    id: contentScriptId,
    matches: ['https://space.bilibili.com/*'],
    js: ['network-capture-bridge.js'],
    runAt: 'document_start',
    allFrames: false,
    persistAcrossSessions: false,
    world: 'ISOLATED'
  }]);
  await armNetworkCapture({
    tabId,
    platform: 'bilibili',
    purpose: 'collection_series_strategy',
    runId: binding.runId,
    navigationUrl: binding.target.canonicalUrl,
    routeIds: bilibiliCollectionSeriesResearchRouteIds(),
    maximumObservations: binding.maximumResponseObservations,
    expiresAt: Date.parse(binding.expiresAt),
    observerBindingId: binding.observerBindingId,
    contentScriptId
  });
  const stored: StoredBinding = {
    schemaVersion: 1,
    tabId,
    nextDocumentGeneration: command.nextDocumentGeneration,
    contentScriptId,
    binding: structuredClone(binding)
  };
  await chrome.storage.session.set({ [key(binding.observerBindingId)]: stored });
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

export async function readBilibiliCollectionSeriesObservation(
  command: CollectorReadStrategyObservationCommand
): Promise<StrategyObservationResult> {
  const stored = await storedBinding(command.request.observerBindingId);
  if (!stored || stored.tabId !== command.tabId ||
    stored.binding.pageLeaseId !== command.request.pageLeaseId ||
    stored.binding.runId !== command.request.runId ||
    stored.binding.pageAlias !== command.request.pageAlias ||
    stored.binding.strategyId !== command.request.strategyId ||
    command.documentGeneration < stored.nextDocumentGeneration) {
    throw new Error('collection_series_strategy_binding_context_rejected');
  }
  const arm = await getActiveNetworkCaptureArm(command.tabId);
  if (!arm || arm.observerBindingId !== command.request.observerBindingId || !arm.documentId) {
    throw new Error('collection_series_strategy_observer_not_bound');
  }
  const deadline = Date.now() + command.request.deadlineMs;
  let dom: BilibiliCollectionSeriesDomSnapshot | null = null;
  let responses: NetworkCaptureObservation[] = [];
  do {
    const tab = await chrome.tabs.get(command.tabId);
    if (!tab.url || canonicalUrl(tab.url) !== stored.binding.target.canonicalUrl) {
      throw new Error('collection_series_strategy_document_context_changed');
    }
    responses = await readNetworkCaptures(command.tabId, arm);
    dom = await captureBilibiliCollectionSeriesDom(command.tabId, arm.documentId);
    if (dom.risk.verificationRequired || dom.risk.rateLimited || dom.risk.sourceUnavailable ||
      (dom.items.length > 0 && responses.some((response) => response.status === 'captured'))) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  if (!dom) throw new Error('collection_series_strategy_dom_unavailable');
  const payload = {
    schemaVersion: 1,
    strategyId: BILIBILI_COLLECTION_SERIES_STRATEGY_ID,
    stableAccountId: stored.binding.target.stableAccountId,
    documentId: arm.documentId,
    dom,
    responses
  } as unknown as BridgeJsonValue;
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  if (payloadBytes > stored.binding.maximumPayloadBytes) {
    throw new Error('collection_series_strategy_observation_payload_too_large');
  }
  return {
    schemaVersion: STRATEGY_OBSERVATION_SCHEMA_VERSION,
    type: 'collector_strategy_observation',
    strategyId: BILIBILI_COLLECTION_SERIES_STRATEGY_ID,
    observerBindingId: stored.binding.observerBindingId,
    pageAlias: stored.binding.pageAlias,
    documentGeneration: command.documentGeneration,
    routeGeneration: command.routeGeneration,
    capturedAt: new Date().toISOString(),
    payloadBytes,
    payload
  };
}

export async function cleanupExpiredBilibiliCollectionSeriesObserverBindings(): Promise<void> {
  const values = await chrome.storage.session.get(null);
  const expiredKeys: string[] = [];
  const expiredScriptIds: string[] = [];
  for (const [storageKey, value] of Object.entries(values)) {
    if (!storageKey.startsWith(COLLECTION_SERIES_OBSERVER_BINDING_STORAGE_PREFIX)) continue;
    const candidate = value as Partial<StoredBinding>;
    if (typeof candidate.binding?.expiresAt === 'string' && Date.parse(candidate.binding.expiresAt) > Date.now()) continue;
    expiredKeys.push(storageKey);
    if (typeof candidate.contentScriptId === 'string') expiredScriptIds.push(candidate.contentScriptId);
  }
  if (expiredScriptIds.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [...new Set(expiredScriptIds)] }).catch(() => undefined);
  }
  if (expiredKeys.length > 0) await chrome.storage.session.remove(expiredKeys);
}
