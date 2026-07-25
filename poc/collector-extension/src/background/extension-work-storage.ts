import {
  isExtensionWorkItem,
  isExtensionWorkResult,
  type ExtensionWorkItem,
  type ExtensionWorkResult
} from '@intelligence/collector-contracts';
import type { WorkTabAcquisition } from './extension-work-tabs';

const ACTIVE_WORK_KEY = 'collector.extension-work.active.v1';
const PENDING_RESULT_KEY = 'collector.extension-work.pending-result.v1';

export interface ActiveExtensionWork {
  schemaVersion: 1;
  item: ExtensionWorkItem;
  phase: 'claimed' | 'work_tab_acquired' | 'navigation_intent_recorded';
  workTabAcquisition: WorkTabAcquisition | 'not_acquired';
}

export interface PendingExtensionWorkResult {
  schemaVersion: 1;
  result: ExtensionWorkResult;
  deliveryAttempts: 0 | 1 | 2 | 3;
  lastErrorCode: string | null;
}

/**
 * `storage.session` survives MV3 worker suspension but is intentionally not a
 * durable task queue.  On a browser restart an active item is reported as an
 * unknown/stopped outcome, never resumed with another platform navigation.
 */
export async function loadActiveExtensionWork(): Promise<ActiveExtensionWork | null> {
  const stored = await chrome.storage.session.get(ACTIVE_WORK_KEY);
  return activeWork(stored[ACTIVE_WORK_KEY]);
}

export async function saveActiveExtensionWork(value: ActiveExtensionWork): Promise<void> {
  if (!activeWork(value)) throw new Error('extension_work_active_state_invalid');
  await chrome.storage.session.set({ [ACTIVE_WORK_KEY]: structuredClone(value) });
}

export async function clearActiveExtensionWork(): Promise<void> {
  await chrome.storage.session.remove(ACTIVE_WORK_KEY);
}

export async function loadPendingExtensionWorkResult(): Promise<PendingExtensionWorkResult | null> {
  const stored = await chrome.storage.session.get(PENDING_RESULT_KEY);
  return pendingResult(stored[PENDING_RESULT_KEY]);
}

export async function savePendingExtensionWorkResult(value: PendingExtensionWorkResult): Promise<void> {
  if (!pendingResult(value)) throw new Error('extension_work_pending_state_invalid');
  await chrome.storage.session.set({ [PENDING_RESULT_KEY]: structuredClone(value) });
}

export async function clearPendingExtensionWorkResult(): Promise<void> {
  await chrome.storage.session.remove(PENDING_RESULT_KEY);
}

function activeWork(value: unknown): ActiveExtensionWork | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<ActiveExtensionWork>;
  if (
    candidate.schemaVersion !== 1 || !isExtensionWorkItem(candidate.item) ||
    (candidate.phase !== 'claimed' && candidate.phase !== 'work_tab_acquired' &&
      candidate.phase !== 'navigation_intent_recorded') ||
    (candidate.workTabAcquisition !== 'created' && candidate.workTabAcquisition !== 'reused' &&
      candidate.workTabAcquisition !== 'not_acquired')
  ) return null;
  return structuredClone(candidate as ActiveExtensionWork);
}

function pendingResult(value: unknown): PendingExtensionWorkResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<PendingExtensionWorkResult>;
  if (
    candidate.schemaVersion !== 1 || !isExtensionWorkResult(candidate.result) ||
    !(candidate.deliveryAttempts === 0 || candidate.deliveryAttempts === 1 ||
      candidate.deliveryAttempts === 2 || candidate.deliveryAttempts === 3) ||
    !(candidate.lastErrorCode === null || (typeof candidate.lastErrorCode === 'string' &&
      /^[a-z0-9_]{1,100}$/.test(candidate.lastErrorCode)))
  ) return null;
  return structuredClone(candidate as PendingExtensionWorkResult);
}
