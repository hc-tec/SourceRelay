import type { ExtensionWorkItem, ExtensionWorkResult } from '@intelligence/collector-contracts';
import { executeBilibiliAccountInventoryExtensionWork } from './extension-work-bilibili-account-inventory';
import { executeBilibiliAccountInventoryUserSelectedTabExtensionWork } from './extension-work-bilibili-account-inventory-user-selected-tab';
import { executeBilibiliAccountProfileExtensionWork } from './extension-work-bilibili-account-profile';
import { executeBilibiliDiscussionUserSelectedTabExtensionWork } from './extension-work-bilibili-discussion-user-selected-tab';
import { executeBilibiliNativeSearchBatchExtensionWork } from './extension-work-bilibili-native-search-batch';
import { executeBilibiliNativeSearchExtensionWork } from './extension-work-bilibili-native-search';
import { executeBilibiliPassiveExtensionWork } from './extension-work-bilibili-passive';
import { executeBilibiliVideoDetailExtensionWork } from './extension-work-bilibili-video-detail';
import { executeXiaohongshuPublicNotesSearchExtensionWork } from './extension-work-xiaohongshu-public-notes';
import { executeXiaohongshuAccountPublicNotesExtensionWork } from './extension-work-xiaohongshu-account-public-notes';
import { executeXiaohongshuNotePublicDetailExtensionWork } from './extension-work-xiaohongshu-note-public-detail';
import { wasXiaohongshuTrustedInputAttempted } from './xiaohongshu-trusted-input';
import { xiaohongshuProfileScrollAttemptCount } from './xiaohongshu-profile-scroll-ledger';
import { xiaohongshuNoteDetailClickAttempted } from './xiaohongshu-note-detail-click-ledger';
import { claimNextExtensionWork, submitExtensionWorkResult } from './extension-work-client';
import {
  clearActiveExtensionWork,
  clearPendingExtensionWorkResult,
  loadActiveExtensionWork,
  loadPendingExtensionWorkResult,
  saveActiveExtensionWork,
  savePendingExtensionWorkResult,
  type ActiveExtensionWork,
  type PendingExtensionWorkResult
} from './extension-work-storage';
import { initialiseExtensionWorkTabs, type WorkTabAcquisition } from './extension-work-tabs';
import { loadGatewayPairingRecord } from './user-browser-gateway-storage';

const WORK_POLL_ALARM = 'collector.user-browser-work-poll.v1';
const MAX_RESULT_DELIVERY_ATTEMPTS = 3 as const;
let pollInFlight = false;
let runnerInitialised = false;

/**
 * A low-frequency loopback heartbeat lets an already-paired daily browser
 * receive an explicitly queued local task.  It never retries a platform
 * navigation: an item is claimed once, executed once, then only its local
 * result delivery can receive up to three idempotent attempts.
 */
export function initialiseExtensionWorkRunner(): void {
  if (runnerInitialised) return;
  runnerInitialised = true;
  initialiseExtensionWorkTabs();
  chrome.alarms.create(WORK_POLL_ALARM, { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === WORK_POLL_ALARM) void pollForExtensionWork();
  });
  void pollForExtensionWork();
}

export async function pollForExtensionWork(): Promise<void> {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    const pending = await loadPendingExtensionWorkResult();
    if (pending) {
      await deliverPendingResult(pending);
      return;
    }

    const interrupted = await loadActiveExtensionWork();
    if (interrupted) {
      await savePendingExtensionWorkResult({
        schemaVersion: 1,
        result: await interruptedResult(interrupted),
        deliveryAttempts: 0,
        lastErrorCode: null
      });
      await clearActiveExtensionWork();
      const recovered = await loadPendingExtensionWorkResult();
      if (recovered) await deliverPendingResult(recovered);
      return;
    }

    const pairing = await loadGatewayPairingRecord();
    if (!pairing) return;
    const item = await claimNextExtensionWork(pairing);
    if (!item) return;

    await saveActiveExtensionWork({
      schemaVersion: 1,
      item,
      phase: 'claimed',
      navigationIntentCount: 0,
      workTabAcquisition: 'not_acquired'
    });
    const result = await execute(item);
    await savePendingExtensionWorkResult({
      schemaVersion: 1,
      result,
      deliveryAttempts: 0,
      lastErrorCode: null
    });
    await clearActiveExtensionWork();
    const completed = await loadPendingExtensionWorkResult();
    if (completed) await deliverPendingResult(completed);
  } catch {
    // The next bounded local heartbeat can only retry an idempotent result
    // delivery.  It never reclaims or repeats a platform navigation here.
  } finally {
    pollInFlight = false;
  }
}

