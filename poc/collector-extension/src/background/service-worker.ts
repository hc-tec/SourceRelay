import {
  COLLECT_VISIBLE_RESULTS,
  COLLECTOR_CORE_VERSION,
  CONTENT_READY,
  GET_CAPABILITY_VALIDATION,
  GET_CONTROL_SNAPSHOT,
  NETWORK_CAPTURE_BRIDGE_READY_MESSAGE,
  NETWORK_CAPTURE_OBSERVED,
  PAIR_GATEWAY,
  POLL_GATEWAY_TASKS,
  REVOKE_GATEWAY_PAIRING,
  START_CAPABILITY_VALIDATION,
  isGetCapabilityValidationMessage,
  isStartCapabilityValidationMessage,
  isPairGatewayMessage,
  isRevokeGatewayPairingMessage,
  isCollectionResultMessage,
  isGetControlSnapshotMessage,
  isNetworkCaptureBridgeReadyMessage,
  isNetworkCaptureObservedMessage,
  isPollGatewayTasksMessage,
  isSyncStrategyPermissionsMessage,
  type VisibleCollectionResult
} from '../shared/protocol';
import { nativeSearchPlatform } from '../shared/native-search';
import {
  NETWORK_CAPTURE_MAX_PER_PAGE,
  hasApprovedNetworkCaptureRoute,
  sanitiseNetworkCaptureObservation,
  type NetworkCaptureObservation
} from '../shared/network-capture';
import { isSupportedPlatform, type SupportedPlatform } from '../shared/collection-contracts';
import type { CollectorControlSnapshot } from '../shared/control-plane';
import { flushPendingEvidenceSubmissions, submitStageEvidence } from './evidence-submission';
import { pairGateway } from './gateway-pairing';
import {
  GATEWAY_POLL_ALARM,
  gatewayRuntimeStatus,
  pollGatewayTasks,
  synchroniseGatewayPolling
} from './gateway-task-controller';
import { gatewayPairingSummary, revokeGatewayPairing } from './pairing-store';
import {
  activeStageLeaseForSender,
  invalidateLeasesWithoutPermissions,
  listStageLeases,
  markTaskContextChanged,
  markWindowClosed,
  stageLeaseForTab,
  updateStageLeaseStatus
} from './stage-leases';
import {
  strategyPermissionSnapshots,
  synchroniseStrategyContentScripts
} from './strategy-permissions';
import {
  activeCapabilityValidationRunForSender,
  capabilityValidationRunForTab,
  completeCapabilityValidationRun,
  createCapabilityValidationRun,
  getCapabilityValidationRun,
  invalidateCapabilityValidationsWithoutPermissions,
  markCapabilityValidationTabChanged,
  markCapabilityValidationTabClosed,
  markCapabilityValidationWindowClosed
} from './validation-runs';

function networkCaptureStorageKey(tabId: number): string {
  return `collector.network-captures.${tabId}`;
}

function networkCaptureArmStorageKey(tabId: number): string {
  return `collector.network-capture-arm.${tabId}`;
}

interface NetworkCaptureArm {
  platform: SupportedPlatform;
  navigationUrlDigest: string;
  documentId?: string;
  expiresAt: number;
}

interface BoundNetworkCaptureArm extends NetworkCaptureArm {
  documentId: string;
}

async function navigationUrlDigest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function getActiveNetworkCaptureArm(tabId: number): Promise<NetworkCaptureArm | null> {
  const key = networkCaptureArmStorageKey(tabId);
  const candidate = (await chrome.storage.session.get(key))[key] as Partial<NetworkCaptureArm> | undefined;
  const documentId =
    candidate?.documentId === undefined
      ? undefined
      : typeof candidate.documentId === 'string' && candidate.documentId.length > 0
        ? candidate.documentId
        : null;
  if (
    candidate &&
    isSupportedPlatform(candidate.platform) &&
    typeof candidate.navigationUrlDigest === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate.navigationUrlDigest) &&
    typeof candidate.expiresAt === 'number' &&
    Number.isFinite(candidate.expiresAt) &&
    candidate.expiresAt > Date.now() &&
    documentId !== null
  ) {
    return {
      platform: candidate.platform,
      navigationUrlDigest: candidate.navigationUrlDigest,
      expiresAt: candidate.expiresAt,
      ...(documentId === undefined ? {} : { documentId })
    };
  }
  await chrome.storage.session.remove(key);
  return null;
}

function senderUrlMatchesArmPlatform(senderUrl: string, arm: NetworkCaptureArm): boolean {
  try {
    const url = new URL(senderUrl);
    return nativeSearchPlatform(url) === arm.platform;
  } catch {
    return false;
  }
}

