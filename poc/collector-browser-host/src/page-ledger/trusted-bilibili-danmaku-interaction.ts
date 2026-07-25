import type { Page } from 'playwright';
import {
  BrowserHostError,
  BILIBILI_DANMAKU_INTERACTION_ACTIONS,
  BILIBILI_DANMAKU_INTERACTION_MAX_TIMEOUT_MS,
  BILIBILI_DANMAKU_INTERACTION_SCHEMA_VERSION,
  BILIBILI_DANMAKU_LIST_SCROLL_DELTA,
  isBilibiliDanmakuInteractionAction,
  type BilibiliDanmakuInteractionAction,
  type BilibiliDanmakuInteractionBounds,
  type BilibiliDanmakuInteractionDomState,
  type BilibiliDanmakuInteractionRequest,
  type BilibiliDanmakuInteractionResult
} from '@intelligence/collector-contracts';
import { hostError } from '../host-errors.js';
import { touchRecord, transitionRecord, type ManagedPageRecord } from './page-record.js';
import { captureManagedPageVisualEvidence } from './page-visual-evidence.js';
import { matchesBilibiliVideoDiscussionPageIdentity } from './bilibili-video-discussion-page-identity.js';

const ACTION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;
const PROBE_INTERVAL_MS = 120;

export function validateTrustedBilibiliDanmakuInteractionRequest(
  request: BilibiliDanmakuInteractionRequest
): void {
  if (request.schemaVersion !== BILIBILI_DANMAKU_INTERACTION_SCHEMA_VERSION ||
    !isBilibiliDanmakuInteractionAction(request.action) ||
    !ACTION_ID_PATTERN.test(request.actionId) ||
    !BVID_PATTERN.test(request.bvid) ||
    !Number.isSafeInteger(request.expectedRecordVersion) || request.expectedRecordVersion < 1 ||
    !Number.isSafeInteger(request.expectedDocumentGeneration) || request.expectedDocumentGeneration < 1 ||
    !Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1_000 ||
    request.timeoutMs > BILIBILI_DANMAKU_INTERACTION_MAX_TIMEOUT_MS) {
    throw hostError({ code: 'bilibili_danmaku_interaction_schema_invalid', category: 'protocol', scope: 'action' });
  }
}

