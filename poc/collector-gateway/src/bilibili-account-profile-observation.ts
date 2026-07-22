import {
  BILIBILI_ACCOUNT_PROFILE_STRATEGY_ID,
  type StrategyObservationResult
} from '@intelligence/collector-contracts';
import type { RawBilibiliAccountProfileDom } from './bilibili-account-profile-contract';

export interface BilibiliAccountProfileStrategyDom extends RawBilibiliAccountProfileDom {
  profileHeaderVisible: boolean;
  loginOverlayVisible: boolean;
}

export interface BilibiliAccountProfileStrategyObservation {
  dom: BilibiliAccountProfileStrategyDom;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nullableText(value: unknown, maximum: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean || null;
}

function textList(value: unknown, maximumItems: number, maximumText: number): string[] | null {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  const entries: string[] = [];
  for (const item of value) {
    const text = nullableText(item, maximumText);
    if (text === undefined || text === null) return null;
    entries.push(text);
  }
  return entries;
}

function badgeImages(value: unknown): Array<{ url: string | null; label: string | null }> | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const entries: Array<{ url: string | null; label: string | null }> = [];
  for (const item of value) {
    const candidate = record(item);
    const url = nullableText(candidate?.url, 2_000);
    const label = nullableText(candidate?.label, 80);
    if (!candidate || url === undefined || label === undefined) return null;
    entries.push({ url, label });
  }
  return entries;
}

function fields(value: unknown): Array<{ label: string | null; value: string | null; href?: string | null }> | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const entries: Array<{ label: string | null; value: string | null; href?: string | null }> = [];
  for (const item of value) {
    const candidate = record(item);
    const label = nullableText(candidate?.label, 40);
    const fieldValue = nullableText(candidate?.value, 100);
    // Statistics intentionally omit `href`; only navigation fields carry an
    // optional link. JSON serialization drops an undefined property, so an
    // absent optional field must be treated as null rather than invalid.
    const href = candidate && Object.prototype.hasOwnProperty.call(candidate, 'href')
      ? nullableText(candidate.href, 2_000)
      : null;
    if (!candidate || label === undefined || fieldValue === undefined || href === undefined) return null;
    entries.push({ label, value: fieldValue, ...(href === null ? {} : { href }) });
  }
  return entries;
}

function highlights(value: unknown): Array<{ bvid: string | null; title: string | null }> | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const entries: Array<{ bvid: string | null; title: string | null }> = [];
  for (const item of value) {
    const candidate = record(item);
    const bvid = nullableText(candidate?.bvid, 32);
    const title = nullableText(candidate?.title, 500);
    if (!candidate || bvid === undefined || title === undefined) return null;
    entries.push({ bvid, title });
  }
  return entries;
}

function profileDom(value: unknown): BilibiliAccountProfileStrategyDom {
  const candidate = record(value);
  const risk = record(candidate?.risk);
  const stableAccountId = nullableText(candidate?.stableAccountId, 20);
  const displayName = nullableText(candidate?.displayName, 200);
  const visibleDescription = nullableText(candidate?.visibleDescription, 5_000);
  const avatarUrl = nullableText(candidate?.avatarUrl, 2_000);
  const bannerUrl = nullableText(candidate?.bannerUrl, 2_000);
  const textBadges = textList(candidate?.textBadges, 20, 80);
  const imageBadges = badgeImages(candidate?.imageBadges);
  const statistics = fields(candidate?.statistics);
  const navigation = fields(candidate?.navigation);
  const announcementText = nullableText(candidate?.announcementText, 20_000);
  const chargeText = nullableText(candidate?.chargeText, 2_000);
  const profileHighlights = highlights(candidate?.highlights);
  if (
    !candidate || stableAccountId === undefined || displayName === undefined || visibleDescription === undefined ||
    avatarUrl === undefined || bannerUrl === undefined || textBadges === null || imageBadges === null ||
    statistics === null || navigation === null || announcementText === undefined || chargeText === undefined ||
    profileHighlights === null || typeof candidate.profileHeaderVisible !== 'boolean' ||
    typeof candidate.loginOverlayVisible !== 'boolean' || !risk ||
    typeof risk.verificationRequired !== 'boolean' || typeof risk.rateLimited !== 'boolean' ||
    typeof risk.sourceUnavailable !== 'boolean'
  ) throw new Error('account_profile_observation_dom_invalid');
  return {
    stableAccountId,
    displayName,
    visibleDescription,
    avatarUrl,
    bannerUrl,
    textBadges,
    imageBadges,
    statistics,
    navigation,
    announcementText,
    chargeText,
    highlights: profileHighlights,
    profileHeaderVisible: candidate.profileHeaderVisible,
    loginOverlayVisible: candidate.loginOverlayVisible,
    risk: {
      verificationRequired: risk.verificationRequired,
      rateLimited: risk.rateLimited,
      sourceUnavailable: risk.sourceUnavailable
    }
  };
}

/**
 * The bridge accepts exactly the compiled account-profile DOM schema. Any
 * current-viewer, response, URL-query or arbitrary DOM field is discarded at
 * the boundary rather than becoming an accidental long-term archive field.
 */
export function bilibiliAccountProfileStrategyObservation(
  result: StrategyObservationResult
): BilibiliAccountProfileStrategyObservation {
  if (
    result.type !== 'collector_strategy_observation' ||
    result.strategyId !== BILIBILI_ACCOUNT_PROFILE_STRATEGY_ID ||
    result.payloadBytes > 128 * 1024
  ) throw new Error('account_profile_observation_strategy_result_invalid');
  const payload = record(result.payload);
  const allowedPayloadKeys = new Set(['schemaVersion', 'strategyId', 'stableAccountId', 'documentId', 'dom']);
  if (
    !payload ||
    Object.keys(payload).some((key) => !allowedPayloadKeys.has(key)) ||
    payload.schemaVersion !== 1 ||
    payload.strategyId !== BILIBILI_ACCOUNT_PROFILE_STRATEGY_ID ||
    typeof payload.stableAccountId !== 'string' || !/^\d{1,20}$/.test(payload.stableAccountId) ||
    typeof payload.documentId !== 'string' || payload.documentId.length === 0 || payload.documentId.length > 256
  ) throw new Error('account_profile_observation_payload_context_invalid');
  const dom = profileDom(payload.dom);
  if (dom.stableAccountId !== payload.stableAccountId) {
    throw new Error('account_profile_observation_identity_mismatch');
  }
  return { dom };
}