async function execute(item: ExtensionWorkItem): Promise<ExtensionWorkResult> {
  const lifecycle = {
    onWorkTabAcquired: async (acquisition: WorkTabAcquisition) => {
      await updateActivePhase(item, 'work_tab_acquired', acquisition);
    },
    onNavigationIntent: async () => {
      const active = await loadActiveExtensionWork();
      const acquisition = active?.item.workId === item.workId
        ? active.workTabAcquisition
        : 'not_acquired';
      await updateActivePhase(item, 'navigation_intent_recorded', acquisition);
    }
  };
  if (item.capability === 'xiaohongshu.search.public_notes.v1') {
    return await executeXiaohongshuPublicNotesSearchExtensionWork(item);
  }
  if (item.capability === 'xiaohongshu.account.public_notes.v1') {
    return await executeXiaohongshuAccountPublicNotesExtensionWork(item);
  }
  if (item.capability === 'xiaohongshu.note.public_detail.v1') {
    return await executeXiaohongshuNotePublicDetailExtensionWork(item);
  }
  if (item.capability === 'bilibili.video_detail') {
    return await executeBilibiliVideoDetailExtensionWork(item, lifecycle);
  }
  if (item.capability === 'bilibili.native_search') {
    return await executeBilibiliNativeSearchExtensionWork(item, lifecycle);
  }
  if (item.capability === 'bilibili.native_search_batch') {
    return await executeBilibiliNativeSearchBatchExtensionWork(item, lifecycle);
  }
  if (item.capability === 'bilibili.account_profile') {
    return await executeBilibiliAccountProfileExtensionWork(item, lifecycle);
  }
  if (item.capability === 'bilibili.account_inventory') {
    if (item.executionTarget === 'user_selected_tab') {
      return await executeBilibiliAccountInventoryUserSelectedTabExtensionWork(item);
    }
    return await executeBilibiliAccountInventoryExtensionWork(item, lifecycle);
  }
  if (item.capability === 'bilibili.discussion') {
    return await executeBilibiliDiscussionUserSelectedTabExtensionWork(item);
  }
  if (item.capability === 'bilibili.dynamic' || item.capability === 'bilibili.collection_series.overview' ||
    item.capability === 'bilibili.collection_series.detail' || item.capability === 'bilibili.danmaku') {
    return await executeBilibiliPassiveExtensionWork(item, lifecycle);
  }
  throw new Error('extension_work_capability_rejected');
}

async function updateActivePhase(
  item: ExtensionWorkItem,
  phase: ActiveExtensionWork['phase'],
  workTabAcquisition: WorkTabAcquisition | 'not_acquired'
): Promise<void> {
  const active = await loadActiveExtensionWork();
  if (!active || active.item.workId !== item.workId) throw new Error('extension_work_active_state_missing');
  const navigationIntentCount = phase === 'navigation_intent_recorded'
    ? nextNavigationIntentCount(item, active.navigationIntentCount)
    : active.navigationIntentCount;
  await saveActiveExtensionWork({
    schemaVersion: 1,
    item,
    phase,
    navigationIntentCount,
    workTabAcquisition
  });
}

async function deliverPendingResult(pending: PendingExtensionWorkResult): Promise<void> {
  if (pending.deliveryAttempts >= MAX_RESULT_DELIVERY_ATTEMPTS) return;
  const pairing = await loadGatewayPairingRecord();
  if (!pairing) return;
  try {
    await submitExtensionWorkResult(pairing, pending.result);
    await clearPendingExtensionWorkResult();
  } catch (error) {
    const errorCode = safeErrorCode(error);
    const deliveryAttempts = terminalDeliveryError(errorCode)
      ? MAX_RESULT_DELIVERY_ATTEMPTS
      : Math.min(MAX_RESULT_DELIVERY_ATTEMPTS, pending.deliveryAttempts + 1) as PendingExtensionWorkResult['deliveryAttempts'];
    await savePendingExtensionWorkResult({
      ...pending,
      deliveryAttempts,
      lastErrorCode: errorCode
    });
  }
}

