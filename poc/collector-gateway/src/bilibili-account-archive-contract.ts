export const BILIBILI_ACCOUNT_INFO_PATH = '/x/space/wbi/acc/info' as const;
export const BILIBILI_ACCOUNT_ARCHIVE_PATH = '/x/space/wbi/arc/search' as const;
export const BILIBILI_ACCOUNT_ARCHIVE_MAX_PAGES = 20;
export const BILIBILI_ACCOUNT_ARCHIVE_MAX_ITEMS_PER_PAGE = 50;

export interface BilibiliAccountArchiveInput {
  canonicalProfileUrl: string;
  maxPages: number;
}

export interface BilibiliAccountPublicField {
  label: string;
  value: string;
}

export interface BilibiliAccountProfileProjection {
  stableAccountId: string;
  canonicalProfileUrl: string;
  displayName: string;
  visibleDescription: string | null;
  avatarUrl: string | null;
  publicFields: BilibiliAccountPublicField[];
  domCrossCheck: {
    displayNameVisible: boolean;
    descriptionVisible: boolean | null;
    avatarVisible: boolean | null;
  };
}

export interface BilibiliAccountArchiveItem {
  bvid: string;
  canonicalUrl: string;
  title: string;
  durationText: string | null;
  coverUrl: string | null;
  visibleMetrics: {
    views: number | null;
    danmaku: number | null;
  };
  pageNumber: number;
  positionOnPage: number;
}

export interface BilibiliAccountArchivePageProjection {
  schemaVersion: 1;
  pageNumber: number;
  pageSize: number;
  declaredTotal: number;
  responseStatus: number;
  responseBodyBytes: number;
  responseBodySha256: string;
  queryKeyNames: string[];
  items: BilibiliAccountArchiveItem[];
  domCrossCheck: {
    activePageNumber: number | null;
    uniqueVideoIds: number;
    responseVideoIds: number;
    matchedVideoIds: number;
    responseOnlyVideoIds: number;
    domOnlyVideoIds: number;
    titleMatches: number;
    responseIdDigest: string;
    domIdDigest: string;
    exactIdentityMatch: boolean;
  };
  capturedAt: string;
}

export type BilibiliAccountArchiveActionOutcome =
  | 'completed'
  | 'prerequisite_unmet'
  | 'postcondition_unmet'
  | 'risk_stopped'
  | 'failed';

export interface BilibiliAccountArchiveAction {
  actionId: string;
  intent: string;
  attempted: boolean;
  attemptCount: 0 | 1;
  outcome: BilibiliAccountArchiveActionOutcome;
  errorCode: string | null;
  expectedPageNumber: number;
  observedPageNumber: number | null;
}

export type BilibiliAccountArchiveTerminalReason =
  | 'declared_terminal_reached'
  | 'budget_exhausted'
  | 'authentication_required'
  | 'verification_required'
  | 'rate_limited'
  | 'risk_controlled'
  | 'response_status_unavailable'
  | 'response_projection_failed'
  | 'dom_response_mismatch'
  | 'pagination_control_missing'
  | 'pagination_postcondition_unmet'
  | 'context_changed'
  | 'run_deadline_exceeded'
  | 'source_unavailable';

export interface BilibiliAccountArchiveRunRecord {
  schemaVersion: 1;
  runId: string;
  collectorVersion: string;
  platform: 'bilibili';
  accountCategory: 'user_managed';
  pageRole: 'account_upload_video';
  targetUrlDigest: string;
  strategyCandidate: {
    strategyId: 'bilibili.account.archive.response.v1';
    version: '1.0.0';
    admissionEligible: false;
  };
  state: 'completed' | 'partial' | 'failed';
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  account: BilibiliAccountProfileProjection | null;
  pages: BilibiliAccountArchivePageProjection[];
  actions: BilibiliAccountArchiveAction[];
  coverage: {
    declaredTotal: number | null;
    declaredPages: number | null;
    plannedMaximumPages: number;
    capturedPages: number;
    capturedItems: number;
    uniqueItems: number;
    duplicateItems: number;
    completeWithinDeclaredInventory: boolean;
    terminalReason: BilibiliAccountArchiveTerminalReason;
  };
  safeguards: {
    environment: 'local_user_controlled_collection_profile';
    browser: 'visible_playwright_chromium';
    acquisition: 'trusted_pagination_plus_visible_dom_plus_current_page_response_projection';
    requestHeaders: 'not_read';
    requestBody: 'not_read';
    cookiesAndTokens: 'not_read';
    queryAndFragmentValues: 'discarded';
    responseProjection: 'public_card_fields_allowlist';
    semanticActionDelivery: 'at_most_once';
    runDeadlineMs: 60_000;
    targetTabSelection: 'reused_matching_managed_tab' | 'created_new_managed_tab';
    targetPage: 'retained_after_run';
    admissionEligible: false;
  };
}

interface AccountInfoProjectionCandidate {
  stableAccountId: string;
  displayName: string;
  visibleDescription: string | null;
  avatarUrl: string | null;
}

interface ArchivePageProjectionCandidate {
  pageNumber: number;
  pageSize: number;
  declaredTotal: number;
  items: BilibiliAccountArchiveItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > maximum || /[\u0000-\u001f\u007f]/.test(clean)) return null;
  return clean;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function positiveInteger(value: unknown): number | null {
  const number = nonNegativeInteger(value);
  return number !== null && number > 0 ? number : null;
}

