import { nativeSearchPlatform } from '../shared/native-search';
import {
  NETWORK_CAPTURE_MAX_PER_PAGE,
  sanitiseNetworkCaptureObservation,
  validateNetworkCaptureRouteIds,
  type NetworkCaptureObservation,
  type NetworkCaptureRouteId
} from '../shared/network-capture';
import { isSupportedPlatform, type SupportedPlatform } from '../shared/collection-contracts';
import { canonicalBilibiliVideoUrl, type BilibiliVideoUrlMode } from '../shared/bilibili-video-url';

const MAXIMUM_ARM_LIFETIME_MS = 60_000;

export type NetworkCaptureArmPurpose = 'formal_collection' | 'transcript_validation';

export interface NetworkCaptureArm {
  platform: SupportedPlatform;
  purpose: NetworkCaptureArmPurpose;
  runId: string;
  navigationUrlDigest: string;
  routeIds: readonly NetworkCaptureRouteId[];
  documentId?: string;
  expiresAt: number;
}

export interface BoundNetworkCaptureArm extends NetworkCaptureArm {
  documentId: string;
}

export function networkCaptureStorageKey(tabId: number): string {
  return `collector.network-captures.${tabId}`;
}

export function networkCaptureArmStorageKey(tabId: number): string {
  return `collector.network-capture-arm.${tabId}`;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonicalCapturePageUrl(
  value: string,
  platform: SupportedPlatform,
  purpose: NetworkCaptureArmPurpose,
  bilibiliVideoMode: BilibiliVideoUrlMode = 'strict_input'
): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
    if (purpose === 'transcript_validation') {
      return platform === 'bilibili' ? canonicalBilibiliVideoUrl(value, bilibiliVideoMode) : null;
    }
    return nativeSearchPlatform(url) === platform ? url.href : null;
  } catch {
    return null;
  }
}

function routeAdmissionForPurpose(purpose: NetworkCaptureArmPurpose): 'production' | 'research_validation' {
  return purpose === 'formal_collection' ? 'production' : 'research_validation';
}

export async function armNetworkCapture(input: {
  tabId: number;
  platform: SupportedPlatform;
  purpose: NetworkCaptureArmPurpose;
  runId: string;
  navigationUrl: string;
  routeIds: readonly string[];
  expiresAt: number;
}): Promise<NetworkCaptureArm> {
  const canonicalUrl = canonicalCapturePageUrl(input.navigationUrl, input.platform, input.purpose);
  const routeIds = validateNetworkCaptureRouteIds(
    input.platform,
    input.routeIds,
    routeAdmissionForPurpose(input.purpose)
  );
  if (
    !Number.isInteger(input.tabId) ||
    input.tabId < 0 ||
    !/^[0-9a-f-]{36}$/i.test(input.runId) ||
    !canonicalUrl ||
    !routeIds ||
    !Number.isFinite(input.expiresAt) ||
    input.expiresAt <= Date.now() ||
    input.expiresAt > Date.now() + MAXIMUM_ARM_LIFETIME_MS
  ) throw new Error('network_capture_arm_invalid');
  const arm: NetworkCaptureArm = {
    platform: input.platform,
    purpose: input.purpose,
    runId: input.runId,
    navigationUrlDigest: await sha256(canonicalUrl),
    routeIds,
    expiresAt: input.expiresAt
  };
  await chrome.storage.session.remove(networkCaptureStorageKey(input.tabId));
  await chrome.storage.session.set({ [networkCaptureArmStorageKey(input.tabId)]: arm });
  return arm;
}

