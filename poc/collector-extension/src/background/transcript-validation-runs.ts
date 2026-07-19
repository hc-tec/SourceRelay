import {
  COLLECTOR_CORE_VERSION,
  type TranscriptCapabilityValidationRunSnapshot,
  type TranscriptInteractionAction,
  type TranscriptInteractionActionResult,
  type TranscriptInteractionResult
} from '../shared/protocol';
import { bilibiliTranscriptResearchRouteIds } from '../shared/network-capture';
import { resolveTranscriptStrategy, strategyProvenance } from '../shared/strategy-registry';
import { canonicalBilibiliVideoUrl } from '../shared/bilibili-video-url';
import {
  activeBoundNetworkCaptureArmForSender,
  armNetworkCapture,
  clearNetworkCaptureState,
  getActiveNetworkCaptureArm,
  readNetworkCaptures
} from './network-capture-runtime';
import { acquireTranscriptTargetWindow } from './transcript-target-window';

const STORAGE_KEY = 'collector.transcript-capability-validations.v1';
const VALIDATION_TTL_MS = 45_000;
const BRIDGE_REGISTRATION_PREFIX = 'collector-transcript-bridge-';
export const TRANSCRIPT_VALIDATION_ALARM_PREFIX = 'collector.transcript-validation-deadline.';
const terminalStates = new Set(['completed', 'inconclusive', 'failed']);

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function registrationSuffix(runId: string): string {
  return runId.replace(/-/g, '').toLowerCase();
}

function registrationIds(runId: string): string[] {
  const suffix = registrationSuffix(runId);
  return [`${BRIDGE_REGISTRATION_PREFIX}${suffix}`];
}

function isRun(value: unknown): value is TranscriptCapabilityValidationRunSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TranscriptCapabilityValidationRunSnapshot>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.runId === 'string' && /^[0-9a-f-]{36}$/i.test(candidate.runId) &&
    typeof candidate.profileId === 'string' && /^[0-9a-f-]{36}$/i.test(candidate.profileId) &&
    candidate.platform === 'bilibili' &&
    candidate.accountCategory === 'user_managed' &&
    candidate.evidenceObjective === 'transcript_read' &&
    typeof candidate.targetUrlDigest === 'string' && /^[0-9a-f]{64}$/.test(candidate.targetUrlDigest) &&
    typeof candidate.navigationUrlDigest === 'string' && /^[0-9a-f]{64}$/.test(candidate.navigationUrlDigest) &&
    typeof candidate.windowId === 'number' &&
    typeof candidate.tabId === 'number' &&
    typeof candidate.startedAt === 'string' &&
    typeof candidate.expiresAt === 'string' &&
    typeof candidate.completedAt !== 'undefined' &&
    Array.isArray(candidate.captures) &&
    Boolean(candidate.safeguards) &&
    (candidate.state === 'navigating' || candidate.state === 'collecting' ||
      candidate.state === 'completed' || candidate.state === 'inconclusive' || candidate.state === 'failed')
  );
}

async function storedRuns(): Promise<TranscriptCapabilityValidationRunSnapshot[]> {
  const value = (await chrome.storage.session.get(STORAGE_KEY))[STORAGE_KEY];
  return Array.isArray(value) ? value.filter(isRun) : [];
}

async function saveRun(run: TranscriptCapabilityValidationRunSnapshot): Promise<void> {
  const runs = await storedRuns();
  const next = [run, ...runs.filter((candidate) => candidate.runId !== run.runId)].slice(0, 20);
  await chrome.storage.session.set({ [STORAGE_KEY]: next });
}

async function unregisterRunScripts(runId: string): Promise<void> {
  const registered = new Set((await chrome.scripting.getRegisteredContentScripts()).map((script) => script.id));
  const ids = registrationIds(runId).filter((id) => registered.has(id));
  if (ids.length > 0) await chrome.scripting.unregisterContentScripts({ ids }).catch(() => undefined);
}

async function cleanupRun(run: TranscriptCapabilityValidationRunSnapshot, closeWindow: boolean): Promise<void> {
  await chrome.alarms.clear(`${TRANSCRIPT_VALIDATION_ALARM_PREFIX}${run.runId}`);
  await unregisterRunScripts(run.runId);
  await clearNetworkCaptureState(run.tabId);
  if (closeWindow) await chrome.windows.remove(run.windowId).catch(() => undefined);
}

async function registerRunScripts(runId: string): Promise<void> {
  const [bridgeId] = registrationIds(runId);
  await chrome.scripting.registerContentScripts([
    {
      id: bridgeId,
      matches: ['https://www.bilibili.com/video/*'],
      js: ['network-capture-bridge.js'],
      runAt: 'document_start',
      allFrames: false,
      persistAcrossSessions: false
    }
  ]);
}

