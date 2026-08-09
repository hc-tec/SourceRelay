import {
  BILIBILI_TRANSCRIPT_CHINESE_SELECTION_SCHEMA_VERSION,
  canonicalBilibiliTranscriptVideoUrl,
  isBilibiliTranscriptChineseSelectionRequest,
  type BilibiliTranscriptChineseSelectionRequest,
  type BilibiliTranscriptChineseSelectionResult,
  type BilibiliTranscriptInteractionDomState,
  type BilibiliTranscriptInteractionOutcome,
  type BilibiliTranscriptInteractionStep,
  type BilibiliTranscriptInteractionStepResult,
  type PageVisualEvidence
} from '@intelligence/collector-contracts';
import { hostError } from '../host-errors.js';
import { touchRecord, transitionRecord, type ManagedPageRecord } from './page-record.js';
import { captureManagedPageVisualEvidence } from './page-visual-evidence.js';
import {
  readBilibiliTranscriptDomProbe,
  type BilibiliTranscriptDomProbe
} from './bilibili-transcript-dom-probe.js';

const STEPS: readonly BilibiliTranscriptInteractionStep[] = [
  'reveal_player_controls',
  'open_caption_menu',
  'select_chinese_caption'
];
const PROBE_INTERVAL_MS = 100;
const CONTROL_REVEAL_TIMEOUT_MS = 2_500;
const MENU_REVEAL_TIMEOUT_MS = 2_500;

export function validateTrustedBilibiliTranscriptChineseSelectionRequest(
  request: BilibiliTranscriptChineseSelectionRequest
): void {
  if (!isBilibiliTranscriptChineseSelectionRequest(request) ||
    request.schemaVersion !== BILIBILI_TRANSCRIPT_CHINESE_SELECTION_SCHEMA_VERSION) {
    throw hostError({ code: 'bilibili_transcript_selection_schema_invalid', category: 'protocol', scope: 'action' });
  }
}

/**
 * Runs the one fixed, human-equivalent Bilibili interaction sequence. Gateway
 * cannot supply selectors, JavaScript, or coordinates: the Host discovers the
 * current semantic targets and emits browser-level mouse input at most once
 * for every meaningful step.
 */