export async function getActiveNetworkCaptureArm(tabId: number): Promise<NetworkCaptureArm | null> {
  const key = networkCaptureArmStorageKey(tabId);
  const candidate = (await chrome.storage.session.get(key))[key] as Partial<NetworkCaptureArm> | undefined;
  const documentId = candidate?.documentId === undefined
    ? undefined
    : typeof candidate.documentId === 'string' && candidate.documentId.length > 0
      ? candidate.documentId
      : null;
  const purpose = candidate?.purpose === 'formal_collection' || candidate?.purpose === 'transcript_validation'
    ? candidate.purpose
    : null;
  const routeIds = purpose && isSupportedPlatform(candidate?.platform) && Array.isArray(candidate?.routeIds)
    ? validateNetworkCaptureRouteIds(candidate.platform, candidate.routeIds, routeAdmissionForPurpose(purpose))
    : null;
  if (
    candidate &&
    isSupportedPlatform(candidate.platform) &&
    purpose &&
    typeof candidate.runId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(candidate.runId) &&
    typeof candidate.navigationUrlDigest === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate.navigationUrlDigest) &&
    routeIds &&
    typeof candidate.expiresAt === 'number' &&
    Number.isFinite(candidate.expiresAt) &&
    candidate.expiresAt > Date.now() &&
    documentId !== null
  ) {
    return {
      platform: candidate.platform,
      purpose,
      runId: candidate.runId,
      navigationUrlDigest: candidate.navigationUrlDigest,
      routeIds,
      expiresAt: candidate.expiresAt,
      ...(documentId === undefined ? {} : { documentId })
    };
  }
  await clearNetworkCaptureState(tabId);
  return null;
}

async function activeArmForNavigation(tabId: number, senderUrl: string | undefined): Promise<NetworkCaptureArm | null> {
  if (!senderUrl) return null;
  const arm = await getActiveNetworkCaptureArm(tabId);
  if (!arm) return null;
  const canonicalUrl = canonicalCapturePageUrl(senderUrl, arm.platform, arm.purpose, 'observed_document');
  return canonicalUrl && (await sha256(canonicalUrl)) === arm.navigationUrlDigest ? arm : null;
}

export async function bindNetworkCaptureArmToDocument(
  tabId: number,
  senderUrl: string | undefined,
  documentId: string | undefined
): Promise<BoundNetworkCaptureArm | null> {
  if (!documentId) return null;
  const arm = await activeArmForNavigation(tabId, senderUrl);
  if (!arm || (arm.documentId !== undefined && arm.documentId !== documentId)) return null;
  const bound: BoundNetworkCaptureArm = { ...arm, documentId };
  await chrome.storage.session.set({ [networkCaptureArmStorageKey(tabId)]: bound });
  return bound;
}

export async function activeBoundNetworkCaptureArmForSender(
  tabId: number,
  senderUrl: string | undefined,
  documentId: string | undefined
): Promise<BoundNetworkCaptureArm | null> {
  if (!documentId) return null;
  const arm = await activeArmForNavigation(tabId, senderUrl);
  return arm?.documentId === documentId ? { ...arm, documentId } : null;
}

export async function storeNetworkCapture(
  tabId: number,
  candidate: unknown,
  arm: BoundNetworkCaptureArm
): Promise<{ stored: boolean }> {
  const observation = sanitiseNetworkCaptureObservation(candidate, arm.routeIds);
  if (!observation || observation.platform !== arm.platform) return { stored: false };
  const key = networkCaptureStorageKey(tabId);
  const current = (await chrome.storage.session.get(key))[key];
  const captures = Array.isArray(current)
    ? current
        .map((value) => sanitiseNetworkCaptureObservation(value, arm.routeIds))
        .filter((value): value is NetworkCaptureObservation => value !== null)
        .slice(0, NETWORK_CAPTURE_MAX_PER_PAGE)
    : [];
  if (captures.length >= NETWORK_CAPTURE_MAX_PER_PAGE) return { stored: false };
  captures.push(observation);
  await chrome.storage.session.set({ [key]: captures });
  return { stored: true };
}

export async function readNetworkCaptures(
  tabId: number,
  arm: NetworkCaptureArm
): Promise<NetworkCaptureObservation[]> {
  const value = (await chrome.storage.session.get(networkCaptureStorageKey(tabId)))[networkCaptureStorageKey(tabId)];
  return Array.isArray(value)
    ? value
        .map((candidate) => sanitiseNetworkCaptureObservation(candidate, arm.routeIds))
        .filter((candidate): candidate is NetworkCaptureObservation => candidate !== null)
        .slice(0, NETWORK_CAPTURE_MAX_PER_PAGE)
    : [];
}

export async function clearNetworkCaptureState(tabId: number): Promise<void> {
  await chrome.storage.session.remove([networkCaptureStorageKey(tabId), networkCaptureArmStorageKey(tabId)]);
}
