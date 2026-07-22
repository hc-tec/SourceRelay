import {
  BILIBILI_TRANSCRIPT_STRATEGY_ID,
  canonicalBilibiliTranscriptVideoUrl,
  type BilibiliTranscriptChineseSelectionResult,
  type BilibiliTranscriptInteractionOutcome,
  type BilibiliTranscriptInteractionStep
} from '@intelligence/collector-contracts';
import type {
  BilibiliTranscriptDirectoryProjection,
  BilibiliTranscriptDocumentProjection
} from '../../collector-extension/src/shared/transcript-capture';

export interface BilibiliTranscriptInput {
  canonicalVideoUrl: string;
}

export type BilibiliTranscriptTerminalReason =
  | 'transcript_ready'
  | 'authentication_required'
  | 'verification_required'
  | 'rate_limited'
  | 'source_unavailable'
  | 'caption_controls_unavailable'
  | 'caption_menu_unavailable'
  | 'chinese_caption_unavailable'
  | 'caption_selection_unconfirmed'
  | 'track_directory_missing'
  | 'subtitle_document_missing'
  | 'observer_not_bound'
  | 'document_context_changed'
  | 'run_deadline_exceeded'
  | 'response_projection_failed';

export interface BilibiliTranscriptNavigationAction {
  actionId: string;
  kind: 'navigation' | 'single_refresh';
  intent: string;
  attempted: boolean;
  attemptCount: 0 | 1;
  outcome: 'completed' | 'prerequisite_unmet' | 'postcondition_unmet' | 'failed';
  errorCode: string | null;
}

export interface BilibiliTranscriptInteractionAction {
  actionId: string;
  kind: 'trusted_interaction';
  step: BilibiliTranscriptInteractionStep;
  intent: string;
  attempted: boolean;
  outcome: BilibiliTranscriptInteractionOutcome;
}

export interface BilibiliTranscriptResponseSource {
  routeId: string;
  status: 'captured' | 'payload_rejected';
  origin: string | null;
  path: string | null;
  contentType: string;
  httpStatus: number;
  capturedAt: number;
  bodyBytes: number | null;
  bodySha256: string | null;
}

export interface BilibiliTranscriptRunRecord {
  schemaVersion: 1;
  runId: string;
  collectorVersion: string;
  platform: 'bilibili';
  accountCategory: 'user_managed';
  pageRole: 'video_detail';
  targetUrlDigest: string;
  bvid: string;
  strategyCandidate: {
    strategyId: typeof BILIBILI_TRANSCRIPT_STRATEGY_ID;
    version: '0.1.0';
    admissionEligible: false;
  };
  state: 'completed' | 'partial' | 'failed';
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  navigation: BilibiliTranscriptNavigationAction;
  pageRecovery: {
    actionId: string | null;
    attempted: boolean;
    reason: 'not_needed' | 'player_not_rendered_after_initial_navigation' | 'not_attempted_due_risk';
    outcome: 'not_needed' | 'recovered' | 'still_unavailable' | 'not_attempted';
    initialDom: BilibiliTranscriptChineseSelectionResult['dom'] | null;
    initialVisualEvidence: BilibiliTranscriptChineseSelectionResult['visualEvidence'] | null;
  };
  interaction: {
    actionId: string | null;
    actions: BilibiliTranscriptInteractionAction[];
    dom: BilibiliTranscriptChineseSelectionResult['dom'] | null;
    visualEvidence: BilibiliTranscriptChineseSelectionResult['visualEvidence'] | null;
  };
  trackDirectory: BilibiliTranscriptDirectoryProjection | null;
  transcriptDocument: BilibiliTranscriptDocumentProjection | null;
  sources: BilibiliTranscriptResponseSource[];
  coverage: {
    trackDirectoryCaptured: boolean;
    transcriptDocumentCaptured: boolean;
    language: string | null;
    segmentCount: number;
    transcriptPartial: boolean;
    terminalReason: BilibiliTranscriptTerminalReason;
  };
  safeguards: {
    environment: 'local_user_controlled_collection_profile';
    browser: 'visible_playwright_chromium';
    acquisition: 'trusted_browser_input_plus_exact_mv3_response_projection';
    requestHeaders: 'not_read';
    requestBody: 'not_read';
    cookiesAndTokens: 'not_read';
    networkQueryAndFragmentValues: 'discarded';
    browserCredentialData: 'not_collected';
    responseBodies: 'bounded_public_transcript_projection_only';
    semanticActionDelivery: 'at_most_once';
    navigationCount: 1 | 2;
    refreshLimit: 1;
    targetTabSelection: 'not_acquired' | 'created_new_managed_tab' | 'reused_matching_managed_tab' | 'reused_retained_managed_tab';
    targetPage: 'not_acquired' | 'retained_after_run' | 'quarantined_on_uncertain_outcome';
    admissionEligible: false;
  };
}

export function bilibiliTranscriptInput(value: unknown): BilibiliTranscriptInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('bilibili_transcript_input_invalid');
  }
  const candidate = value as Partial<BilibiliTranscriptInput>;
  if (Object.keys(candidate).length !== 1 || typeof candidate.canonicalVideoUrl !== 'string') {
    throw new Error('bilibili_transcript_input_invalid');
  }
  const canonicalVideoUrl = canonicalBilibiliTranscriptVideoUrl(candidate.canonicalVideoUrl, 'strict_input');
  if (!canonicalVideoUrl || canonicalVideoUrl !== candidate.canonicalVideoUrl) {
    throw new Error('bilibili_transcript_url_invalid');
  }
  return { canonicalVideoUrl };
}

export function bvidFromCanonicalBilibiliTranscriptUrl(canonicalVideoUrl: string): string {
  const bvid = canonicalBilibiliTranscriptVideoUrl(canonicalVideoUrl, 'strict_input')?.match(/\/video\/(BV[0-9A-Za-z]{10})$/)?.[1];
  if (!bvid) throw new Error('bilibili_transcript_url_invalid');
  return bvid;
}