export async function executeTrustedBilibiliDanmakuInteraction(input: {
  record: ManagedPageRecord;
  request: BilibiliDanmakuInteractionRequest;
  visualEvidenceDirectory: string;
  assertLeasedRunRecord: () => void;
  emit: (eventType: string, reason: string | null, actionId: string | null) => void;
}): Promise<BilibiliDanmakuInteractionResult> {
  const { record, request } = input;
  validateTrustedBilibiliDanmakuInteractionRequest(request);
  if (record.attemptedActionIds.has(request.actionId)) {
    throw hostError({ code: 'action_already_attempted', category: 'action', scope: 'action' });
  }
  input.assertLeasedRunRecord();
  assertPage(record, request);
  const deadline = Date.now() + request.timeoutMs;
  let browserInputAttempted = false;
  let phase:
    | 'probe'
    | 'target_bounds'
    | 'before_evidence'
    | 'hover'
    | 'action'
    | 'postcondition'
    | 'after_evidence' = 'probe';
  try {
    const before = await waitForProbe(record.page, request, deadline, (candidate) =>
      candidate.playerVisible &&
      (request.action === 'open_list'
        ? candidate.listControlVisible && !candidate.listOpen
        : candidate.listOpen && candidate.listContainerVisible)
    );
    if (before.dom.loginGateVisible && request.action === 'open_list') {
      // Login only gates sending; retain the read-only list path. This field is
      // intentionally not treated as a stop condition for public reads.
    }
    if (before.dom.verificationRequired || before.dom.rateLimited || before.dom.sourceUnavailable) {
      throw new Error('bilibili_danmaku_interaction_risk_stopped');
    }
    phase = 'target_bounds';
    const target = await targetBounds(record.page, request.action, remaining(deadline));
    if (!target.bounds) throw new Error(target.reason);
    if (!target.pointerHit) throw new Error('bilibili_danmaku_interaction_pointer_precondition_unmet');
    phase = 'before_evidence';
    const beforeVisualEvidence = await captureEvidence(record, input.visualEvidenceDirectory, remaining(deadline));
    phase = 'hover';
    await withinDeadline(record.page.mouse.move(target.bounds.x + target.bounds.width / 2,
      target.bounds.y + target.bounds.height / 2), remaining(deadline));
    const hoveredTarget = await targetBounds(record.page, request.action, remaining(deadline));
    if (!hoveredTarget.bounds) throw new Error(hoveredTarget.reason);
    if (!hoveredTarget.pointerHit) throw new Error('bilibili_danmaku_interaction_hover_precondition_unmet');

    record.attemptedActionIds.add(request.actionId);
    touchRecord(record);
    input.emit('action_attempted', null, request.actionId);
    browserInputAttempted = true;

    phase = 'action';
    if (request.action === 'open_list') {
      await withinDeadline(record.page.mouse.down({ button: 'left' }), remaining(deadline));
      await withinDeadline(record.page.mouse.up({ button: 'left' }), remaining(deadline));
    } else {
      await withinDeadline(record.page.mouse.wheel(0, BILIBILI_DANMAKU_LIST_SCROLL_DELTA), remaining(deadline));
    }
    phase = 'postcondition';
    const after = await waitForPostcondition(record.page, request, before.dom, deadline);
    phase = 'after_evidence';
    const afterVisualEvidence = await captureEvidence(record, input.visualEvidenceDirectory, remaining(deadline));
    input.emit('bilibili_danmaku_interaction_completed', null, request.actionId);
    return {
      schemaVersion: BILIBILI_DANMAKU_INTERACTION_SCHEMA_VERSION,
      pageAlias: record.pageAlias,
      actionId: request.actionId,
      action: request.action,
      bvid: request.bvid,
      browserInputAttempted: true,
      completedAt: new Date().toISOString(),
      before: { dom: before.dom, targetBounds: target.bounds, visualEvidence: beforeVisualEvidence },
      after: { dom: after, visualEvidence: afterVisualEvidence }
    };
  } catch (error) {
    if (!browserInputAttempted) {
      if (error instanceof BrowserHostError) throw error;
      if (error instanceof Error && /^[a-z0-9_]{1,100}$/.test(error.message)) {
        throw hostError({ code: error.message, category: 'browser_input', scope: 'action', retryClass: 'local_query_only' });
      }
      throw hostError({
        code: safeDanmakuPreconditionErrorCode(phase, error),
        category: 'browser_input',
        scope: 'action',
        retryClass: 'local_query_only',
        safeDetails: { errorType: error instanceof Error ? error.name : 'unknown' }
      });
    }
    record.activeLease = null;
    transitionRecord(record, 'quarantined', 'bilibili_danmaku_interaction_outcome_unknown');
    input.emit('bilibili_danmaku_interaction_outcome_unknown', 'bilibili_danmaku_interaction_outcome_unknown', request.actionId);
    throw hostError({
      code: 'bilibili_danmaku_interaction_outcome_unknown',
      category: 'browser_input',
      scope: 'action',
      retryClass: 'new_run_required',
      platformActionAttempted: true,
      pageDisposition: 'quarantined',
      profileSafetyDisposition: 'stop_run_no_retry',
      safeDetails: { errorType: error instanceof Error ? error.name : 'unknown' }
    });
  }
}

function safeDanmakuPreconditionErrorCode(
  phase: 'probe' | 'target_bounds' | 'before_evidence' | 'hover' | 'action' | 'postcondition' | 'after_evidence',
  error: unknown
): string {
  const errorType = error instanceof Error ? error.name : 'unknown';
  const normalisedType = errorType.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'unknown';
  const message = error instanceof Error ? error.message : '';
  const normalisedMessage = message.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
  return `bilibili_danmaku_${phase}_${normalisedType}${normalisedMessage ? `_${normalisedMessage}` : ''}`.slice(0, 95);
}

