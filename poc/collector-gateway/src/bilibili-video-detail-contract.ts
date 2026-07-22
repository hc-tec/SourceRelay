import type { StrategyBindingDiagnostics } from '@intelligence/collector-contracts';

export const BILIBILI_VIDEO_DETAIL_MAX_TAGS = 20;

export interface BilibiliVideoDetailInput {
  canonicalVideoUrl: string;
}

export interface BilibiliVideoDetailCreator {
  displayName: string | null;
  publicAccountId: string | null;
}

/**
 * This is deliberately a positive-observation vocabulary. `indeterminate`
 * does not mean public or playable: it only says that this bounded first-screen
 * projection saw no supported, visible access gate.
 */
export type BilibiliVideoDetailAccessStatus =
  | 'charge_exclusive_trial'
  | 'login_required'
  | 'indeterminate';

export interface BilibiliVideoDetailDomSnapshot {
  bvid: string | null;
  title: string | null;
  metadataVisibleText: string | null;
  description: string | null;
  creator: BilibiliVideoDetailCreator | null;
  tagTexts: string[];
  episodeSummaryText: string | null;
  titleVisible: boolean;
  playerVisible: boolean;
  chargeExclusiveTrialVisible: boolean;
  loginOverlayVisible: boolean;
  risk: {
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

/**
 * One public, first-rendered video-detail projection.  There is deliberately
 * no player response, subtitle document, comment, recommendation, URL query,
 * or arbitrary page field in this contract.
 */
export interface BilibiliVideoDetailProjection {
  schemaVersion: 2;
  bvid: string;
  title: string;
  metadataVisibleText: string | null;
  description: string | null;
  creator: BilibiliVideoDetailCreator | null;
  tagTexts: string[];
  episodeSummaryText: string | null;
  titleVisible: true;
  playerVisible: true;
  accessStatus: BilibiliVideoDetailAccessStatus;
  loginOverlayVisible: boolean;
  risk: BilibiliVideoDetailDomSnapshot['risk'];
  capturedAt: string;
}

export interface BilibiliVideoDetailVisualEvidence {
  phase: 'baseline';
  actionId: string;
  evidenceId: string;
  capturedAt: string;
  viewport: {
    cssWidth: number;
    cssHeight: number;
    devicePixelRatio: number;
    scrollX: number;
    scrollY: number;
  };
  screenshot: {
    fileName: string;
    byteLength: number;
    sha256: string;
  };
}

export interface BilibiliVideoDetailAction {
  actionId: string;
  kind: 'navigation';
  intent: 'Open the canonical public Bilibili video page exactly once.';
  attempted: boolean;
  attemptCount: 0 | 1;
  outcome: 'completed' | 'prerequisite_unmet' | 'postcondition_unmet' | 'risk_stopped' | 'failed';
  errorCode: string | null;
}

export type BilibiliVideoDetailTerminalReason =
  | 'detail_ready'
  | 'verification_required'
  | 'rate_limited'
  | 'source_unavailable'
  | 'dom_projection_failed'
  | 'document_context_changed'
  | 'run_deadline_exceeded';

export interface BilibiliVideoDetailRunRecord {
  schemaVersion: 2;
  runId: string;
  collectorVersion: string;
  platform: 'bilibili';
  accountCategory: 'user_managed';
  pageRole: 'video_detail';
  targetUrlDigest: string;
  bvid: string;
  strategyCandidate: {
    strategyId: 'bilibili.video.detail.dom.v2';
    version: '0.4.0';
    admissionEligible: false;
  };
  state: 'completed' | 'partial' | 'failed';
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  detail: BilibiliVideoDetailProjection | null;
  visualEvidence: BilibiliVideoDetailVisualEvidence | null;
  /**
   * Failure-only, de-sensitised extension lifecycle evidence.  It intentionally
   * excludes document IDs, URLs, page text, request metadata and credentials.
   */
  bindingDiagnostics?: StrategyBindingDiagnostics;
  actions: BilibiliVideoDetailAction[];
  coverage: {
    capturedDetails: number;
    titleCaptured: boolean;
    metadataCaptured: boolean;
    descriptionCaptured: boolean;
    creatorCaptured: boolean;
    tagCount: number;
    episodeSummaryCaptured: boolean;
    accessStatus: BilibiliVideoDetailAccessStatus | null;
    loginOverlayVisible: boolean;
    terminalReason: BilibiliVideoDetailTerminalReason;
  };
  safeguards: {
    environment: 'local_user_controlled_collection_profile';
    browser: 'visible_playwright_chromium';
    acquisition: 'trusted_navigation_plus_bounded_dom_projection';
    requestHeaders: 'not_read';
    requestBody: 'not_read';
    cookiesAndTokens: 'not_read';
    networkQueryAndFragmentValues: 'not_read';
    responseBodies: 'not_read';
    subtitle: 'excluded_separate_capability';
    multipart: 'summary_only_separate_catalog_capability';
    discussion: 'excluded_separate_capability';
    recommendations: 'excluded';
    semanticActionDelivery: 'at_most_once';
    runDeadlineMs: 60_000;
    targetTabSelection:
      | 'reused_matching_managed_tab'
      | 'reused_retained_managed_tab'
      | 'created_new_managed_tab'
      | 'not_acquired';
    targetPage: 'retained_after_run' | 'quarantined_on_uncertain_outcome' | 'not_acquired';
    admissionEligible: false;
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean && clean.length <= maximum && !/[\u0000-\u001f\u007f]/.test(clean) ? clean : null;
}

function stableBvid(value: unknown): string | null {
  return typeof value === 'string' && /^BV[0-9A-Za-z]{10}$/.test(value) ? value : null;
}

function stableAccountId(value: unknown): string | null {
  return typeof value === 'string' && /^\d{1,20}$/.test(value) && value !== '0' ? value : null;
}

function accessStatus(dom: BilibiliVideoDetailDomSnapshot): BilibiliVideoDetailAccessStatus {
  if (dom.loginOverlayVisible) return 'login_required';
  if (dom.chargeExclusiveTrialVisible) return 'charge_exclusive_trial';
  return 'indeterminate';
}

export function canonicalBilibiliVideoDetailUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const bvid = url.protocol === 'https:' && url.hostname === 'www.bilibili.com'
      ? url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/)?.[1] ?? null
      : null;
    if (!bvid || url.username || url.password || url.search || url.hash) return null;
    return `https://www.bilibili.com/video/${bvid}`;
  } catch {
    return null;
  }
}

