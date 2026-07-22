import {
  bilibiliAccountProfileIdFromUrl,
  canonicalBilibiliAccountProfileUrl
} from '@intelligence/collector-contracts';
import {
  safeBilibiliPublicImageUrl
} from './bilibili-account-archive-contract';

export interface BilibiliAccountProfileInput {
  canonicalProfileUrl: string;
}

export interface BilibiliAccountProfileBadge {
  kind: 'text' | 'image';
  label: string | null;
  imageUrl: string | null;
}

export interface BilibiliAccountProfilePublicField {
  section: 'statistics' | 'navigation';
  label: string;
  value: string | null;
  canonicalUrl: string | null;
}

export interface BilibiliAccountProfileHighlight {
  bvid: string;
  canonicalUrl: string;
  title: string;
  position: number;
}

export interface BilibiliAccountProfileSnapshot {
  schemaVersion: 1;
  stableAccountId: string;
  canonicalProfileUrl: string;
  displayName: string;
  visibleDescription: string | null;
  media: {
    avatarUrl: string | null;
    bannerUrl: string | null;
  };
  badges: BilibiliAccountProfileBadge[];
  publicFields: BilibiliAccountProfilePublicField[];
  announcementText: string | null;
  chargeText: string | null;
  highlights: BilibiliAccountProfileHighlight[];
  domEvidence: {
    pageIdentityMatched: boolean;
    displayNameVisible: boolean;
    accountHeaderLocated: boolean;
    currentViewerHeaderExcluded: true;
  };
  capturedAt: string;
}

export interface BilibiliAccountProfileAction {
  actionId: 'open_account_profile';
  intent: string;
  attempted: boolean;
  attemptCount: 0 | 1;
  outcome: 'completed' | 'postcondition_unmet' | 'risk_stopped' | 'failed';
  errorCode: string | null;
}

export interface BilibiliAccountProfileVisualEvidence {
  phase: 'baseline';
  actionId: 'open_account_profile';
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

export type BilibiliAccountProfileTerminalReason =
  | 'profile_captured'
  | 'authentication_required'
  | 'verification_required'
  | 'rate_limited'
  | 'risk_controlled'
  | 'context_changed'
  | 'run_deadline_exceeded'
  | 'dom_projection_failed'
  | 'source_unavailable';

export interface BilibiliAccountProfileRunRecord {
  schemaVersion: 1;
  runId: string;
  collectorVersion: string;
  platform: 'bilibili';
  accountCategory: 'user_managed';
  pageRole: 'account_profile';
  targetUrlDigest: string;
  strategyCandidate: {
    strategyId: 'bilibili.account.profile.dom.v2';
    version: '0.1.0';
    admissionEligible: false;
  };
  state: 'completed' | 'partial' | 'failed';
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  snapshot: BilibiliAccountProfileSnapshot | null;
  visualEvidence: BilibiliAccountProfileVisualEvidence | null;
  actions: BilibiliAccountProfileAction[];
  coverage: {
    identityCaptured: boolean;
    avatarCaptured: boolean;
    bannerCaptured: boolean;
    badgeCount: number;
    publicFieldCount: number;
    announcementCaptured: boolean;
    chargeSectionCaptured: boolean;
    highlightCount: number;
    terminalReason: BilibiliAccountProfileTerminalReason;
  };
  safeguards: {
    environment: 'local_user_controlled_collection_profile';
    browser: 'visible_playwright_chromium';
    acquisition: 'bounded_visible_account_dom';
    responseBody: 'not_read';
    requestHeaders: 'not_read';
    requestBody: 'not_read';
    cookiesAndTokens: 'not_read';
    queryAndFragmentValues: 'discarded';
    currentViewerIdentity: 'excluded';
    semanticActionDelivery: 'at_most_once';
    runDeadlineMs: 60_000;
    targetTabSelection: 'reused_matching_managed_tab' | 'reused_retained_managed_tab' | 'created_new_managed_tab' | 'not_acquired';
    targetPage: 'retained_after_run' | 'quarantined_on_uncertain_outcome' | 'not_acquired';
    admissionEligible: false;
  };
}

export interface RawBilibiliAccountProfileDom {
  stableAccountId?: unknown;
  displayName?: unknown;
  visibleDescription?: unknown;
  avatarUrl?: unknown;
  bannerUrl?: unknown;
  textBadges?: unknown;
  imageBadges?: unknown;
  statistics?: unknown;
  navigation?: unknown;
  announcementText?: unknown;
  chargeText?: unknown;
  highlights?: unknown;
  risk?: unknown;
}

export interface BilibiliAccountProfileDomRisk {
  verificationRequired: boolean;
  rateLimited: boolean;
  sourceUnavailable: boolean;
}

const STATISTIC_LABELS = new Set(['关注数', '粉丝数', '获赞数', '播放数']);
const NAVIGATION_LABELS = new Set(['主页', '动态', '投稿', '合集和系列']);
const BADGE_PATTERN = /(?:Lv\s*\d+|大会员|认证|官方|UP主)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > maximum || /[\u0000-\u001f\u007f]/.test(clean)) return null;
  return clean;
}

function nullableText(value: unknown, maximum: number): string | null {
  if (value === null || value === '') return null;
  return cleanText(value, maximum);
}

function canonicalNavigationUrl(value: unknown, accountId: string): string | null {
  if (typeof value !== 'string' || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'space.bilibili.com' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !new RegExp(`^/${accountId}(?:/dynamic|/upload(?:/(?:video|opus))?|/lists)?/?$`).test(url.pathname)
    ) return null;
    return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return null;
  }
}

