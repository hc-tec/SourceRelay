import { createHash } from 'node:crypto';
import { BILIBILI_DANMAKU_STRATEGY_ID } from '@intelligence/collector-contracts';
import type { BilibiliDanmakuInteractionResult } from '@intelligence/collector-contracts';
import type { BilibiliDanmakuDomSnapshot, BilibiliDanmakuListRow } from '../../collector-extension/src/shared/bilibili-danmaku-capture';
import type {
  BilibiliDanmakuNavigationAction,
  BilibiliDanmakuRunRecord,
  BilibiliDanmakuTerminalReason
} from './bilibili-danmaku-contract';
import { BILIBILI_DANMAKU_MAX_SCROLL_WINDOWS } from './bilibili-danmaku-contract';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createBilibiliDanmakuRunRecord(input: {
  runId: string;
  collectorVersion: string;
  canonicalVideoUrl: string;
  bvid: string;
  startedAt: string;
  completedAt: string;
  state: BilibiliDanmakuRunRecord['state'];
  errorCode: string | null;
  navigation: BilibiliDanmakuNavigationAction;
  interactions: BilibiliDanmakuInteractionResult[];
  dom: BilibiliDanmakuDomSnapshot | null;
  rows: BilibiliDanmakuListRow[];
  terminalReason: BilibiliDanmakuTerminalReason;
  targetTabSelection: BilibiliDanmakuRunRecord['safeguards']['targetTabSelection'];
  targetPage: BilibiliDanmakuRunRecord['safeguards']['targetPage'];
}): BilibiliDanmakuRunRecord {
  const totalEstimate = input.dom?.listTotalEstimate ?? null;
  return {
    schemaVersion: 1,
    runId: input.runId,
    collectorVersion: input.collectorVersion,
    platform: 'bilibili',
    accountCategory: 'user_managed',
    pageRole: 'video_detail',
    targetUrlDigest: sha256(input.canonicalVideoUrl),
    bvid: input.bvid,
    strategyCandidate: {
      strategyId: BILIBILI_DANMAKU_STRATEGY_ID,
      version: '0.1.0',
      admissionEligible: false
    },
    state: input.state,
    errorCode: input.errorCode,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    navigation: { ...input.navigation },
    interactions: input.interactions.map((interaction) => ({
      actionId: interaction.actionId,
      action: interaction.action,
      browserInputAttempted: interaction.browserInputAttempted,
      completedAt: interaction.completedAt
    })),
    dom: input.dom ? structuredClone(input.dom) : null,
    rows: structuredClone(input.rows),
    coverage: {
      listOpened: input.interactions.some((interaction) => interaction.action === 'open_list'),
      windowsCaptured: input.interactions.filter((interaction) => interaction.action === 'scroll_list').length +
        (input.rows.length > 0 ? 1 : 0),
      uniqueRows: input.rows.length,
      totalEstimate,
      partial: input.terminalReason !== 'danmaku_ready',
      terminalReason: input.terminalReason
    },
    safeguards: {
      environment: 'local_user_controlled_collection_profile',
      browser: 'visible_playwright_chromium',
      acquisition: 'trusted_browser_input_plus_dom_only_mv3',
      requestHeaders: 'not_read',
      requestBody: 'not_read',
      cookiesAndTokens: 'not_read',
      networkQueryAndFragmentValues: 'discarded',
      browserCredentialData: 'not_collected',
      responseBodies: 'not_read',
      semanticActionDelivery: 'at_most_once',
      navigationCount: 1,
      maxScrollWindows: BILIBILI_DANMAKU_MAX_SCROLL_WINDOWS,
      targetTabSelection: input.targetTabSelection,
      targetPage: input.targetPage,
      admissionEligible: false
    }
  };
}
