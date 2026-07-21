export const BILIBILI_ACCOUNT_VIDEO_INVENTORY_MAX_CARDS = 40;

export interface BilibiliAccountVideoInventoryInput {
  canonicalProfileUrl: string;
}

export interface BilibiliAccountVideoInventoryDomCard {
  bvid: string | null;
  title: string | null;
  visibleText: string | null;
  thumbnailUrl: string | null;
}

export interface BilibiliAccountVideoInventoryDomSnapshot {
  stableAccountId: string | null;
  videoListVisible: boolean;
  cards: BilibiliAccountVideoInventoryDomCard[];
  loginOverlayVisible: boolean;
  risk: {
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

export interface BilibiliAccountVideoInventoryItem {
  bvid: string;
  canonicalVideoUrl: string;
  title: string;
  visibleText: string;
  thumbnailUrl: string | null;
}

export interface BilibiliAccountVideoInventoryProjection {
  schemaVersion: 1;
  stableAccountId: string;
  items: BilibiliAccountVideoInventoryItem[];
  visibleCardCount: number;
  unresolvedCardCount: number;
  loginOverlayVisible: boolean;
  risk: BilibiliAccountVideoInventoryDomSnapshot['risk'];
  capturedAt: string;
}

export interface BilibiliAccountVideoInventoryVisualEvidence {
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

export interface BilibiliAccountVideoInventoryAction {
  actionId: string;
  kind: 'navigation';
  intent: 'Open the canonical public Bilibili account video inventory exactly once.';
  attempted: boolean;
  attemptCount: 0 | 1;
  outcome: 'completed' | 'prerequisite_unmet' | 'postcondition_unmet' | 'risk_stopped' | 'failed';
  errorCode: string | null;
}

export type BilibiliAccountVideoInventoryTerminalReason =
  | 'page_one_ready'
  | 'page_one_partial'
  | 'authentication_required'
  | 'verification_required'
  | 'rate_limited'
  | 'source_unavailable'
  | 'dom_projection_failed'
  | 'document_context_changed'
  | 'run_deadline_exceeded';

export interface BilibiliAccountVideoInventoryRunRecord {
  schemaVersion: 1;
  runId: string;
  collectorVersion: string;
  platform: 'bilibili';
  accountCategory: 'user_managed';
  pageRole: 'account_video_inventory';
  targetUrlDigest: string;
  stableAccountId: string;
  strategyCandidate: {
    strategyId: 'bilibili.account.video-inventory.dom.v1';
    version: '0.1.0';
    admissionEligible: false;
  };
  state: 'completed' | 'partial' | 'failed';
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  page: BilibiliAccountVideoInventoryProjection | null;
  visualEvidence: BilibiliAccountVideoInventoryVisualEvidence | null;
  actions: BilibiliAccountVideoInventoryAction[];
  coverage: {
    capturedPages: 0 | 1;
    visibleCardCount: number;
    capturedItems: number;
    unresolvedCardCount: number;
    loginOverlayVisible: boolean;
    terminalReason: BilibiliAccountVideoInventoryTerminalReason;
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
    pagination: 'excluded_separate_capability';
    sortAndFilter: 'excluded_separate_capability';
    articleAudioAndSeries: 'excluded_separate_capability';
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

function stableAccountId(value: unknown): string | null {
  return typeof value === 'string' && /^\d{1,20}$/.test(value) && value !== '0' ? value : null;
}

function stableBvid(value: unknown): string | null {
  return typeof value === 'string' && /^BV[0-9A-Za-z]{10}$/.test(value) ? value : null;
}

function safePublicImageUrl(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function canonicalBilibiliAccountProfileUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const mid = url.protocol === 'https:' && url.hostname === 'space.bilibili.com'
      ? url.pathname.match(/^\/(\d{1,20})\/?$/)?.[1] ?? null
      : null;
    if (!mid || url.username || url.password || url.search || url.hash) return null;
    return `https://space.bilibili.com/${mid}`;
  } catch {
    return null;
  }
}

export function stableAccountIdFromCanonicalBilibiliProfileUrl(canonicalProfileUrl: string): string {
  const canonical = canonicalBilibiliAccountProfileUrl(canonicalProfileUrl);
  const stableId = canonical?.match(/^https:\/\/space\.bilibili\.com\/(\d{1,20})$/)?.[1] ?? null;
  if (!stableId) throw new Error('bilibili_account_video_inventory_profile_invalid');
  return stableId;
}

export function accountVideoInventoryUrl(canonicalProfileUrl: string): string {
  const canonical = canonicalBilibiliAccountProfileUrl(canonicalProfileUrl);
  if (!canonical) throw new Error('bilibili_account_video_inventory_profile_invalid');
  return `${canonical}/upload/video`;
}

export function bilibiliAccountVideoInventoryInput(value: unknown): BilibiliAccountVideoInventoryInput {
  const candidate = record(value);
  if (!candidate || Object.keys(candidate).length !== 1 || typeof candidate.canonicalProfileUrl !== 'string') {
    throw new Error('bilibili_account_video_inventory_input_invalid');
  }
  const canonicalProfileUrl = canonicalBilibiliAccountProfileUrl(candidate.canonicalProfileUrl);
  if (!canonicalProfileUrl) throw new Error('bilibili_account_video_inventory_input_invalid');
  return { canonicalProfileUrl };
}

export function projectBilibiliAccountVideoInventoryDom(
  dom: BilibiliAccountVideoInventoryDomSnapshot,
  expectedStableAccountId: string,
  capturedAt: string
): BilibiliAccountVideoInventoryProjection | null {
  if (
    dom.stableAccountId !== expectedStableAccountId ||
    !dom.videoListVisible ||
    !Array.isArray(dom.cards) ||
    dom.cards.length > BILIBILI_ACCOUNT_VIDEO_INVENTORY_MAX_CARDS ||
    typeof dom.loginOverlayVisible !== 'boolean' ||
    !dom.risk ||
    typeof dom.risk.verificationRequired !== 'boolean' ||
    typeof dom.risk.rateLimited !== 'boolean' ||
    typeof dom.risk.sourceUnavailable !== 'boolean'
  ) return null;
  const items: BilibiliAccountVideoInventoryItem[] = [];
  const seenBvids = new Set<string>();
  let unresolvedCardCount = 0;
  for (const rawCard of dom.cards) {
    const card = record(rawCard);
    const bvid = stableBvid(card?.bvid);
    const title = cleanText(card?.title, 500);
    const visibleText = cleanText(card?.visibleText, 2_000);
    const thumbnailUrl = safePublicImageUrl(card?.thumbnailUrl);
    if (!bvid || !title || !visibleText || seenBvids.has(bvid) ||
      (card?.thumbnailUrl !== null && thumbnailUrl === null)) {
      unresolvedCardCount += 1;
      continue;
    }
    seenBvids.add(bvid);
    items.push({
      bvid,
      canonicalVideoUrl: `https://www.bilibili.com/video/${bvid}`,
      title,
      visibleText,
      thumbnailUrl
    });
  }
  if (items.length === 0) return null;
  return {
    schemaVersion: 1,
    stableAccountId: expectedStableAccountId,
    items,
    visibleCardCount: dom.cards.length,
    unresolvedCardCount,
    loginOverlayVisible: dom.loginOverlayVisible,
    risk: { ...dom.risk },
    capturedAt
  };
}