function safeLabels(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((label): label is string =>
      typeof label === 'string' && label.length > 0 && label.length <= 300
    ))].slice(0, 40)
    : [];
}

function sanitiseAction(value: unknown): TranscriptInteractionActionResult | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<TranscriptInteractionActionResult>;
  const action = candidate.action === 'reveal_player_controls' ||
    candidate.action === 'open_caption_menu' ||
    candidate.action === 'select_caption_language'
    ? candidate.action
    : null;
  const outcomes = new Set([
    'completed', 'control_missing', 'option_unavailable', 'prerequisite_unmet', 'postcondition_unmet',
    'page_unavailable', 'context_changed', 'network_unavailable', 'risk_detected'
  ]);
  if (!action || typeof candidate.attempted !== 'boolean' || !outcomes.has(candidate.outcome ?? '')) return null;
  const selectedLabel = candidate.selectedLabel === null
    ? null
    : typeof candidate.selectedLabel === 'string' && /^(?:中文|汉语)(?:[（(].{1,30}[）)])?$/.test(candidate.selectedLabel)
      ? candidate.selectedLabel
      : null;
  return {
    action,
    attempted: candidate.attempted,
    outcome: candidate.outcome!,
    visibleLabels: safeLabels(candidate.visibleLabels),
    selectedLabel,
    postconditionAcknowledged: typeof candidate.postconditionAcknowledged === 'boolean'
      ? candidate.postconditionAcknowledged
      : null
  };
}

function sanitiseInteraction(
  value: unknown,
  canonicalUrl: string
): TranscriptInteractionResult | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<TranscriptInteractionResult>;
  if (candidate.schemaVersion !== 1 || canonicalBilibiliVideoUrl(candidate.canonicalUrl ?? '') !== canonicalUrl) return null;
  if (!Array.isArray(candidate.actions) || candidate.actions.length !== 3) return null;
  const actions = candidate.actions.map(sanitiseAction);
  if (actions.some((action) => action === null)) return null;
  const safeActions = actions as TranscriptInteractionActionResult[];
  const names = safeActions.map((action) => action.action);
  const requiredActions: TranscriptInteractionAction[] = [
    'reveal_player_controls',
    'open_caption_menu',
    'select_caption_language'
  ];
  if (new Set(names).size !== names.length || names.some((name, index) => name !== requiredActions[index])) return null;
  const completedActions = safeActions.filter((action) => action.outcome === 'completed').map((action) => action.action);
  const status = completedActions.length === requiredActions.length
    ? 'satisfied'
    : completedActions.length > 0
      ? 'partial'
      : 'not_satisfied';
  const errorCode = candidate.errorCode === null
    ? null
    : typeof candidate.errorCode === 'string' && /^[a-z0-9_]{1,100}$/.test(candidate.errorCode)
      ? candidate.errorCode
      : 'transcript_validation_interaction_invalid';
  return {
    schemaVersion: 1,
    canonicalUrl,
    state: candidate.state === 'failed' ? 'failed' : status === 'satisfied' ? 'completed' : 'inconclusive',
    objective: { status, requiredActions, completedActions },
    actions: safeActions,
    errorCode,
    completedAt: typeof candidate.completedAt === 'string' ? candidate.completedAt : new Date().toISOString()
  };
}

export async function getTranscriptCapabilityValidationRun(
  runId: string
): Promise<TranscriptCapabilityValidationRunSnapshot | null> {
  return (await storedRuns()).find((run) => run.runId === runId) ?? null;
}

