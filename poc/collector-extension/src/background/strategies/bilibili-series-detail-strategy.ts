import {
  BILIBILI_COLLECTION_SERIES_DETAIL_STRATEGY_ID,
  STRATEGY_OBSERVATION_SCHEMA_VERSION,
  type BridgeJsonValue,
  type CollectorBindStrategyObserverCommand,
  type CollectorReadStrategyObservationCommand,
  type StrategyObservationResult,
  type StrategyObserverBindingRequest,
  type StrategyObserverBindingResult
} from '@intelligence/collector-contracts';
import {
  bilibiliCollectionSeriesDetailResearchRouteIds,
  type NetworkCaptureObservation
} from '../../shared/network-capture';
import {
  armNetworkCapture,
  clearNetworkCaptureObservations,
  getActiveNetworkCaptureArm,
  readNetworkCaptures
} from '../network-capture-runtime';
import {
  clearStrategyBindingsForTab,
  COLLECTION_SERIES_DETAIL_OBSERVER_BINDING_STORAGE_PREFIX
} from '../strategy-binding-state';
import {
  captureBilibiliCollectionSeriesDetailDom,
  type BilibiliCollectionSeriesDetailDomSnapshot
} from './bilibili-series-detail-dom-projection';

type CollectionSeriesDetailBinding = Extract<StrategyObserverBindingRequest, {
  strategyId: typeof BILIBILI_COLLECTION_SERIES_DETAIL_STRATEGY_ID;
}>;

interface StoredBinding {
  schemaVersion: 1;
  tabId: number;
  nextDocumentGeneration: number;
  contentScriptId: string;
  binding: CollectionSeriesDetailBinding;
}

function key(observerBindingId: string): string {
  return `${COLLECTION_SERIES_DETAIL_OBSERVER_BINDING_STORAGE_PREFIX}${observerBindingId}`;
}

function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const match = url.protocol === 'https:' && url.hostname === 'space.bilibili.com'
      ? url.pathname.match(/^\/(\d{1,20})\/lists\/(\d{1,20})\/?$/)
      : null;
    const type = url.searchParams.get('type');
    return match?.[1] && match[2] && (type === 'series' || type === 'season')
      ? `https://space.bilibili.com/${match[1]}/lists/${match[2]}?type=${type}`
      : null;
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

