import {
  BILIBILI_DANMAKU_STRATEGY_ID,
  type StrategyObservationResult
} from '@intelligence/collector-contracts';
import {
  deduplicateBilibiliDanmakuRows,
  projectBilibiliDanmakuDom,
  type BilibiliDanmakuDomSnapshot,
  type BilibiliDanmakuListRow
} from '../../collector-extension/src/shared/bilibili-danmaku-capture';

export interface BilibiliDanmakuStrategyObservation {
  dom: BilibiliDanmakuDomSnapshot;
  rows: BilibiliDanmakuListRow[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Revalidates the MV3 DOM-only payload. No binary response body, URL query,
 * request header or browser credential can cross this boundary.
 */
export function bilibiliDanmakuStrategyObservation(
  result: StrategyObservationResult,
  expectedBvid: string
): BilibiliDanmakuStrategyObservation {
  if (result.type !== 'collector_strategy_observation' ||
    result.strategyId !== BILIBILI_DANMAKU_STRATEGY_ID || result.payloadBytes > 192 * 1024) {
    throw new Error('bilibili_danmaku_observation_strategy_invalid');
  }
  const payload = result.payload;
  if (!isRecord(payload) || payload.schemaVersion !== 1 ||
    payload.strategyId !== BILIBILI_DANMAKU_STRATEGY_ID || payload.bvid !== expectedBvid) {
    throw new Error('bilibili_danmaku_observation_payload_invalid');
  }
  const dom = projectBilibiliDanmakuDom(payload.dom);
  if (!dom || dom.bvid !== expectedBvid) throw new Error('bilibili_danmaku_observation_dom_invalid');
  return { dom, rows: deduplicateBilibiliDanmakuRows(dom.listRows) };
}