export async function createTranscriptCapabilityValidationRun(input: {
  runId: string;
  profileId: string;
  canonicalUrl: string;
}): Promise<TranscriptCapabilityValidationRunSnapshot> {
  const canonicalUrl = canonicalBilibiliVideoUrl(input.canonicalUrl);
  if (!canonicalUrl) throw new Error('transcript_validation_url_invalid');
  if ((await getTranscriptCapabilityValidationRun(input.runId)) !== null) {
    throw new Error('transcript_validation_run_already_exists');
  }
  const existingRuns = await storedRuns();
  if (existingRuns.some((run) => !terminalStates.has(run.state))) {
    throw new Error('transcript_validation_run_already_active');
  }
  const strategy = resolveTranscriptStrategy('bilibili');
  if (!await chrome.permissions.contains({ origins: [...strategy.browser.optionalHostPermissions] })) {
    throw new Error('transcript_validation_host_permission_required');
  }
  const target = await acquireTranscriptTargetWindow(existingRuns);
  const startedAt = new Date();
  const expiresAt = startedAt.getTime() + VALIDATION_TTL_MS;
  const targetDigest = await sha256(canonicalUrl);
  const run: TranscriptCapabilityValidationRunSnapshot = {
    schemaVersion: 1,
    collectorVersion: COLLECTOR_CORE_VERSION,
    runId: input.runId,
    profileId: input.profileId,
    platform: 'bilibili',
    accountCategory: 'user_managed',
    evidenceObjective: 'transcript_read',
    strategy: strategyProvenance(strategy),
    targetUrlDigest: targetDigest,
    navigationUrlDigest: targetDigest,
    windowId: target.windowId,
    tabId: target.tabId,
    state: 'navigating',
    terminalStatus: null,
    errorCode: null,
    startedAt: startedAt.toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    completedAt: null,
    interaction: null,
    captures: [],
    safeguards: {
      environment: 'local_user_controlled_collection_profile',
      admissionEligible: false,
      semanticActionDelivery: 'at_most_once',
      productionResponseRoutes: 'unchanged_empty',
      cookiesAndTokens: 'not_read',
      requestHeaders: 'not_read',
      requestBody: 'not_read',
      queryAndFragmentValues: 'discarded',
      targetPage: 'retained_after_validation'
    }
  };
  await saveRun(run);
  try {
    await chrome.alarms.create(`${TRANSCRIPT_VALIDATION_ALARM_PREFIX}${run.runId}`, { when: expiresAt });
    await registerRunScripts(run.runId);
    await armNetworkCapture({
      tabId: run.tabId,
      platform: 'bilibili',
      purpose: 'transcript_validation',
      runId: run.runId,
      navigationUrl: canonicalUrl,
      routeIds: bilibiliTranscriptResearchRouteIds(),
      expiresAt
    });
    await chrome.tabs.update(run.tabId, { url: canonicalUrl, active: true });
  } catch (error) {
    const failed: TranscriptCapabilityValidationRunSnapshot = {
      ...run,
      state: 'failed',
      terminalStatus: 'failed',
      errorCode: error instanceof Error && /^[a-z0-9_]{1,100}$/.test(error.message)
        ? error.message
        : 'transcript_validation_start_failed',
      completedAt: new Date().toISOString()
    };
    await saveRun(failed);
    await cleanupRun(failed, !target.reused);
    throw error;
  }
  return run;
}

export async function activeTranscriptValidationForSender(
  tabId: number,
  senderUrl: string | undefined,
  documentId: string | undefined
): Promise<TranscriptCapabilityValidationRunSnapshot | null> {
  if (!senderUrl || !documentId) return null;
  const canonicalUrl = canonicalBilibiliVideoUrl(senderUrl, 'observed_document');
  const run = (await storedRuns()).find((candidate) => candidate.tabId === tabId);
  if (!canonicalUrl || !run || terminalStates.has(run.state)) return null;
  if ((await sha256(canonicalUrl)) !== run.navigationUrlDigest) return null;
  const arm = await activeBoundNetworkCaptureArmForSender(tabId, senderUrl, documentId);
  if (!arm || arm.purpose !== 'transcript_validation' || arm.runId !== run.runId) return null;
  const bound = { ...run, documentId, state: 'collecting' as const };
  await saveRun(bound);
  return bound;
}

export async function completeTranscriptValidation(
  runId: string,
  interactionCandidate: unknown
): Promise<TranscriptCapabilityValidationRunSnapshot> {
  const run = await getTranscriptCapabilityValidationRun(runId);
  if (!run) throw new Error('transcript_validation_run_not_found');
  if (terminalStates.has(run.state)) return run;
  const tab = await chrome.tabs.get(run.tabId).catch(() => null);
  const canonicalUrl = canonicalBilibiliVideoUrl(tab?.url ?? '', 'observed_document');
  if (!canonicalUrl) throw new Error('transcript_validation_context_changed');
  const interaction = sanitiseInteraction(interactionCandidate, canonicalUrl);
  if (!interaction) throw new Error('transcript_validation_interaction_invalid');
  const arm = await getActiveNetworkCaptureArm(run.tabId);
  const captures = arm ? await readNetworkCaptures(run.tabId, arm) : [];
  const directory = captures.find((capture) =>
    capture.routeId === 'bilibili.video.transcript.track-directory.response.v1' && capture.status === 'captured'
  );
  const document = captures.find((capture) =>
    capture.routeId === 'bilibili.video.transcript.document.response.v1' && capture.status === 'captured'
  );
  const riskDetected = interaction?.actions.some((action) => action.outcome === 'risk_detected') ?? false;
  const completed = Boolean(interaction?.objective.status === 'satisfied' && directory && document);
  const snapshot: TranscriptCapabilityValidationRunSnapshot = {
    ...run,
    ...(run.documentId ? {} : arm?.documentId ? { documentId: arm.documentId } : {}),
    state: completed ? 'completed' : interaction?.state === 'failed' ? 'failed' : 'inconclusive',
    terminalStatus: completed
      ? 'completed'
      : riskDetected
        ? 'verification_required'
        : directory || document
          ? 'partial'
          : 'source_unavailable',
    errorCode: completed
      ? null
      : interaction?.errorCode ?? (riskDetected
        ? 'transcript_validation_risk_detected'
        : 'transcript_validation_partial'),
    completedAt: new Date().toISOString(),
    interaction,
    captures
  };
  await saveRun(snapshot);
  await cleanupRun(snapshot, false);
  return snapshot;
}

