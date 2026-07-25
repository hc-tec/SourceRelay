import { createHash } from 'node:crypto';
import type {
  BilibiliAccountProfileAction,
  BilibiliAccountProfileRunRecord,
  BilibiliAccountProfileSnapshot,
  BilibiliAccountProfileTerminalReason,
  BilibiliAccountProfileVisualEvidence
} from './bilibili-account-profile-contract';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Materialises profile capture evidence without erasing which browser lane
 * produced it. The legacy host runner keeps its existing inline record while
 * the direct extension adapter supplies the user-owned-browser safeguards.
 */
export function createBilibiliAccountProfileRunRecord(input: {
  runId: string;
  collectorVersion: string;
  canonicalProfileUrl: string;
  startedAt: string;
  completedAt: string;
  state: BilibiliAccountProfileRunRecord['state'];
  errorCode: string | null;
  snapshot: BilibiliAccountProfileSnapshot | null;
  visualEvidence: BilibiliAccountProfileVisualEvidence | null;
  actions: BilibiliAccountProfileAction[];
  terminalReason: BilibiliAccountProfileTerminalReason;
  safeguards?: BilibiliAccountProfileRunRecord['safeguards'];
}): BilibiliAccountProfileRunRecord {
  const snapshot = input.snapshot;
  return {
    schemaVersion: 1,
    runId: input.runId,
    collectorVersion: input.collectorVersion,
    platform: 'bilibili',
    accountCategory: 'user_managed',
    pageRole: 'account_profile',
    targetUrlDigest: sha256(input.canonicalProfileUrl),
    strategyCandidate: {
      strategyId: 'bilibili.account.profile.dom.v2',
      version: '0.1.0',
      admissionEligible: false
    },
    state: input.state,
    errorCode: input.errorCode,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    snapshot,
    visualEvidence: input.visualEvidence,
    actions: input.actions,
    coverage: {
      identityCaptured: Boolean(snapshot),
      avatarCaptured: Boolean(snapshot?.media.avatarUrl),
      bannerCaptured: Boolean(snapshot?.media.bannerUrl),
      badgeCount: snapshot?.badges.length ?? 0,
      publicFieldCount: snapshot?.publicFields.length ?? 0,
      announcementCaptured: Boolean(snapshot?.announcementText),
      chargeSectionCaptured: Boolean(snapshot?.chargeText),
      highlightCount: snapshot?.highlights.length ?? 0,
      terminalReason: input.terminalReason
    },
    safeguards: input.safeguards ?? {
      environment: 'local_user_controlled_collection_profile',
      browser: 'visible_playwright_chromium',
      acquisition: 'bounded_visible_account_dom',
      responseBody: 'not_read',
      requestHeaders: 'not_read',
      requestBody: 'not_read',
      cookiesAndTokens: 'not_read',
      queryAndFragmentValues: 'discarded',
      currentViewerIdentity: 'excluded',
      semanticActionDelivery: 'at_most_once',
      runDeadlineMs: 60_000,
      targetTabSelection: 'not_acquired',
      targetPage: 'not_acquired',
      admissionEligible: false
    }
  };
}