function assertPage(record: ManagedPageRecord, request: BilibiliDanmakuInteractionRequest): void {
  if (record.state !== 'leased') {
    throw hostError({ code: 'bilibili_danmaku_interaction_page_not_ready', category: 'page_identity', scope: 'page' });
  }
  if (record.platform !== 'bilibili' || (record.pageRole !== 'video_detail' && record.pageRole !== 'video_danmaku')) {
    throw hostError({ code: 'bilibili_danmaku_interaction_page_role_rejected', category: 'page_identity', scope: 'page' });
  }
  if (record.documentGeneration !== request.expectedDocumentGeneration) {
    throw hostError({ code: 'managed_page_document_generation_mismatch', category: 'page_identity', scope: 'page', retryClass: 'local_query_only' });
  }
  if (!matchesBilibiliVideoDiscussionPageIdentity(record.page.url(), request.bvid)) {
    throw hostError({
      code: 'bilibili_danmaku_interaction_page_identity_unverified',
      category: 'page_identity',
      scope: 'page',
      retryClass: 'new_run_required',
      pageDisposition: 'quarantined',
      profileSafetyDisposition: 'stop_run_no_retry'
    });
  }
}

async function readProbe(page: Page, timeoutMs: number): Promise<BilibiliDanmakuInteractionDomState> {
  return await withinDeadline(page.evaluate(() => {
    const clean = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();
    const visible = (element: Element | null): boolean => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' &&
        Number.parseFloat(style.opacity || '1') > 0.01;
    };
    const player = document.querySelector('.bpx-player-video-area');
    const listRoot = document.querySelector('.bpx-player-filter-wrap.bpx-player-dm');
    const listWrap = listRoot?.querySelector<HTMLElement>('.bui-long-list-wrap') ?? null;
    const list = listRoot?.querySelector<HTMLUListElement>('ul.bui-long-list-list') ?? null;
    const rows = [...(listRoot?.querySelectorAll<HTMLElement>('li.bui-long-list-item') ?? [])]
      .map((row) => Number.parseInt(row.getAttribute('data-index') ?? '', 10))
      .filter((value) => Number.isSafeInteger(value) && value >= 0);
    const style = list?.getAttribute('style') ?? '';
    const match = style.match(/transform:\s*translate\([^,]+,\s*(-?[\d.]+)px/i);
    const offset = match ? Number.parseFloat(match[1] ?? '') : null;
    // Scope risk detection to the player. Page-wide recommendation and ad
    // text is not evidence that the target player is unavailable.
    const bodyText = clean(document.querySelector<HTMLElement>('.bpx-player-container')?.innerText).slice(0, 40_000);
    const bvid = location.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/)?.[1] ?? null;
    return {
      bvid,
      playerVisible: visible(player),
      listControlVisible: visible(document.querySelector('.bui-dropdown-display')),
      listOpen: visible(listRoot),
      listContainerVisible: visible(listWrap),
      listRowCount: rows.length,
      listFirstIndex: rows.length > 0 ? Math.min(...rows) : null,
      listLastIndex: rows.length > 0 ? Math.max(...rows) : null,
      listTotalEstimate: list && list.clientHeight > 0
        ? Math.round(list.getBoundingClientRect().height / Math.max(1, rows.length > 0 ? 24 : 1))
        : null,
      listOffset: offset === null ? null : Math.abs(offset),
      listHeight: list ? list.getBoundingClientRect().height : null,
      listViewportHeight: listWrap ? listWrap.clientHeight : null,
      loginGateVisible: /请先\s*登录|登录后查看/.test(bodyText),
      verificationRequired: /验证码|安全验证|完成验证|请进行验证|异常访问/.test(bodyText),
      rateLimited: /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(bodyText),
      sourceUnavailable: /页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(bodyText)
    };
  }), timeoutMs);
}