export async function executeTrustedBilibiliTranscriptChineseSelection(input: {
  record: ManagedPageRecord;
  request: BilibiliTranscriptChineseSelectionRequest;
  visualEvidenceDirectory: string;
  assertLeasedRunRecord: () => void;
  emit: (eventType: string, reason: string | null, actionId: string | null) => void;
}): Promise<BilibiliTranscriptChineseSelectionResult> {
  const { record, request } = input;
  validateTrustedBilibiliTranscriptChineseSelectionRequest(request);
  if (record.attemptedActionIds.has(request.actionId)) {
    throw hostError({ code: 'action_already_attempted', category: 'action', scope: 'action' });
  }
  input.assertLeasedRunRecord();
  assertTranscriptPage(record, request);

  const deadline = Date.now() + request.timeoutMs;
  let browserInputAttempted = false;
  const actions = defaultActions();
  let baseline: PageVisualEvidence | null = null;
  try {
    let probe = await waitForProbe(
      record,
      request,
      deadline,
      (candidate) => stoppedByRisk(candidate.dom) ||
        (candidate.dom.playerAreaPresent && candidate.dom.captionControlAttached)
    );
    baseline = await captureEvidence(record, input.visualEvidenceDirectory, remaining(deadline));

    if (stoppedByRisk(probe.dom) || !probe.dom.playerAreaPresent || !probe.dom.captionControlAttached) {
      return result(record, request, actions, probe.dom, baseline, await captureEvidence(record, input.visualEvidenceDirectory, remaining(deadline)));
    }
    if (probe.dom.chineseOptionActive && probe.dom.subtitlePanelVisible) {
      setAll(actions, 'already_satisfied');
      return result(record, request, actions, probe.dom, baseline, await captureEvidence(record, input.visualEvidenceDirectory, remaining(deadline)));
    }

    if (probe.dom.captionControlVisuallyExposed) {
      setAction(actions, 'reveal_player_controls', false, 'already_satisfied');
    } else if (!probe.videoArea || !probe.videoArea.pointerHitTarget) {
      return result(record, request, actions, probe.dom, baseline, await captureEvidence(record, input.visualEvidenceDirectory, remaining(deadline)));
    } else {
      markBrowserInput(record, request, input);
      browserInputAttempted = true;
      setAction(actions, 'reveal_player_controls', true, 'prerequisite_unmet');
      await withinDeadline(record.page.mouse.move(probe.videoArea.pointer.x, probe.videoArea.pointer.y), remaining(deadline));
      probe = await waitForProbe(
        record,
        request,
        subDeadline(deadline, CONTROL_REVEAL_TIMEOUT_MS),
        (candidate) => candidate.dom.captionControlVisuallyExposed || stoppedByRisk(candidate.dom)
      );
      if (stoppedByRisk(probe.dom)) {
        setAction(actions, 'reveal_player_controls', true, 'postcondition_unmet');
        return result(record, request, actions, probe.dom, baseline, await captureEvidence(record, input.visualEvidenceDirectory, remaining(deadline)));
      }
      if (!probe.dom.captionControlVisuallyExposed) {
        setAction(actions, 'reveal_player_controls', true, 'postcondition_unmet');
        return result(record, request, actions, probe.dom, baseline, await captureEvidence(record, input.visualEvidenceDirectory, remaining(deadline)));
      }
      setAction(actions, 'reveal_player_controls', true, 'completed');
    }

    if (probe.dom.chineseOptionVisible) {
      setAction(actions, 'open_caption_menu', false, 'already_satisfied');
    } else if (!probe.captionControl || !probe.captionControl.pointerHitTarget) {
      return result(record, request, actions, probe.dom, baseline, await captureEvidence(record, input.visualEvidenceDirectory, remaining(deadline)));
    } else {
      markBrowserInput(record, request, input);
      browserInputAttempted = true;
      setAction(actions, 'open_caption_menu', true, 'prerequisite_unmet');
      await withinDeadline(record.page.mouse.move(probe.captionControl.pointer.x, probe.captionControl.pointer.y), remaining(deadline));
      probe = await waitForProbe(
        record,
        request,
        subDeadline(deadline, MENU_REVEAL_TIMEOUT_MS),
        (candidate) => candidate.dom.chineseOptionVisible || stoppedByRisk(candidate.dom)
      );
      if (stoppedByRisk(probe.dom)) {
        setAction(actions, 'open_caption_menu', true, 'postcondition_unmet');
        return result(record, request, actions, probe.dom, baseline, await captureEvidence(record, input.visualEvidenceDirectory, remaining(deadline)));
      }
      if (!probe.dom.chineseOptionVisible) {
        setAction(actions, 'open_caption_menu', true, 'postcondition_unmet');
        return result(record, request, actions, probe.dom, baseline, await captureEvidence(record, input.visualEvidenceDirectory, remaining(deadline)));
      }
      setAction(actions, 'open_caption_menu', true, 'completed');
    }

    if (probe.dom.chineseOptionActive && probe.dom.subtitlePanelVisible) {
      setAction(actions, 'select_chinese_caption', false, 'already_satisfied');
      return result(record, request, actions, probe.dom, baseline, await captureEvidence(record, input.visualEvidenceDirectory, remaining(deadline)));
    }
    if (!probe.chineseOption || !probe.chineseOption.pointerHitTarget) {
      return result(record, request, actions, probe.dom, baseline, await captureEvidence(record, input.visualEvidenceDirectory, remaining(deadline)));
    }

    markBrowserInput(record, request, input);
    browserInputAttempted = true;
    setAction(actions, 'select_chinese_caption', true, 'prerequisite_unmet');
    await withinDeadline(record.page.mouse.move(probe.chineseOption.pointer.x, probe.chineseOption.pointer.y), remaining(deadline));
    await withinDeadline(record.page.mouse.down({ button: 'left' }), remaining(deadline));
    await withinDeadline(new Promise((resolve) => setTimeout(resolve, 100)), remaining(deadline));
    await withinDeadline(record.page.mouse.up({ button: 'left' }), remaining(deadline));
    await withinDeadline(new Promise((resolve) => setTimeout(resolve, 150)), remaining(deadline));
    probe = await waitForProbe(
      record,
      request,
      deadline,
      (candidate) => (candidate.dom.chineseOptionActive && candidate.dom.subtitlePanelVisible) || stoppedByRisk(candidate.dom)
    );
    if (probe.dom.chineseOptionActive && probe.dom.subtitlePanelVisible) {
      setAction(actions, 'select_chinese_caption', true, 'completed');
    } else {
      setAction(actions, 'select_chinese_caption', true, 'postcondition_unmet');
    }
    return result(record, request, actions, probe.dom, baseline, await captureEvidence(record, input.visualEvidenceDirectory, remaining(deadline)));
  } catch (error) {
    if (!browserInputAttempted) throw error;
    record.activeLease = null;
    transitionRecord(record, 'quarantined', 'bilibili_transcript_selection_outcome_unknown');
    input.emit('bilibili_transcript_selection_outcome_unknown', 'bilibili_transcript_selection_outcome_unknown', request.actionId);
    throw hostError({
      code: 'bilibili_transcript_selection_outcome_unknown',
      category: 'browser_input',
      scope: 'action',
      retryClass: 'new_run_required',
      platformActionAttempted: true,
      pageDisposition: 'quarantined',
      profileSafetyDisposition: 'stop_run_no_retry',
      safeDetails: { errorType: error instanceof Error ? error.name : 'unknown' }
    });
  }
}

