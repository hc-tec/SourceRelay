import {
  BILIBILI_COLLECTION_SERIES_STRATEGY_ID,
  type BilibiliCollectionSeriesOverviewDomObservation,
  type BilibiliCollectionSeriesOverviewWorkItem,
  type BridgeJsonValue,
  type CollectorBindStrategyObserverCommand,
  type CollectorReadStrategyObservationCommand
} from '@intelligence/collector-contracts';
import {
  bindBilibiliCollectionSeriesObserver,
  readBilibiliCollectionSeriesObservation
} from './strategies/bilibili-collection-series-strategy';
import { clearStrategyBindingsForTab } from './strategy-binding-state';

interface OverviewResponseIdentity {
  listType: 'series' | 'season';
  stableSeriesId: string;
  title: string;
  declaredItemCount: number;
}

// The outer Bilibili work item may live for two minutes so that the MV3
// worker can survive its 30-second polling cadence.  A network arm is a
// narrower, one-document observation and is deliberately capped below the
// runtime's 60-second maximum.  Keep a margin for the time between computing
// this value and the arm validation/storage call.
const COLLECTION_OVERVIEW_NETWORK_ARM_MAX_LIFETIME_MS = 55_000;

/**
 * Convert the signed work lease into a bounded internal network-arm expiry.
 * An earlier work expiry remains authoritative; a long work lease is clipped
 * to the short-lived arm budget rather than weakening the runtime safety gate.
 */
export function boundedCollectionOverviewNetworkArmExpiry(
  workExpiresAt: string,
  now = Date.now()
): number {
  const workExpiry = Date.parse(workExpiresAt);
  if (!Number.isFinite(workExpiry) || !Number.isFinite(now)) return Number.NaN;
  return Math.min(workExpiry, now + COLLECTION_OVERVIEW_NETWORK_ARM_MAX_LIFETIME_MS);
}

/**
 * Arms precisely one already-reviewed collection-overview route before the
 * signed navigation. The bridge observes its exact next document only; it is
 * not a reusable response-capture API.
 */
export async function armBilibiliCollectionOverviewNetworkObservation(input: {
  tabId: number;
  item: BilibiliCollectionSeriesOverviewWorkItem;
}): Promise<void> {
  const binding: CollectorBindStrategyObserverCommand['binding'] = {
    schemaVersion: 1,
    profileId: input.item.operationId,
    pageAlias: 'direct-collection-overview',
    pageLeaseId: input.item.workId,
    expectedRecordVersion: 1,
    runId: input.item.operationId,
    observerBindingId: input.item.workId,
    expiresAt: new Date(boundedCollectionOverviewNetworkArmExpiry(input.item.expiresAt)).toISOString(),
    // The temporary response is sanitised by the bridge and then immediately
    // reduced to stable public list identities below. It never enters a
    // Gateway artifact as a raw body.
    maximumPayloadBytes: 524_288,
    documentBindingMode: 'next_navigation_only',
    strategyId: BILIBILI_COLLECTION_SERIES_STRATEGY_ID,
    target: {
      canonicalUrl: input.item.input.canonicalOverviewUrl,
      stableAccountId: input.item.input.stableAccountId
    },
    maximumResponseObservations: 1
  };
  await bindBilibiliCollectionSeriesObserver({
    type: 'collector_bind_strategy_observer',
    tabId: input.tabId,
    nextDocumentGeneration: 1,
    binding
  });
}