export function safeBilibiliPublicImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_000) return null;
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      url.username ||
      url.password ||
      !(url.hostname === 'hdslb.com' || url.hostname.endsWith('.hdslb.com'))
    ) return null;
    url.protocol = 'https:';
    const pathname = normaliseBilibiliPublicImagePathname(url.pathname);
    if (!pathname) return null;
    url.pathname = pathname;
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

export function normaliseBilibiliPublicImagePathname(value: string): string | null {
  if (
    typeof value !== 'string' ||
    value.length < 2 ||
    value.length > 2_000 ||
    !value.startsWith('/') ||
    /[\u0000-\u001f\u007f?#]/.test(value)
  ) return null;
  return value.replace(
    /(\.(?:jpe?g|png|gif|webp|avif))@[A-Za-z0-9_.!,~*-]{1,240}$/i,
    '$1'
  );
}

export function canonicalBilibiliProfileUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const match = url.hostname === 'space.bilibili.com' && url.pathname.match(
      /^\/(\d{1,20})(?:\/upload(?:\/video)?)?\/?$/
    );
    if (url.protocol !== 'https:' || !match || url.username || url.password || url.search || url.hash) return null;
    return `https://space.bilibili.com/${match[1]}`;
  } catch {
    return null;
  }
}

export function bilibiliAccountArchiveInput(value: unknown): BilibiliAccountArchiveInput {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'canonicalProfileUrl' && key !== 'maxPages')) {
    throw new Error('bilibili_account_archive_input_invalid');
  }
  const canonicalProfileUrl = typeof value.canonicalProfileUrl === 'string'
    ? canonicalBilibiliProfileUrl(value.canonicalProfileUrl)
    : null;
  const maxPages = value.maxPages === undefined ? BILIBILI_ACCOUNT_ARCHIVE_MAX_PAGES : value.maxPages;
  if (
    !canonicalProfileUrl ||
    typeof maxPages !== 'number' ||
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > BILIBILI_ACCOUNT_ARCHIVE_MAX_PAGES
  ) throw new Error('bilibili_account_archive_input_invalid');
  return { canonicalProfileUrl, maxPages };
}

export function stableAccountIdFromProfileUrl(canonicalProfileUrl: string): string {
  const canonical = canonicalBilibiliProfileUrl(canonicalProfileUrl);
  if (!canonical) throw new Error('bilibili_account_profile_url_invalid');
  return new URL(canonical).pathname.slice(1);
}

export function accountUploadVideoUrl(canonicalProfileUrl: string): string {
  return `${canonicalBilibiliProfileUrl(canonicalProfileUrl)}/upload/video`;
}

export function projectBilibiliAccountInfoResponse(
  value: unknown,
  expectedAccountId: string
): AccountInfoProjectionCandidate | null {
  if (!isRecord(value) || value.code !== 0 || !isRecord(value.data)) return null;
  const mid = String(value.data.mid ?? '');
  const displayName = cleanText(value.data.name, 200);
  const descriptionValue = value.data.sign === '' ? null : cleanText(value.data.sign, 2_000);
  const avatarUrl = value.data.face === '' ? null : safeBilibiliPublicImageUrl(value.data.face);
  if (mid !== expectedAccountId || !displayName || descriptionValue === undefined) return null;
  return {
    stableAccountId: mid,
    displayName,
    visibleDescription: descriptionValue,
    avatarUrl
  };
}

export function projectBilibiliArchivePageResponse(
  value: unknown,
  expectedAccountId: string,
  expectedPageNumber: number
): ArchivePageProjectionCandidate | null {
  if (!isRecord(value) || value.code !== 0 || !isRecord(value.data)) return null;
  const page = value.data.page;
  const list = value.data.list;
  if (!isRecord(page) || !isRecord(list) || !Array.isArray(list.vlist)) return null;
  const pageNumber = positiveInteger(page.pn);
  const pageSize = positiveInteger(page.ps);
  const declaredTotal = nonNegativeInteger(page.count);
  if (
    pageNumber !== expectedPageNumber ||
    pageSize === null ||
    pageSize > BILIBILI_ACCOUNT_ARCHIVE_MAX_ITEMS_PER_PAGE ||
    declaredTotal === null ||
    list.vlist.length > pageSize
  ) return null;

  const items: BilibiliAccountArchiveItem[] = [];
  const seen = new Set<string>();
  for (const [index, rawItem] of list.vlist.entries()) {
    if (!isRecord(rawItem)) return null;
    const bvid = typeof rawItem.bvid === 'string' && /^BV[0-9A-Za-z]{10}$/.test(rawItem.bvid)
      ? rawItem.bvid
      : null;
    const mid = String(rawItem.mid ?? '');
    const title = cleanText(rawItem.title, 500);
    const durationText = rawItem.length === '' ? null : cleanText(rawItem.length, 40);
    const coverUrl = rawItem.pic === '' ? null : safeBilibiliPublicImageUrl(rawItem.pic);
    const views = nonNegativeInteger(rawItem.play);
    const danmaku = nonNegativeInteger(rawItem.video_review);
    if (!bvid || mid !== expectedAccountId || !title || seen.has(bvid)) return null;
    seen.add(bvid);
    items.push({
      bvid,
      canonicalUrl: `https://www.bilibili.com/video/${bvid}`,
      title,
      durationText,
      coverUrl,
      visibleMetrics: { views, danmaku },
      pageNumber,
      positionOnPage: index + 1
    });
  }
  return { pageNumber, pageSize, declaredTotal, items };
}

export function safeBilibiliAccountArchiveErrorCode(value: unknown): string {
  const code = value instanceof Error ? value.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'bilibili_account_archive_failed';
}