function assertTranscriptPage(record: ManagedPageRecord, request: BilibiliTranscriptChineseSelectionRequest): void {
  if (record.state !== 'leased') {
    throw hostError({ code: 'bilibili_transcript_selection_page_not_ready', category: 'page_identity', scope: 'page' });
  }
  if (record.platform !== 'bilibili' || record.pageRole !== 'video_detail') {
    throw hostError({ code: 'bilibili_transcript_selection_page_role_rejected', category: 'page_identity', scope: 'page' });
  }
  if (record.documentGeneration !== request.expectedDocumentGeneration) {
    throw hostError({
      code: 'managed_page_document_generation_mismatch',
      category: 'page_identity',
      scope: 'page',
      retryClass: 'local_query_only'
    });
  }
  // Bilibili adds a short-lived `vd_source` query parameter during a normal
  // document load.  The generic page identity digest intentionally includes
  // query values, so comparing it literally here would reject this legitimate
  // same-video redirect before the trusted caption click can run.  The
  // source-specific canonicalizer is stricter for this flow: it accepts only
  // the exact BVID path and the single audited 32-hex `vd_source` parameter.
  if (record.page.isClosed() ||
    !matchesTrustedBilibiliTranscriptPageIdentity(record.page.url(), request.canonicalVideoUrl)) {
    throw hostError({
      code: 'bilibili_transcript_selection_page_identity_unverified',
      category: 'page_identity',
      scope: 'page',
      retryClass: 'new_run_required'
    });
  }
}

export function matchesTrustedBilibiliTranscriptPageIdentity(
  observedUrl: string,
  canonicalVideoUrl: string
): boolean {
  return canonicalBilibiliTranscriptVideoUrl(observedUrl, 'observed_document') === canonicalVideoUrl;
}

function defaultActions(): BilibiliTranscriptInteractionStepResult[] {
  return STEPS.map((step) => ({ step, attempted: false, outcome: 'prerequisite_unmet' }));
}

