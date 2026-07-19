import {
  COLLECT_VISIBLE_RESULTS,
  COLLECTOR_CORE_VERSION,
  COMPLETE_TRANSCRIPT_CAPABILITY_VALIDATION,
  CONTENT_READY,
  GET_CAPABILITY_VALIDATION,
  GET_DETAIL_CAPABILITY_VALIDATION,
  GET_TRANSCRIPT_CAPABILITY_VALIDATION,
  GET_CONTROL_SNAPSHOT,
  NETWORK_CAPTURE_BRIDGE_READY_MESSAGE,
  NETWORK_CAPTURE_OBSERVED,
  PAIR_GATEWAY,
  POLL_GATEWAY_TASKS,
  REVOKE_GATEWAY_PAIRING,
  START_CAPABILITY_VALIDATION,
  START_DETAIL_CAPABILITY_VALIDATION,
  START_TRANSCRIPT_CAPABILITY_VALIDATION,
  isGetCapabilityValidationMessage,
  isGetDetailCapabilityValidationMessage,
  isGetTranscriptCapabilityValidationMessage,
  isStartCapabilityValidationMessage,
  isStartDetailCapabilityValidationMessage,
  isStartTranscriptCapabilityValidationMessage,
  isCompleteTranscriptCapabilityValidationMessage,
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
import {
  activeBoundNetworkCaptureArmForSender,
  bindNetworkCaptureArmToDocument,
  clearNetworkCaptureState,
  storeNetworkCapture
} from './network-capture-runtime';
import {
  COLLECTOR_CONTROL_SURFACE_REVISION,
  type CollectorControlSnapshot
} from '../shared/control-plane';
import { flushPendingEvidenceSubmissions, submitStageEvidence } from './evidence-submission';
import { pairGateway } from './gateway-pairing';
import {
  activeDetailCapabilityValidationRunForSender,
  completeDetailCapabilityValidationRun,
  createDetailCapabilityValidationRun,
  detailCapabilityValidationRunForTab,
  getDetailCapabilityValidationRun,
  invalidateDetailValidationsWithoutPermissions,
  markDetailValidationTabChanged,
  markDetailValidationTabClosed,
  markDetailValidationWindowClosed
} from './detail-validation-runs';
import {
  GATEWAY_POLL_ALARM,
  GATEWAY_CONTINUE_ALARM,
  STAGE_WATCHDOG_ALARM_PREFIX,
  clearStageWatchdog,
  gatewayRuntimeStatus,
  handleStageWatchdogAlarm,
  pollGatewayTasks,
  scheduleGatewayContinuation,
  synchroniseGatewayPolling
} from './gateway-task-controller';
import { gatewayPairingSummary, revokeGatewayPairing } from './pairing-store';
import {
  activeStageLeaseForSender,
  ensureTaskContentInjected,
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
import {
  TRANSCRIPT_VALIDATION_ALARM_PREFIX,
  activeTranscriptValidationForSender,
  completeTranscriptValidation,
  createTranscriptCapabilityValidationRun,
  expireTranscriptValidationRun,
  expireTranscriptValidationRuns,
  getTranscriptCapabilityValidationRun,
  invalidateTranscriptValidationsWithoutPermissions,
  markTranscriptValidationTabChanged,
  markTranscriptValidationTabClosed,
  markTranscriptValidationWindowClosed
} from './transcript-validation-runs';

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
    controlSurfaceRevision: COLLECTOR_CONTROL_SURFACE_REVISION,
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
    void bindNetworkCaptureArmToDocument(tabId, sender.url, sender.documentId).then(
      async (arm) => {
        if (!arm) {
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
            func: (expiresAt: number, platform: string, routeIds: readonly string[]) => {
              Object.defineProperty(window, '__personalIntelligenceNetworkCaptureExpiresAt', {
                value: expiresAt,
                writable: false,
                configurable: true
              });
              Object.defineProperty(window, '__personalIntelligenceNetworkCapturePlatform', {
                value: platform,
                writable: false,
                configurable: true
              });
              Object.defineProperty(window, '__personalIntelligenceNetworkCaptureRouteIds', {
                value: [...routeIds],
                writable: false,
                configurable: true
              });
            },
            args: [arm.expiresAt, arm.platform, arm.routeIds],
            injectImmediately: true
          });
          await chrome.scripting.executeScript({
            target: { tabId, documentIds: [arm.documentId] },
            world: 'MAIN',
            files: ['main-world-network-observer.js'],
            injectImmediately: true
          });
          if (arm.purpose === 'transcript_validation') {
            const run = await activeTranscriptValidationForSender(tabId, sender.url, arm.documentId);
            if (!run) throw new Error('transcript_validation_document_binding_failed');
          }
          sendResponse({ ok: true, armed: true, expiresAt: arm.expiresAt, routeIds: arm.routeIds });
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
    void activeBoundNetworkCaptureArmForSender(tabId, sender.url, sender.documentId).then(
      (arm) => arm?.platform === message.observation.platform
        ? storeNetworkCapture(tabId, message.observation, arm)
        : { stored: false },
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
          await clearStageWatchdog(lease.leaseId);
          await scheduleGatewayContinuation();
          return {
            ok: true,
            taskId: lease.taskId,
            stageId: lease.stageId,
            evidenceBatchId: evidence.batchId
          };
        }
        const validation = await activeCapabilityValidationRunForSender(tabId, sender.url, sender.documentId);
        if (validation) {
          const completed = await completeCapabilityValidationRun(validation.runId, message.result);
          return { ok: true, validationRunId: completed.runId, validationState: completed.state };
        }
        const detailValidation = await activeDetailCapabilityValidationRunForSender(
          tabId,
          sender.url,
          sender.documentId
        );
        if (!detailValidation || message.result.operation !== 'detail_read') {
          return { ok: false, error: 'collection_result_without_active_lease' };
        }
        const completed = await completeDetailCapabilityValidationRun(detailValidation.runId, message.result);
        return { ok: true, validationRunId: completed.runId, validationState: completed.state };
      }
    ).then(
      (result) => sendResponse(result),
      async () => {
        // A result may be queued before the Gateway has processed the accepted
        // stage receipt. Schedule only loopback recovery; do not re-inject,
        // navigate, refresh or repeat any platform action.
        const lease = await stageLeaseForTab(tabId).catch(() => null);
        if (lease?.status === 'active' || lease?.status === 'awaiting_evidence') {
          await scheduleGatewayContinuation().catch(() => undefined);
        }
        sendResponse({ ok: false, error: 'collection_result_storage_failed' });
      }
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

  if (isStartDetailCapabilityValidationMessage(message)) {
    if (!isExtensionControlSender(sender)) {
      sendResponse({ ok: false, error: 'control_sender_rejected' });
      return false;
    }
    void createDetailCapabilityValidationRun({
      runId: message.runId,
      profileId: message.profileId,
      canonicalUrl: message.canonicalUrl
    }).then(
      (validation) => sendResponse({ ok: true, validation }),
      (error: unknown) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'detail_validation_start_failed'
      })
    );
    return true;
  }

  if (isGetDetailCapabilityValidationMessage(message)) {
    if (!isExtensionControlSender(sender)) {
      sendResponse({ ok: false, error: 'control_sender_rejected' });
      return false;
    }
    void getDetailCapabilityValidationRun(message.runId).then(
      (validation) => sendResponse(validation
        ? { ok: true, validation }
        : { ok: false, error: 'detail_validation_run_not_found' }),
      () => sendResponse({ ok: false, error: 'detail_validation_state_unavailable' })
    );
    return true;
  }

  if (isStartTranscriptCapabilityValidationMessage(message)) {
    if (!isExtensionControlSender(sender)) {
      sendResponse({ ok: false, error: 'control_sender_rejected' });
      return false;
    }
    void createTranscriptCapabilityValidationRun({
      runId: message.runId,
      profileId: message.profileId,
      canonicalUrl: message.canonicalUrl
    }).then(
      (validation) => sendResponse({ ok: true, validation }),
      (error: unknown) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'transcript_validation_start_failed'
      })
    );
    return true;
  }

  if (isGetTranscriptCapabilityValidationMessage(message)) {
    if (!isExtensionControlSender(sender)) {
      sendResponse({ ok: false, error: 'control_sender_rejected' });
      return false;
    }
    void getTranscriptCapabilityValidationRun(message.runId).then(
      (validation) => sendResponse(validation
        ? { ok: true, validation }
        : { ok: false, error: 'transcript_validation_run_not_found' }),
      () => sendResponse({ ok: false, error: 'transcript_validation_state_unavailable' })
    );
    return true;
  }

  if (isCompleteTranscriptCapabilityValidationMessage(message)) {
    if (!isExtensionControlSender(sender)) {
      sendResponse({ ok: false, error: 'control_sender_rejected' });
      return false;
    }
    void getTranscriptCapabilityValidationRun(message.runId).then(async (run) => {
      if (!run) return { ok: false, error: 'transcript_validation_run_not_found' };
      if (run.state !== 'collecting') {
        return { ok: false, error: 'transcript_validation_run_not_active' };
      }
      const validation = await completeTranscriptValidation(run.runId, message.result);
      return { ok: true, validation };
    }).then(
      (result) => sendResponse(result),
      (error: unknown) => sendResponse({
        ok: false,
        error: error instanceof Error && /^[a-z0-9_]{1,100}$/.test(error.message)
          ? error.message
          : 'transcript_validation_completion_failed'
      })
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
        // READY is content-driven so the MV3 worker is held alive by this exact
        // message event while Evidence is submitted. The dispatch loop and its
        // durable watchdog remain independent recovery and terminal paths.
        if (lease) {
          const result = await collectTab(tabId);
          const evidence = await submitStageEvidence(lease, result);
          await clearStageWatchdog(lease.leaseId);
          await scheduleGatewayContinuation();
          return { ok: true, evidenceBatchId: evidence.batchId };
        }
        const knownLease = await stageLeaseForTab(tabId);
        if (
          knownLease &&
          (knownLease.status === 'awaiting_evidence' ||
            knownLease.status === 'completed')
        ) return { ok: true };
        const validation = await activeCapabilityValidationRunForSender(tabId, sender.url, sender.documentId);
        if (validation) {
          const result = await collectTab(tabId);
          const completed = await completeCapabilityValidationRun(validation.runId, result);
          return { ok: true, validationRunId: completed.runId, validationState: completed.state };
        }
        const detailValidation = await activeDetailCapabilityValidationRunForSender(
          tabId,
          sender.url,
          sender.documentId
        );
        if (!detailValidation) return { ok: false, error: 'content_ready_without_active_lease' };
        const result = await collectTab(tabId);
        if (result.operation !== 'detail_read') return { ok: false, error: 'detail_validation_result_invalid' };
        const completed = await completeDetailCapabilityValidationRun(detailValidation.runId, result);
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
void START_DETAIL_CAPABILITY_VALIDATION;
void GET_DETAIL_CAPABILITY_VALIDATION;
void START_TRANSCRIPT_CAPABILITY_VALIDATION;
void GET_TRANSCRIPT_CAPABILITY_VALIDATION;
void COMPLETE_TRANSCRIPT_CAPABILITY_VALIDATION;
void NETWORK_CAPTURE_OBSERVED;
void NETWORK_CAPTURE_BRIDGE_READY_MESSAGE;

chrome.tabs.onRemoved.addListener((tabId) => {
  void stageLeaseForTab(tabId).then((lease) => {
    if (lease?.status === 'active' || lease?.status === 'awaiting_evidence') {
      return updateStageLeaseStatus(tabId, 'window_closed');
    }
    return undefined;
  });
  void markCapabilityValidationTabClosed(tabId);
  void markDetailValidationTabClosed(tabId);
  void markTranscriptValidationTabClosed(tabId);
  void clearNetworkCaptureState(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    void markTaskContextChanged(tabId, changeInfo.url);
    void markCapabilityValidationTabChanged(tabId, changeInfo.url);
    void markDetailValidationTabChanged(tabId, changeInfo.url);
    void markTranscriptValidationTabChanged(tabId, changeInfo.url);
  }
  if (changeInfo.status !== 'loading' && changeInfo.status !== 'complete') return;
  void chrome.tabs.get(tabId).then(async (tab) => {
    if (!tab.url) return;
    await markTaskContextChanged(tabId, tab.url);
    await markCapabilityValidationTabChanged(tabId, tab.url);
    await markDetailValidationTabChanged(tabId, tab.url);
    await markTranscriptValidationTabChanged(tabId, tab.url);
    const lease = await stageLeaseForTab(tabId);
    if (lease?.status === 'active') {
      await ensureTaskContentInjected(lease);
      return;
    }
    const validation = await capabilityValidationRunForTab(tabId);
    if (validation && (validation.state === 'navigating' || validation.state === 'collecting')) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      return;
    }
    const detailValidation = await detailCapabilityValidationRunForTab(tabId);
    if (detailValidation && (detailValidation.state === 'navigating' || detailValidation.state === 'collecting')) {
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
  void markDetailValidationWindowClosed(windowId);
  void markTranscriptValidationWindowClosed(windowId);
});

chrome.permissions.onAdded.addListener(() => {
  void synchroniseStrategyContentScripts();
});

chrome.permissions.onRemoved.addListener(() => {
  void synchroniseStrategyContentScripts();
  void invalidateLeasesWithoutPermissions();
  void invalidateCapabilityValidationsWithoutPermissions();
  void invalidateDetailValidationsWithoutPermissions();
  void invalidateTranscriptValidationsWithoutPermissions();
});

chrome.runtime.onInstalled.addListener(() => {
  void synchroniseStrategyContentScripts();
  void synchroniseGatewayPolling();
});

chrome.runtime.onStartup.addListener(() => {
  void synchroniseStrategyContentScripts();
  void synchroniseGatewayPolling().then(() => pollGatewayTasks());
  void expireTranscriptValidationRuns();
});

void synchroniseStrategyContentScripts();
void synchroniseGatewayPolling();
void flushPendingEvidenceSubmissions().catch(() => undefined);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith(STAGE_WATCHDOG_ALARM_PREFIX)) {
    void handleStageWatchdogAlarm(alarm.name);
    return;
  }
  if (alarm.name.startsWith(TRANSCRIPT_VALIDATION_ALARM_PREFIX)) {
    void expireTranscriptValidationRun(alarm.name.slice(TRANSCRIPT_VALIDATION_ALARM_PREFIX.length));
    return;
  }
  if (alarm.name === GATEWAY_POLL_ALARM || alarm.name === GATEWAY_CONTINUE_ALARM) {
    void pollGatewayTasks();
  }
});