export async function bindBilibiliCollectionSeriesDetailObserver(
  command: CollectorBindStrategyObserverCommand
): Promise<StrategyObserverBindingResult> {
  const { binding, tabId } = command;
  if (binding.strategyId !== BILIBILI_COLLECTION_SERIES_DETAIL_STRATEGY_ID) {
    throw new Error('collection_series_detail_strategy_id_rejected');
  }
  if (binding.maximumResponseObservations !== 1) {
    throw new Error('collection_series_detail_strategy_response_budget_rejected');
  }
  const permissionsReady = await chrome.permissions.contains({
    origins: ['https://space.bilibili.com/*', 'https://api.bilibili.com/*']
  });
  if (!permissionsReady) throw new Error('collection_series_detail_strategy_permission_missing');
  const tab = await chrome.tabs.get(tabId);
  if (tab.url && tab.url !== 'about:blank' && canonicalUrl(tab.url) !== binding.target.canonicalUrl) {
    throw new Error('collection_series_detail_strategy_tab_context_rejected');
  }
  await clearStrategyBindingsForTab(tabId);
  const contentScriptId = `collector-collection-series-detail-${binding.observerBindingId.replace(/-/g, '')}`;
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
    purpose: 'collection_series_detail_strategy',
    runId: binding.runId,
    navigationUrl: binding.target.canonicalUrl,
    routeIds: bilibiliCollectionSeriesDetailResearchRouteIds(),
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

export async function readBilibiliCollectionSeriesDetailObservation(
  command: CollectorReadStrategyObservationCommand
): Promise<StrategyObservationResult> {
  const stored = await storedBinding(command.request.observerBindingId);
  if (!stored || stored.tabId !== command.tabId ||
    stored.binding.pageLeaseId !== command.request.pageLeaseId ||
    stored.binding.runId !== command.request.runId ||
    stored.binding.pageAlias !== command.request.pageAlias ||
    stored.binding.strategyId !== command.request.strategyId ||
    command.documentGeneration < stored.nextDocumentGeneration) {
    throw new Error('collection_series_detail_strategy_binding_context_rejected');
  }
  const arm = await getActiveNetworkCaptureArm(command.tabId);
  if (!arm || arm.purpose !== 'collection_series_detail_strategy' ||
    arm.observerBindingId !== command.request.observerBindingId || !arm.documentId) {
    throw new Error('collection_series_detail_strategy_observer_not_bound');
  }
  const deadline = Date.now() + command.request.deadlineMs;
  let dom: BilibiliCollectionSeriesDetailDomSnapshot | null = null;
  let responses: NetworkCaptureObservation[] = [];
  let captured: NetworkCaptureObservation | undefined;
  do {
    const tab = await chrome.tabs.get(command.tabId);
    if (!tab.url || canonicalUrl(tab.url) !== stored.binding.target.canonicalUrl) {
      throw new Error('collection_series_detail_strategy_document_context_changed');
    }
    responses = await readNetworkCaptures(command.tabId, arm);
    dom = await captureBilibiliCollectionSeriesDetailDom(command.tabId, arm.documentId);
    captured = responses.find((response) => response.status === 'captured' && response.body !== undefined);
    // The response is the complete page source of truth.  The detail page
    // virtualises card shells, so the DOM can legitimately expose fewer
    // cards than the response (for example 25 of 30) even after the page is
    // stable.  Wait only for a non-empty DOM sample; requiring it to catch
    // up to the response count made the extension command hold the bridge
    // open until its deadline and masked the otherwise valid response.
    const domReady = dom.videoIds.length > 0;
    if (dom.risk.verificationRequired || dom.risk.rateLimited || dom.risk.sourceUnavailable ||
      (captured && domReady)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  if (!dom) throw new Error('collection_series_detail_strategy_dom_unavailable');
  const payload = {
    schemaVersion: 1,
    strategyId: BILIBILI_COLLECTION_SERIES_DETAIL_STRATEGY_ID,
    stableAccountId: stored.binding.target.stableAccountId,
    stableSeriesId: stored.binding.target.stableSeriesId,
    listType: stored.binding.target.listType,
    documentId: arm.documentId,
    dom,
    responses
  } as unknown as BridgeJsonValue;
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  if (payloadBytes > stored.binding.maximumPayloadBytes) {
    throw new Error('collection_series_detail_strategy_observation_payload_too_large');
  }
  // The response is consumed by this bounded observation.  Clear it before
  // returning so the next trusted paginator action can produce a fresh page
  // response; DOM cardinality is only cross-check evidence and must not keep
  // the previous page armed.
  if (captured) await clearNetworkCaptureObservations(command.tabId);
  return {
    schemaVersion: STRATEGY_OBSERVATION_SCHEMA_VERSION,
    type: 'collector_strategy_observation',
    strategyId: BILIBILI_COLLECTION_SERIES_DETAIL_STRATEGY_ID,
    observerBindingId: stored.binding.observerBindingId,
    pageAlias: stored.binding.pageAlias,
    documentGeneration: command.documentGeneration,
    routeGeneration: command.routeGeneration,
    capturedAt: new Date().toISOString(),
    payloadBytes,
    payload
  };
}

export async function cleanupExpiredBilibiliCollectionSeriesDetailObserverBindings(): Promise<void> {
  const values = await chrome.storage.session.get(null);
  const expiredKeys: string[] = [];
  const expiredScriptIds: string[] = [];
  for (const [storageKey, value] of Object.entries(values)) {
    if (!storageKey.startsWith(COLLECTION_SERIES_DETAIL_OBSERVER_BINDING_STORAGE_PREFIX)) continue;
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