export function bilibiliVideoDetailInput(value: unknown): BilibiliVideoDetailInput {
  const candidate = record(value);
  if (!candidate || Object.keys(candidate).length !== 1 || typeof candidate.canonicalVideoUrl !== 'string') {
    throw new Error('bilibili_video_detail_input_invalid');
  }
  const canonicalVideoUrl = canonicalBilibiliVideoDetailUrl(candidate.canonicalVideoUrl);
  if (!canonicalVideoUrl) throw new Error('bilibili_video_detail_input_invalid');
  return { canonicalVideoUrl };
}

export function bvidFromCanonicalBilibiliVideoDetailUrl(canonicalVideoUrl: string): string {
  const canonical = canonicalBilibiliVideoDetailUrl(canonicalVideoUrl);
  const bvid = canonical?.match(/\/video\/(BV[0-9A-Za-z]{10})$/)?.[1] ?? null;
  if (!bvid) throw new Error('bilibili_video_detail_url_invalid');
  return bvid;
}

export function projectBilibiliVideoDetailDom(
  dom: BilibiliVideoDetailDomSnapshot,
  expectedBvid: string,
  capturedAt: string
): BilibiliVideoDetailProjection | null {
  if (
    dom.bvid !== expectedBvid ||
    !dom.titleVisible ||
    !dom.playerVisible ||
    typeof dom.chargeExclusiveTrialVisible !== 'boolean' ||
    typeof dom.loginOverlayVisible !== 'boolean' ||
    !dom.risk ||
    typeof dom.risk.verificationRequired !== 'boolean' ||
    typeof dom.risk.rateLimited !== 'boolean' ||
    typeof dom.risk.sourceUnavailable !== 'boolean'
  ) return null;
  const title = cleanText(dom.title, 500);
  if (!title) return null;
  const metadataVisibleText = dom.metadataVisibleText === null
    ? null
    : cleanText(dom.metadataVisibleText, 1_000);
  if (dom.metadataVisibleText !== null && !metadataVisibleText) return null;
  const description = dom.description === null ? null : cleanText(dom.description, 20_000);
  if (dom.description !== null && !description) return null;
  const episodeSummaryText = dom.episodeSummaryText === null ? null : cleanText(dom.episodeSummaryText, 500);
  if (dom.episodeSummaryText !== null && !episodeSummaryText) return null;
  if (!Array.isArray(dom.tagTexts) || dom.tagTexts.length > BILIBILI_VIDEO_DETAIL_MAX_TAGS) return null;
  const tagTexts = [...new Set(dom.tagTexts.map((value) => cleanText(value, 100)))];
  if (tagTexts.some((value) => value === null)) return null;
  let creator: BilibiliVideoDetailCreator | null = null;
  if (dom.creator !== null) {
    const candidate = record(dom.creator);
    if (!candidate) return null;
    const displayName = candidate.displayName === null ? null : cleanText(candidate.displayName, 200);
    const publicAccountId = candidate.publicAccountId === null ? null : stableAccountId(candidate.publicAccountId);
    if (
      (candidate.displayName !== null && !displayName) ||
      (candidate.publicAccountId !== null && !publicAccountId) ||
      (!displayName && !publicAccountId)
    ) return null;
    creator = { displayName, publicAccountId };
  }
  return {
    schemaVersion: 2,
    bvid: expectedBvid,
    title,
    metadataVisibleText,
    description,
    creator,
    tagTexts: tagTexts as string[],
    episodeSummaryText,
    titleVisible: true,
    playerVisible: true,
    accessStatus: accessStatus(dom),
    loginOverlayVisible: dom.loginOverlayVisible,
    risk: { ...dom.risk },
    capturedAt
  };
}