async function targetBounds(page: Page, action: BilibiliDanmakuInteractionAction, timeoutMs: number): Promise<{
  bounds: BilibiliDanmakuInteractionBounds | null;
  pointerHit: boolean;
  reason: string;
}> {
  return await withinDeadline(page.evaluate((kind) => {
    const selector = kind === 'open_list'
      ? '.bui-dropdown-display'
      : '.bpx-player-filter-wrap.bpx-player-dm .bui-long-list-wrap';
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) return { bounds: null, pointerHit: false, reason: 'bilibili_danmaku_interaction_target_missing' };
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return { bounds: null, pointerHit: false, reason: 'bilibili_danmaku_interaction_target_not_visible' };
    const x = Math.floor(rect.x + rect.width / 2);
    const y = Math.floor(rect.y + rect.height / 2);
    const hit = document.elementFromPoint(x, y);
    return {
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      pointerHit: Boolean(hit && (hit === element || element.contains(hit))),
      reason: 'ok'
    };
  }, action), timeoutMs);
}

async function waitForProbe(
  page: Page,
  request: BilibiliDanmakuInteractionRequest,
  deadline: number,
  ready: (dom: BilibiliDanmakuInteractionDomState) => boolean
): Promise<{ dom: BilibiliDanmakuInteractionDomState }> {
  let latest: BilibiliDanmakuInteractionDomState | null = null;
  while (Date.now() < deadline) {
    try {
      latest = await readProbe(page, remaining(deadline));
    } catch {
      // Bilibili may commit one more document/route transition immediately
      // after `domcontentloaded`; a local probe failure is retried as a read,
      // never as a platform action.
      await delay(Math.min(PROBE_INTERVAL_MS, Math.max(1, deadline - Date.now())));
      continue;
    }
    if (latest.bvid === request.bvid && ready(latest)) return { dom: latest };
    if (latest.verificationRequired || latest.rateLimited || latest.sourceUnavailable) return { dom: latest };
    await delay(Math.min(PROBE_INTERVAL_MS, Math.max(1, deadline - Date.now())));
  }
  if (!latest) throw new Error('bilibili_danmaku_interaction_probe_unavailable');
  return { dom: latest };
}

async function waitForPostcondition(
  page: Page,
  request: BilibiliDanmakuInteractionRequest,
  before: BilibiliDanmakuInteractionDomState,
  deadline: number
): Promise<BilibiliDanmakuInteractionDomState> {
  let latest: BilibiliDanmakuInteractionDomState | null = null;
  while (Date.now() < deadline) {
    try {
      latest = await readProbe(page, remaining(deadline));
    } catch {
      await delay(Math.min(PROBE_INTERVAL_MS, Math.max(1, deadline - Date.now())));
      continue;
    }
    const opened = latest.listOpen && latest.listContainerVisible && latest.listRowCount > 0;
    const scrolled = latest.listOpen && latest.listContainerVisible &&
      ((latest.listOffset ?? 0) > (before.listOffset ?? 0) ||
        latest.listFirstIndex !== before.listFirstIndex || latest.listLastIndex !== before.listLastIndex);
    if (latest.bvid === request.bvid && (request.action === 'open_list' ? opened : scrolled)) return latest;
    if (latest.verificationRequired || latest.rateLimited || latest.sourceUnavailable) break;
    await delay(Math.min(PROBE_INTERVAL_MS, Math.max(1, deadline - Date.now())));
  }
  throw new Error('bilibili_danmaku_interaction_postcondition_unmet');
}

async function captureEvidence(record: ManagedPageRecord, directory: string, timeoutMs: number) {
  return await withinDeadline(captureManagedPageVisualEvidence({
    page: record.page,
    pageAlias: record.pageAlias,
    documentGeneration: record.documentGeneration,
    routeGeneration: record.routeGeneration,
    directory
  }), timeoutMs);
}

function remaining(deadline: number): number {
  const value = deadline - Date.now();
  if (value < 100) throw new Error('bilibili_danmaku_interaction_deadline_exceeded');
  return value;
}

async function delay(timeoutMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

async function withinDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('bilibili_danmaku_interaction_deadline_exceeded')), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
