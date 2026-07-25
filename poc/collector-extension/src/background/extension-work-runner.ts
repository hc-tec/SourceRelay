import type { ExtensionWorkItem, ExtensionWorkResult } from '@intelligence/collector-contracts';
import { executeBilibiliVideoDetailExtensionWork } from './extension-work-bilibili-video-detail';
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
        result: interruptedResult(interrupted),
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
  if (item.capability !== 'bilibili.video_detail') {
    throw new Error('extension_work_capability_rejected');
  }
  return await executeBilibiliVideoDetailExtensionWork(item, {
    onWorkTabAcquired: async (acquisition) => {
      await updateActivePhase(item, 'work_tab_acquired', acquisition);
    },
    onNavigationIntent: async () => {
      const active = await loadActiveExtensionWork();
      const acquisition = active?.item.workId === item.workId
        ? active.workTabAcquisition
        : 'not_acquired';
      await updateActivePhase(item, 'navigation_intent_recorded', acquisition);
    }
  });
}

async function updateActivePhase(
  item: ExtensionWorkItem,
  phase: ActiveExtensionWork['phase'],
  workTabAcquisition: WorkTabAcquisition | 'not_acquired'
): Promise<void> {
  const active = await loadActiveExtensionWork();
  if (!active || active.item.workId !== item.workId) throw new Error('extension_work_active_state_missing');
  await saveActiveExtensionWork({
    schemaVersion: 1,
    item,
    phase,
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

function interruptedResult(active: ActiveExtensionWork): ExtensionWorkResult {
  const navigationAttempted = active.phase === 'navigation_intent_recorded';
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    workId: active.item.workId,
    operationId: active.item.operationId,
    browserBindingId: active.item.browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.video_detail',
    executionTarget: 'collector_work_tab',
    state: 'stopped',
    errorCode: navigationAttempted
      ? 'extension_worker_interrupted_after_navigation_intent'
      : 'extension_worker_interrupted_before_navigation',
    terminalReason: navigationAttempted ? 'navigation_outcome_unknown' : 'work_tab_closed',
    completedAt: new Date().toISOString(),
    navigation: { attempted: navigationAttempted, attemptCount: navigationAttempted ? 1 : 0 },
    workTabAcquisition: active.workTabAcquisition,
    workTabDisposition: active.workTabAcquisition === 'not_acquired'
      ? 'closed_or_missing'
      : 'retained_not_reusable',
    observation: null
  };
}

function terminalDeliveryError(errorCode: string): boolean {
  return errorCode === 'extension_work_not_claimed' || errorCode === 'extension_work_result_invalid' ||
    errorCode === 'pairing_authorization_rejected' || errorCode === 'pairing_origin_rejected';
}

function safeErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'extension_work_result_delivery_failed';
}
