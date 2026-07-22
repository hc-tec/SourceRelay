import {
  BILIBILI_TRANSCRIPT_STRATEGY_ID,
  STRATEGY_OBSERVATION_SCHEMA_VERSION,
  type BridgeJsonValue,
  type CollectorBindStrategyObserverCommand,
  type CollectorReadStrategyObservationCommand,
  type StrategyObservationResult,
  type StrategyObserverBindingRequest,
  type StrategyObserverBindingResult
} from '@intelligence/collector-contracts';
import { canonicalBilibiliVideoUrl } from '../../shared/bilibili-video-url';
import {
  bilibiliTranscriptResearchRouteIds,
  type NetworkCaptureObservation
} from '../../shared/network-capture';
import {
  armNetworkCapture,
  getActiveNetworkCaptureArm,
  readNetworkCaptures
} from '../network-capture-runtime';
import {
  clearStrategyBindingsForTab,
  TRANSCRIPT_OBSERVER_BINDING_STORAGE_PREFIX
} from '../strategy-binding-state';

type TranscriptBinding = Extract<StrategyObserverBindingRequest, {
  strategyId: typeof BILIBILI_TRANSCRIPT_STRATEGY_ID;
}>;

interface StoredTranscriptBinding {
  schemaVersion: 1;
  tabId: number;
  nextDocumentGeneration: number;
  contentScriptId: string;
  binding: TranscriptBinding;
}

const RESPONSE_WAIT_INTERVAL_MS = 250;

/**
 * Owns the exact MV3 document binding and the two fixed transcript response
 * routes. Trusted player input remains in Browser Host; this observer never
 * clicks, hovers, navigates, reads credentials, or accepts caller-supplied
 * routes and selectors.
 */