export async function completeTranscriptValidationWithError(
  runId: string,
  terminalStatus: NonNullable<TranscriptCapabilityValidationRunSnapshot['terminalStatus']>,
  errorCode: string
): Promise<TranscriptCapabilityValidationRunSnapshot> {
  const run = await getTranscriptCapabilityValidationRun(runId);
  if (!run) throw new Error('transcript_validation_run_not_found');
  if (terminalStates.has(run.state)) return run;
  const arm = await getActiveNetworkCaptureArm(run.tabId);
  const captures = arm ? await readNetworkCaptures(run.tabId, arm) : [];
  const snapshot: TranscriptCapabilityValidationRunSnapshot = {
    ...run,
    state: terminalStatus === 'failed' ? 'failed' : 'inconclusive',
    terminalStatus,
    errorCode,
    completedAt: new Date().toISOString(),
    captures
  };
  await saveRun(snapshot);
  await cleanupRun(snapshot, false);
  return snapshot;
}

export async function markTranscriptValidationTabChanged(tabId: number, changedUrl: string): Promise<void> {
  const run = (await storedRuns()).find((candidate) => candidate.tabId === tabId);
  if (!run || terminalStates.has(run.state)) return;
  const canonical = canonicalBilibiliVideoUrl(changedUrl, 'observed_document');
  if (!canonical || (await sha256(canonical)) !== run.navigationUrlDigest) {
    await completeTranscriptValidationWithError(
      run.runId,
      'layout_changed',
      'transcript_validation_context_changed'
    );
  }
}

export async function markTranscriptValidationWindowClosed(windowId: number): Promise<void> {
  const run = (await storedRuns()).find((candidate) => candidate.windowId === windowId);
  if (run && !terminalStates.has(run.state)) {
    await completeTranscriptValidationWithError(
      run.runId,
      'cancelled_partial',
      'transcript_validation_window_closed'
    );
  }
}

export async function markTranscriptValidationTabClosed(tabId: number): Promise<void> {
  const run = (await storedRuns()).find((candidate) => candidate.tabId === tabId);
  if (run && !terminalStates.has(run.state)) {
    await completeTranscriptValidationWithError(
      run.runId,
      'cancelled_partial',
      'transcript_validation_tab_closed'
    );
  }
}

export async function expireTranscriptValidationRuns(now = Date.now()): Promise<void> {
  for (const run of (await storedRuns()).filter((candidate) => !terminalStates.has(candidate.state))) {
    if (Date.parse(run.expiresAt) <= now) {
      await completeTranscriptValidationWithError(
        run.runId,
        'budget_exhausted_partial',
        'transcript_validation_deadline_expired'
      );
    }
  }
}

export async function expireTranscriptValidationRun(runId: string): Promise<void> {
  const run = await getTranscriptCapabilityValidationRun(runId);
  if (run && !terminalStates.has(run.state)) {
    await completeTranscriptValidationWithError(
      run.runId,
      'budget_exhausted_partial',
      'transcript_validation_deadline_expired'
    );
  }
}

export async function invalidateTranscriptValidationsWithoutPermissions(): Promise<void> {
  const strategy = resolveTranscriptStrategy('bilibili');
  if (await chrome.permissions.contains({ origins: [...strategy.browser.optionalHostPermissions] })) return;
  for (const run of (await storedRuns()).filter((candidate) => !terminalStates.has(candidate.state))) {
    await completeTranscriptValidationWithError(
      run.runId,
      'capability_unavailable',
      'transcript_validation_permission_revoked'
    );
  }
}