function publicFields(
  raw: RawBilibiliAccountProfileDom,
  accountId: string
): BilibiliAccountProfilePublicField[] {
  const fields: BilibiliAccountProfilePublicField[] = [];
  const seen = new Set<string>();
  const add = (
    section: BilibiliAccountProfilePublicField['section'],
    source: unknown,
    labels: Set<string>
  ): void => {
    if (!Array.isArray(source)) return;
    for (const item of source.slice(0, 30)) {
      if (!isRecord(item)) continue;
      const label = cleanText(item.label, 40);
      if (!label || !labels.has(label) || seen.has(`${section}\n${label}`)) continue;
      const value = nullableText(item.value, 100);
      const canonicalUrl = section === 'navigation'
        ? canonicalNavigationUrl(item.href, accountId)
        : null;
      seen.add(`${section}\n${label}`);
      fields.push({ section, label, value, canonicalUrl });
    }
  };
  add('statistics', raw.statistics, STATISTIC_LABELS);
  add('navigation', raw.navigation, NAVIGATION_LABELS);
  return fields;
}

function profileBadges(raw: RawBilibiliAccountProfileDom): BilibiliAccountProfileBadge[] {
  const badges: BilibiliAccountProfileBadge[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.textBadges)) {
    for (const value of raw.textBadges.slice(0, 20)) {
      const label = cleanText(value, 80);
      if (!label || !BADGE_PATTERN.test(label)) continue;
      const key = `text\n${label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      badges.push({ kind: 'text', label, imageUrl: null });
    }
  }
  if (Array.isArray(raw.imageBadges)) {
    for (const value of raw.imageBadges.slice(0, 20)) {
      if (!isRecord(value)) continue;
      const imageUrl = safeBilibiliPublicImageUrl(value.url);
      const label = nullableText(value.label, 80);
      if (!imageUrl) continue;
      const key = `image\n${imageUrl}`;
      if (seen.has(key)) continue;
      seen.add(key);
      badges.push({ kind: 'image', label, imageUrl });
    }
  }
  return badges.slice(0, 20);
}

function profileHighlights(raw: RawBilibiliAccountProfileDom): BilibiliAccountProfileHighlight[] {
  if (!Array.isArray(raw.highlights)) return [];
  const highlights: BilibiliAccountProfileHighlight[] = [];
  const seen = new Set<string>();
  for (const item of raw.highlights.slice(0, 30)) {
    if (!isRecord(item)) continue;
    const bvid = typeof item.bvid === 'string' && /^BV[0-9A-Za-z]{10}$/.test(item.bvid)
      ? item.bvid
      : null;
    const title = cleanText(item.title, 500);
    if (!bvid || !title || seen.has(bvid)) continue;
    seen.add(bvid);
    highlights.push({
      bvid,
      canonicalUrl: `https://www.bilibili.com/video/${bvid}`,
      title,
      position: highlights.length + 1
    });
  }
  return highlights;
}

export function bilibiliAccountProfileInput(value: unknown): BilibiliAccountProfileInput {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'canonicalProfileUrl')) {
    throw new Error('bilibili_account_profile_input_invalid');
  }
  const canonicalProfileUrl = typeof value.canonicalProfileUrl === 'string'
    ? canonicalBilibiliAccountProfileUrl(value.canonicalProfileUrl, 'strict_input')
    : null;
  if (!canonicalProfileUrl) throw new Error('bilibili_account_profile_input_invalid');
  return { canonicalProfileUrl };
}

export function projectBilibiliAccountProfileDom(
  value: unknown,
  canonicalProfileUrl: string,
  capturedAt: string
): BilibiliAccountProfileSnapshot | null {
  if (!isRecord(value)) return null;
  const raw = value as RawBilibiliAccountProfileDom;
  const accountId = bilibiliAccountProfileIdFromUrl(canonicalProfileUrl);
  if (!accountId) return null;
  const displayName = cleanText(raw.displayName, 200);
  if (String(raw.stableAccountId ?? '') !== accountId || !displayName) return null;
  const avatarUrl = raw.avatarUrl === null ? null : safeBilibiliPublicImageUrl(raw.avatarUrl);
  const bannerUrl = raw.bannerUrl === null ? null : safeBilibiliPublicImageUrl(raw.bannerUrl);
  if ((raw.avatarUrl && !avatarUrl) || (raw.bannerUrl && !bannerUrl)) return null;
  return {
    schemaVersion: 1,
    stableAccountId: accountId,
    canonicalProfileUrl,
    displayName,
    visibleDescription: nullableText(raw.visibleDescription, 5_000),
    media: { avatarUrl, bannerUrl },
    badges: profileBadges(raw),
    publicFields: publicFields(raw, accountId),
    announcementText: nullableText(raw.announcementText, 20_000),
    chargeText: nullableText(raw.chargeText, 2_000),
    highlights: profileHighlights(raw),
    domEvidence: {
      pageIdentityMatched: true,
      displayNameVisible: true,
      accountHeaderLocated: true,
      currentViewerHeaderExcluded: true
    },
    capturedAt
  };
}

export function bilibiliAccountProfileDomRisk(value: unknown): BilibiliAccountProfileDomRisk {
  if (!isRecord(value) || !isRecord(value.risk)) {
    return { verificationRequired: false, rateLimited: false, sourceUnavailable: false };
  }
  return {
    verificationRequired: value.risk.verificationRequired === true,
    rateLimited: value.risk.rateLimited === true,
    sourceUnavailable: value.risk.sourceUnavailable === true
  };
}

export function safeBilibiliAccountProfileErrorCode(value: unknown): string {
  const code = value instanceof Error ? value.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'bilibili_account_profile_failed';
}