export async function bindBilibiliTranscriptObserver(
  command: CollectorBindStrategyObserverCommand
): Promise<StrategyObserverBindingResult> {
  await cleanupExpiredBilibiliTranscriptObserverBindings();
  const { binding, tabId } = command;
  if (binding.strategyId !== BILIBILI_TRANSCRIPT_STRATEGY_ID) {
    throw new Error('transcript_strategy_id_rejected');
  }
  if (binding.maximumResponseObservations !== 2) {
    throw new Error('transcript_strategy_response_budget_rejected');
  }
  if (binding.documentBindingMode !== 'next_navigation_only') {
    throw new Error('transcript_strategy_document_binding_mode_rejected');
  }
  if (!await chrome.permissions.contains({ origins: ['https://www.bilibili.com/*', 'https://api.bilibili.com/*'] })) {
    throw new Error('transcript_strategy_permission_missing');
  }
  const tab = await chrome.tabs.get(tabId);
  if (tab.url && tab.url !== 'about:blank' &&
    canonicalBilibiliVideoUrl(tab.url, 'observed_document') !== binding.target.canonicalUrl) {
    throw new Error('transcript_strategy_tab_context_rejected');
  }

  await clearStrategyBindingsForTab(tabId);
  const contentScriptId = `collector-transcript-${binding.observerBindingId.replace(/-/g, '')}`;
  await chrome.scripting.unregisterContentScripts({ ids: [contentScriptId] }).catch(() => undefined);
  await chrome.scripting.registerContentScripts([{
    id: contentScriptId,
    matches: ['https://www.bilibili.com/video/*'],
    js: ['network-capture-bridge.js'],
    runAt: 'document_start',
    allFrames: false,
    persistAcrossSessions: false,
    world: 'ISOLATED'
  }]);
  await armNetworkCapture({
    tabId,
    platform: 'bilibili',
    purpose: 'bilibili_transcript_strategy',
    runId: binding.runId,
    navigationUrl: binding.target.canonicalUrl,
    routeIds: bilibiliTranscriptResearchRouteIds(),
    maximumObservations: binding.maximumResponseObservations,
    expiresAt: Date.parse(binding.expiresAt),
    observerBindingId: binding.observerBindingId,
    contentScriptId
  });
  const stored: StoredTranscriptBinding = {
    schemaVersion: 1,
    tabId,
    nextDocumentGeneration: command.nextDocumentGeneration,
    contentScriptId,
    binding: structuredClone(binding)
  };
  await chrome.storage.session.set({ [bindingStorageKey(binding.observerBindingId)]: stored });
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

export async function readBilibiliTranscriptObservation(
  command: CollectorReadStrategyObservationCommand
): Promise<StrategyObservationResult> {
  if (command.request.strategyId !== BILIBILI_TRANSCRIPT_STRATEGY_ID) {
    throw new Error('transcript_strategy_id_rejected');
  }
  const stored = await storedBinding(command.request.observerBindingId);
  if (!matchesReadContext(stored, command)) {
    throw new Error('transcript_strategy_binding_context_rejected');
  }
  const arm = await getActiveNetworkCaptureArm(command.tabId);
  if (
    !arm ||
    arm.purpose !== 'bilibili_transcript_strategy' ||
    arm.observerBindingId !== command.request.observerBindingId ||
    !arm.documentId
  ) throw new Error('transcript_strategy_observer_not_bound');

  const deadline = Date.now() + command.request.deadlineMs;
  let responses: NetworkCaptureObservation[] = [];
  do {
    await assertCurrentDocument(command.tabId, arm.documentId, stored.binding.target.canonicalUrl);
    responses = await readNetworkCaptures(command.tabId, arm);
    if (hasRequiredTranscriptResponses(responses)) break;
    await delay(Math.min(RESPONSE_WAIT_INTERVAL_MS, Math.max(1, deadline - Date.now())));
  } while (Date.now() < deadline);

  const payload = {
    schemaVersion: 1,
    strategyId: BILIBILI_TRANSCRIPT_STRATEGY_ID,
    bvid: stored.binding.target.bvid,
    responses
  } as unknown as BridgeJsonValue;
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  if (payloadBytes > stored.binding.maximumPayloadBytes) {
    throw new Error('transcript_strategy_observation_payload_too_large');
  }
  return {
    schemaVersion: STRATEGY_OBSERVATION_SCHEMA_VERSION,
    type: 'collector_strategy_observation',
    strategyId: BILIBILI_TRANSCRIPT_STRATEGY_ID,
    observerBindingId: stored.binding.observerBindingId,
    pageAlias: stored.binding.pageAlias,
    documentGeneration: command.documentGeneration,
    routeGeneration: command.routeGeneration,
    capturedAt: new Date().toISOString(),
    payloadBytes,
    payload
  };
}

export async function cleanupExpiredBilibiliTranscriptObserverBindings(): Promise<void> {
  const values = await chrome.storage.session.get(null);
  const expiredKeys: string[] = [];
  const expiredScriptIds: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith(TRANSCRIPT_OBSERVER_BINDING_STORAGE_PREFIX)) continue;
    const candidate = value as Partial<StoredTranscriptBinding>;
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

function bindingStorageKey(observerBindingId: string): string {
  return `${TRANSCRIPT_OBSERVER_BINDING_STORAGE_PREFIX}${observerBindingId}`;
}

async function storedBinding(observerBindingId: string): Promise<StoredTranscriptBinding | null> {
  const key = bindingStorageKey(observerBindingId);
  const value = (await chrome.storage.session.get(key))[key] as Partial<StoredTranscriptBinding> | undefined;
  return value?.schemaVersion === 1 && value.binding?.strategyId === BILIBILI_TRANSCRIPT_STRATEGY_ID &&
    value.binding.observerBindingId === observerBindingId &&
    typeof value.tabId === 'number' && Number.isSafeInteger(value.tabId) && value.tabId >= 0 &&
    typeof value.nextDocumentGeneration === 'number' && Number.isSafeInteger(value.nextDocumentGeneration) &&
    value.nextDocumentGeneration >= 1 &&
    typeof value.contentScriptId === 'string' && /^collector-transcript-[a-z0-9-]{1,80}$/.test(value.contentScriptId) &&
    Date.parse(value.binding.expiresAt) > Date.now()
    ? value as StoredTranscriptBinding
    : null;
}

function matchesReadContext(
  stored: StoredTranscriptBinding | null,
  command: CollectorReadStrategyObservationCommand
): stored is StoredTranscriptBinding {
  return Boolean(
    stored &&
    stored.tabId === command.tabId &&
    stored.binding.pageLeaseId === command.request.pageLeaseId &&
    stored.binding.runId === command.request.runId &&
    stored.binding.pageAlias === command.request.pageAlias &&
    command.documentGeneration >= stored.nextDocumentGeneration
  );
}

async function assertCurrentDocument(tabId: number, documentId: string, canonicalUrl: string): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (canonicalBilibiliVideoUrl(tab.url ?? '', 'observed_document') !== canonicalUrl) {
    throw new Error('transcript_strategy_document_context_changed');
  }
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 }).catch(() => null);
  if (!frame?.documentId || frame.documentId !== documentId ||
    canonicalBilibiliVideoUrl(frame.url, 'observed_document') !== canonicalUrl) {
    throw new Error('transcript_strategy_document_context_changed');
  }
}

function hasRequiredTranscriptResponses(responses: readonly NetworkCaptureObservation[]): boolean {
  const captured = new Set(responses.filter((response) => response.status === 'captured').map((response) => response.routeId));
  return bilibiliTranscriptResearchRouteIds().every((routeId) => captured.has(routeId));
}

async function delay(timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
}
