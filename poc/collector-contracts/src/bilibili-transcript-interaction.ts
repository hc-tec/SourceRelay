import type { PageVisualEvidence } from './page-visual-evidence.js';

export const BILIBILI_TRANSCRIPT_CHINESE_SELECTION_SCHEMA_VERSION = 1 as const;
export const BILIBILI_TRANSCRIPT_CHINESE_SELECTION_MAX_TIMEOUT_MS = 15_000;

export type BilibiliTranscriptVideoUrlMode = 'strict_input' | 'observed_document';

export type BilibiliTranscriptInteractionStep =
  | 'reveal_player_controls'
  | 'open_caption_menu'
  | 'select_chinese_caption';

export type BilibiliTranscriptInteractionOutcome =
  | 'completed'
  | 'already_satisfied'
  | 'prerequisite_unmet'
  | 'postcondition_unmet';

export interface BilibiliTranscriptChineseSelectionRequest {
  schemaVersion: typeof BILIBILI_TRANSCRIPT_CHINESE_SELECTION_SCHEMA_VERSION;
  profileId: string;
  pageAlias: string;
  pageLeaseId: string;
  runId: string;
  expectedRecordVersion: number;
  expectedDocumentGeneration: number;
  actionId: string;
  canonicalVideoUrl: string;
  timeoutMs: number;
}

export interface BilibiliTranscriptInteractionStepResult {
  step: BilibiliTranscriptInteractionStep;
  attempted: boolean;
  outcome: BilibiliTranscriptInteractionOutcome;
}

export interface BilibiliTranscriptInteractionDomState {
  authenticationRequired: boolean;
  playerAreaPresent: boolean;
  captionControlAttached: boolean;
  captionControlVisuallyExposed: boolean;
  chineseOptionVisible: boolean;
  chineseOptionActive: boolean;
  subtitlePanelVisible: boolean;
}

export interface BilibiliTranscriptChineseSelectionResult {
  schemaVersion: typeof BILIBILI_TRANSCRIPT_CHINESE_SELECTION_SCHEMA_VERSION;
  pageAlias: string;
  actionId: string;
  recordVersion: number;
  documentGeneration: number;
  routeGeneration: number;
  completedAt: string;
  actions: readonly BilibiliTranscriptInteractionStepResult[];
  dom: BilibiliTranscriptInteractionDomState;
  visualEvidence: {
    baseline: PageVisualEvidence | null;
    final: PageVisualEvidence | null;
  };
}

function allowedObservedDocumentQuery(url: URL): boolean {
  if (!url.search) return true;
  const entries = [...url.searchParams.entries()];
  return entries.length === 1 &&
    entries[0]?.[0] === 'vd_source' &&
    /^[0-9a-f]{32}$/i.test(entries[0]?.[1] ?? '');
}

export function canonicalBilibiliTranscriptVideoUrl(
  value: string,
  mode: BilibiliTranscriptVideoUrlMode = 'strict_input'
): string | null {
  try {
    const url = new URL(value);
    const bvid = url.protocol === 'https:' && url.hostname === 'www.bilibili.com'
      ? url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/)?.[1] ?? null
      : null;
    if (
      !bvid ||
      url.username ||
      url.password ||
      url.hash ||
      (mode === 'strict_input' ? Boolean(url.search) : !allowedObservedDocumentQuery(url))
    ) return null;
    return 'https://www.bilibili.com/video/' + bvid;
  } catch {
    return null;
  }
}

export function isBilibiliTranscriptChineseSelectionRequest(
  value: unknown
): value is BilibiliTranscriptChineseSelectionRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<BilibiliTranscriptChineseSelectionRequest>;
  return candidate.schemaVersion === BILIBILI_TRANSCRIPT_CHINESE_SELECTION_SCHEMA_VERSION &&
    boundedIdentifier(candidate.profileId, 128) &&
    boundedIdentifier(candidate.pageAlias, 128) &&
    boundedIdentifier(candidate.pageLeaseId, 128) &&
    boundedIdentifier(candidate.runId, 128) &&
    Number.isSafeInteger(candidate.expectedRecordVersion) && Number(candidate.expectedRecordVersion) > 0 &&
    Number.isSafeInteger(candidate.expectedDocumentGeneration) && Number(candidate.expectedDocumentGeneration) > 0 &&
    typeof candidate.actionId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(candidate.actionId) &&
    typeof candidate.canonicalVideoUrl === 'string' &&
    canonicalBilibiliTranscriptVideoUrl(candidate.canonicalVideoUrl, 'strict_input') === candidate.canonicalVideoUrl &&
    Number.isSafeInteger(candidate.timeoutMs) &&
    Number(candidate.timeoutMs) >= 1_000 &&
    Number(candidate.timeoutMs) <= BILIBILI_TRANSCRIPT_CHINESE_SELECTION_MAX_TIMEOUT_MS;
}

function boundedIdentifier(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}