async function activeArmForNavigation(tabId: number, senderUrl: string | undefined): Promise<NetworkCaptureArm | null> {
  if (!senderUrl) return null;
  const arm = await getActiveNetworkCaptureArm(tabId);
  if (!arm || !senderUrlMatchesArmPlatform(senderUrl, arm)) return null;
  return (await navigationUrlDigest(senderUrl)) === arm.navigationUrlDigest ? arm : null;
}

async function bindArmToDocument(
  tabId: number,
  senderUrl: string | undefined,
  documentId: string | undefined
): Promise<BoundNetworkCaptureArm | null> {
  if (!documentId) return null;
  const arm = await activeArmForNavigation(tabId, senderUrl);
  if (!arm || (arm.documentId !== undefined && arm.documentId !== documentId)) return null;
  const bound: BoundNetworkCaptureArm = { ...arm, documentId };
  await chrome.storage.session.set({ [networkCaptureArmStorageKey(tabId)]: bound });
  return bound;
}

async function activeBoundArmForSender(
  tabId: number,
  senderUrl: string | undefined,
  documentId: string | undefined
): Promise<BoundNetworkCaptureArm | null> {
  if (!documentId) return null;
  const arm = await activeArmForNavigation(tabId, senderUrl);
  return arm?.documentId === documentId ? { ...arm, documentId } : null;
}

async function storeNetworkCapture(tabId: number, candidate: unknown): Promise<{ stored: boolean }> {
  const observation = sanitiseNetworkCaptureObservation(candidate);
  if (!observation) return { stored: false };

  const key = networkCaptureStorageKey(tabId);
  const current = (await chrome.storage.session.get(key))[key];
  const captures = Array.isArray(current)
    ? current
        .map((value) => sanitiseNetworkCaptureObservation(value))
        .filter((value): value is NetworkCaptureObservation => value !== null)
        .slice(0, NETWORK_CAPTURE_MAX_PER_PAGE)
    : [];
  if (captures.length >= NETWORK_CAPTURE_MAX_PER_PAGE) return { stored: false };

  captures.push(observation);
  await chrome.storage.session.set({ [key]: captures });
  return { stored: true };
}

async function collectTab(tabId: number): Promise<VisibleCollectionResult> {
  const response = await chrome.tabs.sendMessage(tabId, { type: COLLECT_VISIBLE_RESULTS });
  if (!response?.ok || !response.result) {
    throw new Error('The page did not return a visible-result collection payload.');
  }
  return response.result as VisibleCollectionResult;
}

function isExtensionControlSender(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    typeof sender.url === 'string' &&
    sender.url.startsWith(chrome.runtime.getURL(''))
  );
}