/** Read the one fixed response and return only DOM plus allowlisted identity metadata. */
export async function readBilibiliCollectionOverviewNetworkObservation(input: {
  tabId: number;
  item: BilibiliCollectionSeriesOverviewWorkItem;
  deadlineMs: number;
}): Promise<BilibiliCollectionSeriesOverviewDomObservation> {
  const request: CollectorReadStrategyObservationCommand['request'] = {
    schemaVersion: 1,
    profileId: input.item.operationId,
    pageAlias: 'direct-collection-overview',
    pageLeaseId: input.item.workId,
    expectedRecordVersion: 1,
    runId: input.item.operationId,
    observerBindingId: input.item.workId,
    strategyId: BILIBILI_COLLECTION_SERIES_STRATEGY_ID,
    deadlineMs: Math.max(1, Math.min(input.deadlineMs, 20_000))
  };
  const result = await readBilibiliCollectionSeriesObservation({
    type: 'collector_read_strategy_observation',
    tabId: input.tabId,
    documentGeneration: 1,
    routeGeneration: 0,
    request
  });
  const payload = asRecord(result.payload);
  const dom = asRecord(payload?.dom);
  if (!dom) throw new Error('collection_series_direct_network_dom_missing');
  const response = Array.isArray(payload?.responses) ? payload.responses[0] : null;
  const responseRecord = asRecord(response);
  const responseIdentities = responseRecord?.status === 'captured'
    ? projectOverviewResponseIdentities(responseRecord.body)
    : [];
  const itemValues = Array.isArray(dom.items) ? dom.items : [];
  const items = itemValues.slice(0, 50).flatMap((value) => {
    const item = asRecord(value);
    const listType: 'series' | 'season' | null = item?.listType === 'series' || item?.listType === 'season'
      ? item.listType
      : null;
    const title = cleanText(item?.title, 500);
    const declaredItemCount = nonNegativeInteger(item?.declaredItemCount);
    const previewBvids = Array.isArray(item?.visiblePreviewBvids)
      ? item!.visiblePreviewBvids.filter(isBvid).slice(0, 30)
      : [];
    if (!listType || !title) return [];
    const matches = responseIdentities.filter((candidate) =>
      candidate.listType === listType && candidate.title === title &&
      (declaredItemCount === null || candidate.declaredItemCount === declaredItemCount)
    );
    const stableSeriesId = matches.length === 1 ? matches[0]!.stableSeriesId : null;
    return [{ listType, stableSeriesId, title, declaredItemCount, previewBvids }];
  });
  const stableAccountId = typeof dom.stableAccountId === 'string' && /^\d{1,20}$/.test(dom.stableAccountId)
    ? dom.stableAccountId
    : null;
  const risk = asRisk(dom.risk);
  return {
    stableAccountId,
    listVisible: dom.listVisible === true || items.length > 0,
    items,
    network: {
      routeStatus: responseRecord?.status === 'captured'
        ? 'captured'
        : responseRecord?.status === 'payload_rejected'
          ? 'payload_rejected'
          : 'not_observed',
      httpStatus: nonNegativeHttpStatus(responseRecord?.httpStatus),
      responseIdentityCount: responseIdentities.length,
      domMatchedItemCount: items.filter((item) => item.stableSeriesId !== null).length
    },
    loginOverlayVisible: dom.loginOverlayVisible === true,
    risk
  };
}

/** Must run on every terminal path so a temporary body never outlives the work item. */
export async function clearBilibiliCollectionOverviewNetworkObservation(tabId: number): Promise<void> {
  await clearStrategyBindingsForTab(tabId);
}

function projectOverviewResponseIdentities(value: unknown): OverviewResponseIdentity[] {
  const root = asRecord(value);
  const data = asRecord(root?.data);
  const lists = asRecord(data?.items_lists) ?? data;
  if (!lists) return [];
  const identities: OverviewResponseIdentity[] = [];
  for (const [listType, values] of [
    ['series', lists.series_list],
    ['season', lists.seasons_list ?? lists.season_list]
  ] as const) {
    if (!Array.isArray(values)) continue;
    for (const rawValue of values.slice(0, 50)) {
      const raw = asRecord(rawValue);
      const meta = asRecord(raw?.meta) ?? raw;
      const stableSeriesId = positiveId(meta?.[listType === 'series' ? 'series_id' : 'season_id']);
      const title = cleanText(meta?.name ?? meta?.title, 500);
      const declaredItemCount = nonNegativeInteger(meta?.total);
      if (!stableSeriesId || !title || declaredItemCount === null) continue;
      identities.push({ listType, stableSeriesId, title, declaredItemCount });
      if (identities.length >= 50) return identities;
    }
  }
  return identities;
}

function asRecord(value: unknown): Record<string, BridgeJsonValue> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, BridgeJsonValue>
    : null;
}

function asRisk(value: unknown): BilibiliCollectionSeriesOverviewDomObservation['risk'] {
  const risk = asRecord(value);
  return {
    verificationRequired: risk?.verificationRequired === true,
    rateLimited: risk?.rateLimited === true,
    sourceUnavailable: risk?.sourceUnavailable === true
  };
}

function cleanText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text && text.length <= maximum && !/[\u0000-\u001f\u007f]/.test(text) ? text : null;
}

function positiveId(value: unknown): string | null {
  const text = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string'
      ? value
      : '';
  return /^\d{1,20}$/.test(text) && text !== '0' ? text : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function nonNegativeHttpStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 599 ? value : null;
}

function isBvid(value: unknown): value is string {
  return typeof value === 'string' && /^BV[0-9A-Za-z]{10}$/.test(value);
}