function setAll(actions: BilibiliTranscriptInteractionStepResult[], outcome: BilibiliTranscriptInteractionOutcome): void {
  for (const action of actions) action.outcome = outcome;
}

function setAction(
  actions: BilibiliTranscriptInteractionStepResult[],
  step: BilibiliTranscriptInteractionStep,
  attempted: boolean,
  outcome: BilibiliTranscriptInteractionOutcome
): void {
  const action = actions.find((candidate) => candidate.step === step);
  if (!action) throw new Error('bilibili_transcript_action_missing');
  action.attempted = attempted;
  action.outcome = outcome;
}

function markBrowserInput(
  record: ManagedPageRecord,
  request: BilibiliTranscriptChineseSelectionRequest,
  input: { emit: (eventType: string, reason: string | null, actionId: string | null) => void }
): void {
  if (record.attemptedActionIds.has(request.actionId)) return;
  record.attemptedActionIds.add(request.actionId);
  touchRecord(record);
  input.emit('action_attempted', null, request.actionId);
}

async function waitForProbe(
  record: ManagedPageRecord,
  request: BilibiliTranscriptChineseSelectionRequest,
  deadline: number,
  ready: (probe: BilibiliTranscriptDomProbe) => boolean
): Promise<BilibiliTranscriptDomProbe> {
  let latest: BilibiliTranscriptDomProbe | null = null;
  while (Date.now() < deadline) {
    assertTranscriptPage(record, request);
    latest = await readBilibiliTranscriptDomProbe(record.page, remaining(deadline));
    if (ready(latest)) return latest;
    await delay(Math.min(PROBE_INTERVAL_MS, Math.max(1, deadline - Date.now())));
  }
  if (!latest) throw new Error('bilibili_transcript_dom_probe_unavailable');
  return latest;
}

async function captureEvidence(record: ManagedPageRecord, directory: string, timeoutMs: number): Promise<PageVisualEvidence> {
  return await withinDeadline(captureManagedPageVisualEvidence({
    page: record.page,
    pageAlias: record.pageAlias,
    documentGeneration: record.documentGeneration,
    routeGeneration: record.routeGeneration,
    directory
  }), timeoutMs);
}

function result(
  record: ManagedPageRecord,
  request: BilibiliTranscriptChineseSelectionRequest,
  actions: readonly BilibiliTranscriptInteractionStepResult[],
  dom: BilibiliTranscriptInteractionDomState,
  baseline: PageVisualEvidence,
  final: PageVisualEvidence
): BilibiliTranscriptChineseSelectionResult {
  return {
    schemaVersion: BILIBILI_TRANSCRIPT_CHINESE_SELECTION_SCHEMA_VERSION,
    pageAlias: record.pageAlias,
    actionId: request.actionId,
    recordVersion: record.recordVersion,
    documentGeneration: record.documentGeneration,
    routeGeneration: record.routeGeneration,
    completedAt: new Date().toISOString(),
    actions: actions.map((action) => ({ ...action })),
    dom: { ...dom },
    visualEvidence: { baseline, final }
  };
}

function stoppedByRisk(dom: BilibiliTranscriptInteractionDomState): boolean {
  return dom.authenticationRequired || dom.verificationRequired || dom.rateLimited || dom.sourceUnavailable;
}

function subDeadline(deadline: number, maximumDurationMs: number): number {
  const target = Math.min(deadline, Date.now() + maximumDurationMs);
  if (target - Date.now() < 100) throw new Error('bilibili_transcript_selection_deadline_exceeded');
  return target;
}

function remaining(deadline: number): number {
  const value = deadline - Date.now();
  if (value < 100) throw new Error('bilibili_transcript_selection_deadline_exceeded');
  return value;
}

async function withinDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('bilibili_transcript_selection_deadline_exceeded')), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function delay(timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
}
