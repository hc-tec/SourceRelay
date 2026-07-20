import { createHash } from 'node:crypto';
import type {
  BilibiliDynamicAction,
  BilibiliDynamicCrossCheckDiagnostic,
  BilibiliDynamicPageProjection,
  BilibiliDynamicReservationOpusFieldDiagnostic,
  BilibiliDynamicResponseEvidence,
  BilibiliDynamicRunRecord,
  BilibiliDynamicTerminalReason,
  BilibiliDynamicVisualEvidence
} from './bilibili-dynamic-contract';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function counts<T extends string>(values: readonly T[]): Array<{ type: T; count: number }> {
  const result = new Map<T, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return [...result.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((left, right) => left.type.localeCompare(right.type, 'en'));
}

export function createBilibiliDynamicRunRecord(input: {
  runId: string;
  collectorVersion: string;
  targetUrl: string;
  stableAccountId: string;
  startedAt: string;
  completedAt: string;
  state: BilibiliDynamicRunRecord['state'];
  errorCode: string | null;
  pages: BilibiliDynamicPageProjection[];
  actions: BilibiliDynamicAction[];
  terminalReason: BilibiliDynamicTerminalReason;
  failedResponseEvidence: BilibiliDynamicResponseEvidence | null;
  crossCheckDiagnostic: BilibiliDynamicCrossCheckDiagnostic | null;
  reservationOpusFieldDiagnostic: BilibiliDynamicReservationOpusFieldDiagnostic | null;
  visualEvidence: BilibiliDynamicVisualEvidence | null;
  targetTabSelection: BilibiliDynamicRunRecord['safeguards']['targetTabSelection'];
  targetPage: BilibiliDynamicRunRecord['safeguards']['targetPage'];
}): BilibiliDynamicRunRecord {
  const allItems = input.pages.flatMap((page) => page.items);
  const uniqueItems = new Map(allItems.map((item) => [item.stableDynamicId, item]));
  const items = [...uniqueItems.values()];
  return {
    schemaVersion: 1,
    runId: input.runId,
    collectorVersion: input.collectorVersion,
    platform: 'bilibili',
    accountCategory: 'user_managed',
    pageRole: 'dynamic_inventory',
    targetUrlDigest: sha256(input.targetUrl),
    strategyCandidate: {
      strategyId: 'bilibili.dynamic.account-feed.response-dom.v1',
      version: '1.0.0',
      admissionEligible: false
    },
    state: input.state,
    errorCode: input.errorCode,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    stableAccountId: input.stableAccountId,
    failedResponseEvidence: input.failedResponseEvidence,
    crossCheckDiagnostic: input.crossCheckDiagnostic,
    reservationOpusFieldDiagnostic: input.reservationOpusFieldDiagnostic,
    visualEvidence: input.visualEvidence,
    pages: input.pages,
    actions: input.actions,
    coverage: {
      plannedMaximumPages: 1,
      capturedPages: input.pages.length,
      capturedItems: allItems.length,
      uniqueItems: items.length,
      duplicateItems: allItems.length - items.length,
      forwardedItems: items.filter((item) => item.forwardedSourceState !== 'not_forward').length,
      restrictedPlaceholderItems: items.filter((item) => item.accessState === 'restricted_placeholder').length,
      dynamicTypes: counts(items.map((item) => item.dynamicType)),
      majorTypes: counts(items.map((item) => item.majorType ?? 'none')),
      domCardKinds: counts(items.map((item) => item.card.kind)).map(({ type, count }) => ({ kind: type, count })),
      completeWithinAccountFeed: input.terminalReason === 'feed_terminal_reached',
      terminalReason: input.terminalReason
    },
    safeguards: {
      environment: 'local_user_controlled_collection_profile',
      browser: 'visible_playwright_chromium',
      acquisition: 'trusted_navigation_plus_dom_response_projection',
      requestHeaders: 'not_read',
      requestBody: 'not_read',
      cookiesAndTokens: 'not_read',
      networkQueryAndFragmentValues: 'discarded',
      cursorValue: 'used_in_memory_not_persisted',
      responseProjection: 'public_dynamic_identity_author_text_relation_and_metrics_allowlist',
      cardProjection: 'bounded_visible_text_links_and_public_media',
      restrictedContent: 'public_visible_placeholders_only_no_unlock_attempts',
      discussion: 'excluded_separate_capability',
      unknownResponseValues: 'not_persisted',
      semanticActionDelivery: 'at_most_once',
      runDeadlineMs: 60_000,
      targetTabSelection: input.targetTabSelection,
      targetPage: input.targetPage,
      admissionEligible: false
    }
  };
}