async function controlSnapshot(): Promise<CollectorControlSnapshot> {
  const leases = await listStageLeases();
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    collectorVersion: COLLECTOR_CORE_VERSION,
    pairing: await gatewayPairingSummary(),
    gatewayRuntime: await gatewayRuntimeStatus(),
    strategies: await strategyPermissionSnapshots(),
    activeLeases: leases.filter(
      (lease) => lease.status === 'active' || lease.status === 'awaiting_evidence'
    ),
    capturedAt: new Date().toISOString()
  };
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isNetworkCaptureBridgeReadyMessage(message)) {
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number' || sender.frameId !== 0) {
      sendResponse({ ok: true, armed: false });
      return false;
    }
    void bindArmToDocument(tabId, sender.url, sender.documentId).then(
      async (arm) => {
        if (!arm) {
          sendResponse({ ok: true, armed: false });
          return;
        }
        if (!hasApprovedNetworkCaptureRoute(arm.platform)) {
          await chrome.storage.session.remove(networkCaptureArmStorageKey(tabId));
          sendResponse({ ok: true, armed: false });
          return;
        }
        try {
          // The observer is not a static MAIN-world content script. It enters
          // only this already-arm-validated top-level document, so a page
          // cannot activate response reading by forging postMessage events.
          await chrome.scripting.executeScript({
            target: { tabId, documentIds: [arm.documentId] },
            world: 'MAIN',
            func: (expiresAt: number) => {
              Object.defineProperty(window, '__personalIntelligenceNetworkCaptureExpiresAt', {
                value: expiresAt,
                writable: false,
                configurable: true
              });
            },
            args: [arm.expiresAt],
            injectImmediately: true
          });
          await chrome.scripting.executeScript({
            target: { tabId, documentIds: [arm.documentId] },
            world: 'MAIN',
            files: ['main-world-network-observer.js'],
            injectImmediately: true
          });
          sendResponse({ ok: true, armed: true, expiresAt: arm.expiresAt });
        } catch {
          sendResponse({ ok: true, armed: false });
        }
      },
      () => sendResponse({ ok: true, armed: false })
    );
    return true;
  }

  if (isNetworkCaptureObservedMessage(message)) {
    const tabId = sender.tab?.id;
    if (
      typeof tabId !== 'number' ||
      sender.frameId !== 0 ||
      !sender.url
    ) {
      sendResponse({ ok: false, error: 'network_capture_source_rejected' });
      return false;
    }
    void activeBoundArmForSender(tabId, sender.url, sender.documentId).then(
      (arm) => arm?.platform === message.observation.platform ? storeNetworkCapture(tabId, message.observation) : { stored: false },
      () => ({ stored: false })
    ).then(
      (result) => sendResponse({ ok: true, ...result }),
      () => sendResponse({ ok: false, error: 'network_capture_storage_failed' })
    );
    return true;
  }

  if (isCollectionResultMessage(message)) {
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number') {
      sendResponse({ ok: false, error: 'collection_result_source_rejected' });
      return false;
    }
    void activeStageLeaseForSender(tabId, sender.url, sender.documentId).then(
      async (lease) => {
        if (lease) {
          const evidence = await submitStageEvidence(lease, message.result);
          return {
            ok: true,
            taskId: lease.taskId,
            stageId: lease.stageId,
            evidenceBatchId: evidence.batchId
          };
        }
        const validation = await activeCapabilityValidationRunForSender(tabId, sender.url, sender.documentId);
        if (!validation) return { ok: false, error: 'collection_result_without_active_lease' };
        const completed = await completeCapabilityValidationRun(validation.runId, message.result);
        return { ok: true, validationRunId: completed.runId, validationState: completed.state };
      }
    ).then(
      (result) => sendResponse(result),
      () => sendResponse({ ok: false, error: 'collection_result_storage_failed' })
    );
    return true;
  }

  if (isGetControlSnapshotMessage(message)) {
    if (!isExtensionControlSender(sender)) {
      sendResponse({ ok: false, error: 'control_sender_rejected' });
      return false;
    }
    void controlSnapshot().then(
      (snapshot) => sendResponse({ ok: true, snapshot }),
      () => sendResponse({ ok: false, error: 'control_snapshot_failed' })
    );
    return true;
  }

  if (isPollGatewayTasksMessage(message)) {
    if (!isExtensionControlSender(sender)) {
      sendResponse({ ok: false, error: 'control_sender_rejected' });
      return false;
    }
    void pollGatewayTasks().then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false, error: 'gateway_poll_failed' })
    );
    return true;
  }

  if (isStartCapabilityValidationMessage(message)) {
    if (!isExtensionControlSender(sender)) {
      sendResponse({ ok: false, error: 'control_sender_rejected' });
      return false;
    }
    if (message.platform !== 'bilibili' || message.accountCategory !== 'anonymous') {
      sendResponse({ ok: false, error: 'validation_scope_not_admitted' });
      return false;
    }
    void createCapabilityValidationRun({
      runId: message.runId,
      profileId: message.profileId,
      platform: message.platform,
      accountCategory: message.accountCategory,
      query: message.query
    }).then(
      (validation) => sendResponse({ ok: true, validation }),
      (error: unknown) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'validation_start_failed'
      })
    );
    return true;
  }

  if (isGetCapabilityValidationMessage(message)) {
    if (!isExtensionControlSender(sender)) {
      sendResponse({ ok: false, error: 'control_sender_rejected' });
      return false;
    }
    void getCapabilityValidationRun(message.runId).then(
      (validation) => sendResponse(validation
        ? { ok: true, validation }
        : { ok: false, error: 'validation_run_not_found' }),
      () => sendResponse({ ok: false, error: 'validation_state_unavailable' })
    );
    return true;
  }

  if (isSyncStrategyPermissionsMessage(message)) {
    if (!isExtensionControlSender(sender)) {
      sendResponse({ ok: false, error: 'control_sender_rejected' });
      return false;
    }
    void synchroniseStrategyContentScripts().then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false, error: 'strategy_permission_sync_failed' })
    );
    return true;
  }

  if (isPairGatewayMessage(message)) {
    if (!isExtensionControlSender(sender)) {
      sendResponse({ ok: false, error: 'control_sender_rejected' });
      return false;
    }
    void pairGateway(message).then(
      async (pairing) => {
        await synchroniseGatewayPolling();
        void pollGatewayTasks();
        sendResponse({
        ok: true,
        pairing: {
          gatewayInstanceId: pairing.gatewayInstanceId,
          displayName: pairing.displayName,
          loopbackOrigin: pairing.loopbackOrigin,
          identityFingerprint: pairing.identityFingerprint,
          extensionInstanceId: pairing.extensionInstanceId,
          pairedAt: pairing.pairedAt
        }
        });
      },
      (error: unknown) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'gateway_pairing_failed'
      })
    );
    return true;
  }

  if (isRevokeGatewayPairingMessage(message)) {
    if (!isExtensionControlSender(sender)) {
      sendResponse({ ok: false, error: 'control_sender_rejected' });
      return false;
    }
    void (async () => {
      await revokeGatewayPairing();
      await synchroniseGatewayPolling();
      const leases = await listStageLeases();
      await Promise.all(
        leases
          .filter((lease) => lease.status === 'active')
          .map((lease) => updateStageLeaseStatus(lease.tabId, 'cancelled'))
      );
    })().then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false, error: 'gateway_pairing_revoke_failed' })
    );
    return true;
  }

  if (message && typeof message === 'object' && (message as { type?: unknown }).type === CONTENT_READY) {
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number') {
      sendResponse({ ok: false, error: 'content_ready_source_rejected' });
      return false;
    }
    void activeStageLeaseForSender(tabId, sender.url, sender.documentId).then(
      async (lease) => {
        if (lease) {
          await collectTab(tabId);
          return { ok: true };
        }
        const validation = await activeCapabilityValidationRunForSender(tabId, sender.url, sender.documentId);
        if (!validation) return { ok: false, error: 'content_ready_without_active_lease' };
        const result = await collectTab(tabId);
        const completed = await completeCapabilityValidationRun(validation.runId, result);
        return { ok: true, validationRunId: completed.runId, validationState: completed.state };
      }
    ).then(
      (result) => sendResponse(result),
      () => sendResponse({ ok: false, error: 'content_collection_failed' })
    );
    return true;
  }
  if (isExtensionControlSender(sender)) {
    sendResponse({ ok: false, error: 'control_message_unsupported' });
  }
  return false;
});

