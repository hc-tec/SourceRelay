import { createHash } from 'node:crypto';
import {
  BILIBILI_TRANSCRIPT_STRATEGY_ID,
  type BilibiliTranscriptChineseSelectionResult
} from '@intelligence/collector-contracts';
import type {
  BilibiliTranscriptInteractionAction,
  BilibiliTranscriptNavigationAction,
  BilibiliTranscriptRunRecord,
  BilibiliTranscriptTerminalReason
} from './bilibili-transcript-contract';
import type {
  BilibiliTranscriptDirectoryProjection,
  BilibiliTranscriptDocumentProjection
} from '../../collector-extension/src/shared/transcript-capture';
import type { BilibiliTranscriptResponseSource } from './bilibili-transcript-contract';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createBilibiliTranscriptRunRecord(input: {
  runId: string;
  collectorVersion: string;
  canonicalVideoUrl: string;
  bvid: string;
  startedAt: string;
  completedAt: string;
  state: BilibiliTranscriptRunRecord['state'];
  errorCode: string | null;
  navigation: BilibiliTranscriptNavigationAction;
  pageRecovery: BilibiliTranscriptRunRecord['pageRecovery'];
  interaction: BilibiliTranscriptChineseSelectionResult | null;
  trackDirectory: BilibiliTranscriptDirectoryProjection | null;
  transcriptDocument: BilibiliTranscriptDocumentProjection | null;
  sources: BilibiliTranscriptResponseSource[];
  terminalReason: BilibiliTranscriptTerminalReason;
  targetTabSelection: BilibiliTranscriptRunRecord['safeguards']['targetTabSelection'];
  targetPage: BilibiliTranscriptRunRecord['safeguards']['targetPage'];
}): BilibiliTranscriptRunRecord {
  const interactionActions: BilibiliTranscriptInteractionAction[] = input.interaction
    ? input.interaction.actions.map((action) => ({
      actionId: input.interaction!.actionId,
      kind: 'trusted_interaction',
      step: action.step,
      intent: interactionIntent(action.step),
      attempted: action.attempted,
      outcome: action.outcome
    }))
    : [];
  const document = input.transcriptDocument;
  return {
    schemaVersion: 1,
    runId: input.runId,
    collectorVersion: input.collectorVersion,
    platform: 'bilibili',
    accountCategory: 'user_managed',
    pageRole: 'video_detail',
    targetUrlDigest: sha256(input.canonicalVideoUrl),
    bvid: input.bvid,
    strategyCandidate: {
      strategyId: BILIBILI_TRANSCRIPT_STRATEGY_ID,
      version: '0.1.0',
      admissionEligible: false
    },
    state: input.state,
    errorCode: input.errorCode,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    navigation: { ...input.navigation },
    pageRecovery: { ...input.pageRecovery },
    interaction: {
      actionId: input.interaction?.actionId ?? null,
      actions: interactionActions,
      dom: input.interaction ? { ...input.interaction.dom } : null,
      visualEvidence: input.interaction ? {
        baseline: input.interaction.visualEvidence.baseline,
        final: input.interaction.visualEvidence.final
      } : null
    },
    trackDirectory: input.trackDirectory ? structuredClone(input.trackDirectory) : null,
    transcriptDocument: document ? structuredClone(document) : null,
    sources: input.sources.map((source) => ({ ...source })),
    coverage: {
      trackDirectoryCaptured: input.trackDirectory !== null,
      transcriptDocumentCaptured: document !== null,
      language: document?.language ?? input.trackDirectory?.language ?? null,
      segmentCount: document?.storedSegmentCount ?? 0,
      transcriptPartial: document?.partial ?? true,
      terminalReason: input.terminalReason
    },
    safeguards: {
      environment: 'local_user_controlled_collection_profile',
      browser: 'visible_playwright_chromium',
      acquisition: 'trusted_browser_input_plus_exact_mv3_response_projection',
      requestHeaders: 'not_read',
      requestBody: 'not_read',
      cookiesAndTokens: 'not_read',
      networkQueryAndFragmentValues: 'discarded',
      browserCredentialData: 'not_collected',
      responseBodies: 'bounded_public_transcript_projection_only',
      semanticActionDelivery: 'at_most_once',
      navigationCount: input.pageRecovery.attempted ? 2 : 1,
      refreshLimit: 1,
      targetTabSelection: input.targetTabSelection,
      targetPage: input.targetPage,
      admissionEligible: false
    }
  };
}

function interactionIntent(step: BilibiliTranscriptInteractionAction['step']): string {
  if (step === 'reveal_player_controls') return 'Reveal the visible Bilibili player controls once.';
  if (step === 'open_caption_menu') return 'Open the visible Bilibili caption menu once.';
  return 'Select the visible Chinese caption option once.';
}
