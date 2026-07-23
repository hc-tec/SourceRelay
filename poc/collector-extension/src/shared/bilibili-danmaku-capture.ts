/**
 * Bilibili danmaku is intentionally DOM-first for the first product slice.
 * The currently observed `seg.so` responses are binary and have no reviewed
 * public projector, while the page exposes a bounded, human-visible list.
 * This module contains only the small, revalidated public projection shared
 * by the MV3 worker and the Gateway.
 */

export const BILIBILI_DANMAKU_DOM_SCHEMA_VERSION = 1 as const;
export const BILIBILI_DANMAKU_MAX_OVERLAY_ITEMS = 32 as const;
export const BILIBILI_DANMAKU_MAX_LIST_ROWS = 64 as const;
export const BILIBILI_DANMAKU_MAX_TEXT_LENGTH = 4_000 as const;

export interface BilibiliDanmakuOverlayItem {
  text: string;
  top: number | null;
  color: string | null;
  fontSize: number | null;
}

export interface BilibiliDanmakuListRow {
  index: number;
  time: string;
  content: string;
  sentAt: string;
}

export interface BilibiliDanmakuDomSnapshot {
  schemaVersion: typeof BILIBILI_DANMAKU_DOM_SCHEMA_VERSION;
  bvid: string | null;
  playerVisible: boolean;
  danmakuOverlayVisible: boolean;
  danmakuEnabled: boolean | null;
  overlayItems: BilibiliDanmakuOverlayItem[];
  listControlVisible: boolean;
  listOpen: boolean;
  listRows: BilibiliDanmakuListRow[];
  listTotalEstimate: number | null;
  listOffset: number | null;
  listContainerVisible: boolean;
  loginGateVisible: boolean;
  risk: {
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown, maximum: number = BILIBILI_DANMAKU_MAX_TEXT_LENGTH): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeColor(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value) ? value.toLowerCase() : null;
}

function listRow(value: unknown): BilibiliDanmakuListRow | null {
  if (!isRecord(value)) return null;
  const index = nonNegativeInteger(value.index);
  const time = cleanText(value.time, 40);
  const content = cleanText(value.content);
  const sentAt = cleanText(value.sentAt, 80);
  if (index === null || !time || !content || !sentAt) return null;
  return { index, time, content, sentAt };
}

function overlayItem(value: unknown): BilibiliDanmakuOverlayItem | null {
  if (!isRecord(value)) return null;
  const text = cleanText(value.text);
  if (!text) return null;
  const top = finiteNumber(value.top);
  const fontSize = finiteNumber(value.fontSize);
  return {
    text,
    top: top !== null && top >= 0 && top <= 10_000 ? top : null,
    color: safeColor(value.color),
    fontSize: fontSize !== null && fontSize >= 0 && fontSize <= 200 ? fontSize : null
  };
}

/**
 * Revalidates the bounded DOM payload at the Gateway boundary. It rejects
 * unknown shape and silently drops malformed rows, but never invents fields.
 */
export function projectBilibiliDanmakuDom(value: unknown): BilibiliDanmakuDomSnapshot | null {
  if (!isRecord(value) || value.schemaVersion !== BILIBILI_DANMAKU_DOM_SCHEMA_VERSION) return null;
  const bvid = typeof value.bvid === 'string' && /^BV[0-9A-Za-z]{10}$/.test(value.bvid)
    ? value.bvid
    : null;
  const overlayItems = Array.isArray(value.overlayItems)
    ? value.overlayItems.slice(0, BILIBILI_DANMAKU_MAX_OVERLAY_ITEMS)
      .map(overlayItem)
      .filter((item): item is BilibiliDanmakuOverlayItem => item !== null)
    : [];
  const listRows = Array.isArray(value.listRows)
    ? value.listRows.slice(0, BILIBILI_DANMAKU_MAX_LIST_ROWS)
      .map(listRow)
      .filter((row): row is BilibiliDanmakuListRow => row !== null)
    : [];
  const bool = (candidate: unknown): boolean => candidate === true;
  const optionalBool = (candidate: unknown): boolean | null =>
    typeof candidate === 'boolean' ? candidate : null;
  const listTotalEstimate = nonNegativeInteger(value.listTotalEstimate);
  const listOffset = finiteNumber(value.listOffset);
  const risk = isRecord(value.risk) ? value.risk : {};
  return {
    schemaVersion: BILIBILI_DANMAKU_DOM_SCHEMA_VERSION,
    bvid,
    playerVisible: bool(value.playerVisible),
    danmakuOverlayVisible: bool(value.danmakuOverlayVisible),
    danmakuEnabled: optionalBool(value.danmakuEnabled),
    overlayItems,
    listControlVisible: bool(value.listControlVisible),
    listOpen: bool(value.listOpen),
    listRows,
    listTotalEstimate,
    listOffset: listOffset !== null && listOffset >= 0 ? listOffset : null,
    listContainerVisible: bool(value.listContainerVisible),
    loginGateVisible: bool(value.loginGateVisible),
    risk: {
      verificationRequired: bool(risk.verificationRequired),
      rateLimited: bool(risk.rateLimited),
      sourceUnavailable: bool(risk.sourceUnavailable)
    }
  };
}

export function deduplicateBilibiliDanmakuRows(
  rows: readonly BilibiliDanmakuListRow[]
): BilibiliDanmakuListRow[] {
  const seen = new Set<number>();
  const result: BilibiliDanmakuListRow[] = [];
  for (const row of rows) {
    if (seen.has(row.index)) continue;
    seen.add(row.index);
    result.push(row);
  }
  return result;
}