// Keep the public protocol surface explicit in the bundled worker.
void COLLECT_VISIBLE_RESULTS;
void GET_CONTROL_SNAPSHOT;
void POLL_GATEWAY_TASKS;
void PAIR_GATEWAY;
void REVOKE_GATEWAY_PAIRING;
void START_CAPABILITY_VALIDATION;
void GET_CAPABILITY_VALIDATION;
void NETWORK_CAPTURE_OBSERVED;
void NETWORK_CAPTURE_BRIDGE_READY_MESSAGE;

chrome.tabs.onRemoved.addListener((tabId) => {
  void updateStageLeaseStatus(tabId, 'window_closed');
  void markCapabilityValidationTabClosed(tabId);
  void chrome.storage.session.remove([networkCaptureStorageKey(tabId), networkCaptureArmStorageKey(tabId)]);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    void markTaskContextChanged(tabId, changeInfo.url);
    void markCapabilityValidationTabChanged(tabId, changeInfo.url);
  }
  if (changeInfo.status !== 'complete') return;
  void chrome.tabs.get(tabId).then(async (tab) => {
    if (!tab.url) return;
    await markTaskContextChanged(tabId, tab.url);
    await markCapabilityValidationTabChanged(tabId, tab.url);
    const lease = await stageLeaseForTab(tabId);
    if (lease?.status === 'active') {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      return;
    }
    const validation = await capabilityValidationRunForTab(tabId);
    if (validation && (validation.state === 'navigating' || validation.state === 'collecting')) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
    }
  }).catch(() => undefined);
});

chrome.windows.onRemoved.addListener((windowId) => {
  void markWindowClosed(windowId);
  void markCapabilityValidationWindowClosed(windowId);
});

chrome.permissions.onAdded.addListener(() => {
  void synchroniseStrategyContentScripts();
});

chrome.permissions.onRemoved.addListener(() => {
  void synchroniseStrategyContentScripts();
  void invalidateLeasesWithoutPermissions();
  void invalidateCapabilityValidationsWithoutPermissions();
});

chrome.runtime.onInstalled.addListener(() => {
  void synchroniseStrategyContentScripts();
  void synchroniseGatewayPolling();
});

chrome.runtime.onStartup.addListener(() => {
  void synchroniseStrategyContentScripts();
  void synchroniseGatewayPolling().then(() => pollGatewayTasks());
});

void synchroniseStrategyContentScripts();
void synchroniseGatewayPolling();
void flushPendingEvidenceSubmissions().catch(() => undefined);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === GATEWAY_POLL_ALARM) void pollGatewayTasks();
});