async function interruptedResult(active: ActiveExtensionWork): Promise<ExtensionWorkResult> {
  if (active.item.capability === 'xiaohongshu.note.public_detail.v1') {
    const attempted = await xiaohongshuNoteDetailClickAttempted(active.item.workId);
    return {
      schemaVersion: 1,
      protocolVersion: 1,
      workId: active.item.workId,
      operationId: active.item.operationId,
      browserBindingId: active.item.browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.note.public_detail.v1',
      executionTarget: 'existing_public_search_tab',
      state: 'stopped',
      errorCode: 'xiaohongshu_extension_worker_interrupted',
      terminalReason: 'extension_worker_interrupted',
      completedAt: new Date().toISOString(),
      navigation: { attempted: false, attemptCount: 0 },
      semanticAction: { attempted, attemptCount: attempted ? 1 : 0 },
      page: null,
      projection: null,
      rawPayloadStored: false,
      responseUrlsStored: false,
      debuggerDetached: false
    };
  }
  if (active.item.capability === 'xiaohongshu.account.public_notes.v1') {
    const attemptedCount = await xiaohongshuProfileScrollAttemptCount(active.item.workId);
    return {
      schemaVersion: 1,
      protocolVersion: 1,
      workId: active.item.workId,
      operationId: active.item.operationId,
      browserBindingId: active.item.browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.account.public_notes.v1',
      executionTarget: 'existing_public_profile_tab',
      state: 'stopped',
      errorCode: 'xiaohongshu_extension_worker_interrupted',
      terminalReason: 'extension_worker_interrupted',
      completedAt: new Date().toISOString(),
      navigation: { attempted: false, attemptCount: 0 },
      semanticAction: { attempted: attemptedCount > 0, attemptCount: attemptedCount },
      scroll: { requestedCount: active.item.input.maximumScrolls, completedCount: 0 },
      page: null,
      projection: null,
      rawPayloadStored: false,
      responseUrlsStored: false,
      debuggerDetached: false
    };
  }
  if (active.item.capability === 'xiaohongshu.search.public_notes.v1') {
    const attempted = await wasXiaohongshuTrustedInputAttempted(active.item.workId);
    return {
      schemaVersion: 1,
      protocolVersion: 1,
      workId: active.item.workId,
      operationId: active.item.operationId,
      browserBindingId: active.item.browserBindingId,
      platform: 'xiaohongshu',
      capability: 'xiaohongshu.search.public_notes.v1',
      executionTarget: 'existing_public_explore_tab',
      state: 'stopped',
      errorCode: 'xiaohongshu_extension_worker_interrupted',
      terminalReason: 'extension_worker_interrupted',
      completedAt: new Date().toISOString(),
      navigation: { attempted: false, attemptCount: 0 },
      semanticAction: { attempted, attemptCount: attempted ? 1 : 0 },
      input: { queryEchoed: false, enterAttempted: false },
      page: null,
      projection: null,
      rawPayloadStored: false,
      responseUrlsStored: false,
      debuggerDetached: false
    };
  }
  if (active.item.capability === 'bilibili.account_inventory' && active.item.executionTarget === 'user_selected_tab') {
    return {
      schemaVersion: 1,
      protocolVersion: 1,
      workId: active.item.workId,
      operationId: active.item.operationId,
      browserBindingId: active.item.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.account_inventory',
      executionTarget: 'user_selected_tab',
      state: 'stopped',
      errorCode: 'user_selected_tab_worker_interrupted',
      terminalReason: 'user_selected_tab_worker_interrupted',
      completedAt: new Date().toISOString(),
      navigation: { attempted: false, attemptCount: 0 },
      userSelectedTabDisposition: 'selection_unavailable',
      observation: null
    };
  }
  if (active.item.capability === 'bilibili.discussion') {
    return {
      schemaVersion: 1,
      protocolVersion: 1,
      workId: active.item.workId,
      operationId: active.item.operationId,
      browserBindingId: active.item.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.discussion',
      executionTarget: 'user_selected_tab',
      state: 'stopped',
      errorCode: 'user_selected_tab_worker_interrupted',
      terminalReason: 'user_selected_tab_worker_interrupted',
      completedAt: new Date().toISOString(),
      navigation: { attempted: false, attemptCount: 0 },
      userSelectedTabDisposition: 'selection_unavailable',
      observation: null
    };
  }
  const navigationAttempted = active.navigationIntentCount > 0;
  if (active.item.capability === 'bilibili.native_search_batch') {
    return {
      schemaVersion: 1,
      protocolVersion: 1,
      workId: active.item.workId,
      operationId: active.item.operationId,
      browserBindingId: active.item.browserBindingId,
      platform: 'bilibili',
      capability: 'bilibili.native_search_batch',
      executionTarget: 'collector_work_tab',
      state: 'stopped',
      errorCode: navigationAttempted
        ? 'extension_worker_interrupted_after_navigation_intent'
        : 'extension_worker_interrupted_before_navigation',
      terminalReason: navigationAttempted ? 'navigation_outcome_unknown' : 'work_tab_closed',
      completedAt: new Date().toISOString(),
      navigation: {
        attempted: navigationAttempted,
        attemptCount: active.navigationIntentCount
      },
      workTabAcquisition: active.workTabAcquisition,
      workTabDisposition: active.workTabAcquisition === 'not_acquired'
        ? 'closed_or_missing'
        : 'retained_not_reusable',
      observation: null
    };
  }
  const base = {
    schemaVersion: 1 as const,
    protocolVersion: 1 as const,
    workId: active.item.workId,
    operationId: active.item.operationId,
    browserBindingId: active.item.browserBindingId,
    platform: 'bilibili' as const,
    executionTarget: 'collector_work_tab' as const,
    state: 'stopped' as const,
    errorCode: navigationAttempted
      ? 'extension_worker_interrupted_after_navigation_intent'
      : 'extension_worker_interrupted_before_navigation',
    terminalReason: navigationAttempted
      ? 'navigation_outcome_unknown' as const
      : 'work_tab_closed' as const,
    completedAt: new Date().toISOString(),
    navigation: {
      attempted: navigationAttempted,
      attemptCount: (navigationAttempted ? 1 : 0) as 0 | 1
    },
    workTabAcquisition: active.workTabAcquisition,
    workTabDisposition: active.workTabAcquisition === 'not_acquired'
      ? 'closed_or_missing' as const
      : 'retained_not_reusable' as const
  };
  if (active.item.capability === 'bilibili.video_detail') {
    return { ...base, capability: 'bilibili.video_detail', observation: null };
  }
  if (active.item.capability === 'bilibili.native_search') {
    return { ...base, capability: 'bilibili.native_search', observation: null };
  }
  if (active.item.capability === 'bilibili.account_profile') {
    return { ...base, capability: 'bilibili.account_profile', observation: null };
  }
  if (active.item.capability === 'bilibili.account_inventory') {
    return { ...base, capability: 'bilibili.account_inventory', observation: null };
  }
  if (active.item.capability === 'bilibili.dynamic') {
    return { ...base, capability: 'bilibili.dynamic', observation: null };
  }
  if (active.item.capability === 'bilibili.collection_series.overview') {
    return { ...base, capability: 'bilibili.collection_series.overview', observation: null };
  }
  if (active.item.capability === 'bilibili.collection_series.detail') {
    return { ...base, capability: 'bilibili.collection_series.detail', observation: null };
  }
  return { ...base, capability: 'bilibili.danmaku', observation: null };
}

function nextNavigationIntentCount(
  item: ExtensionWorkItem,
  current: ActiveExtensionWork['navigationIntentCount']
): ActiveExtensionWork['navigationIntentCount'] {
  const maximum = item.capability === 'bilibili.native_search_batch' ? 2 : 1;
  if (current >= maximum) throw new Error('extension_work_navigation_budget_exceeded');
  return (current + 1) as ActiveExtensionWork['navigationIntentCount'];
}

function terminalDeliveryError(errorCode: string): boolean {
  return errorCode === 'extension_work_not_claimed' || errorCode === 'extension_work_result_invalid' ||
    errorCode === 'pairing_authorization_rejected' || errorCode === 'pairing_origin_rejected';
}

function safeErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'extension_work_result_delivery_failed';
}
