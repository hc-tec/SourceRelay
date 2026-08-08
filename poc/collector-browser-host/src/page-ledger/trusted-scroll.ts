import type { Page } from 'playwright';
import {
  PAGE_SCROLL_RESULT_SCHEMA_VERSION,
  type PageScrollPosition,
  type PageScrollResult,
  type ScrollPageRequest
} from '@intelligence/collector-contracts';
import { hostError } from '../host-errors.js';
import {
  digestUrl,
  touchRecord,
  transitionRecord,
  type ManagedPageRecord
} from './page-record.js';
import { matchesBilibiliVideoDiscussionPageIdentity } from './bilibili-video-discussion-page-identity.js';

const ACTION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const MAX_DELTA_Y = 1_200;
const MAX_TIMEOUT_MS = 10_000;
const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;

export function validateTrustedScrollRequest(request: ScrollPageRequest): void {
  if (!ACTION_ID_PATTERN.test(request.actionId)) {
    throw hostError({ code: 'scroll_action_id_invalid', category: 'action', scope: 'action' });
  }
  if (!Number.isSafeInteger(request.deltaY) || request.deltaY < 1 || request.deltaY > MAX_DELTA_Y) {
    throw hostError({
      code: 'scroll_delta_y_invalid',
      category: 'action',
      scope: 'action',
      safeDetails: { maximumDeltaY: MAX_DELTA_Y }
    });
  }
  if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 250 || request.timeoutMs > MAX_TIMEOUT_MS) {
    throw hostError({
      code: 'scroll_timeout_invalid',
      category: 'action',
      scope: 'action',
      safeDetails: { maximumTimeoutMs: MAX_TIMEOUT_MS }
    });
  }
  if (request.bilibiliVideoBvid !== undefined && !BVID_PATTERN.test(request.bilibiliVideoBvid)) {
    throw hostError({ code: 'scroll_bilibili_bvid_invalid', category: 'action', scope: 'action' });
  }
}

function pageIdentityMatches(record: ManagedPageRecord, request: ScrollPageRequest): boolean {
  if (record.page.isClosed()) return false;
  if (request.bilibiliVideoBvid !== undefined) {
    return record.platform === 'bilibili' && record.pageRole === 'video_discussion' &&
      matchesBilibiliVideoDiscussionPageIdentity(record.page.url(), request.bilibiliVideoBvid);
  }
  return digestUrl(record.page.url()) === record.expectedIdentity.targetUrlDigest;
}

export async function readTrustedScrollPosition(page: Page, timeoutMs: number): Promise<PageScrollPosition> {
  const value = await withinDeadline(page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const root = document.scrollingElement ?? document.documentElement;
    const body = document.body;
    return {
      scrollX: Math.round(window.scrollX),
      scrollY: Math.round(window.scrollY),
      scrollHeight: Math.round(Math.max(root.scrollHeight, body?.scrollHeight ?? 0)),
      viewportWidth: Math.round(window.innerWidth),
      viewportHeight: Math.round(window.innerHeight)
    };
  }), timeoutMs);
  return validateScrollPosition(value);
}

export async function performTrustedScroll(input: {
  page: Page;
  before: PageScrollPosition;
  deltaY: number;
  timeoutMs: number;
}): Promise<PageScrollPosition> {
  const pointerX = Math.max(1, Math.floor(input.before.viewportWidth / 2));
  const pointerY = Math.max(1, Math.floor(input.before.viewportHeight / 2));
  await withinDeadline(input.page.mouse.move(pointerX, pointerY), input.timeoutMs);
  await withinDeadline(new Promise((resolve) => setTimeout(resolve, 120)), input.timeoutMs);
  await withinDeadline(input.page.mouse.wheel(0, input.deltaY), input.timeoutMs);
  await withinDeadline(new Promise((resolve) => setTimeout(resolve, 250)), input.timeoutMs);
  return await readTrustedScrollPosition(input.page, input.timeoutMs);
}

export function canScrollDown(position: PageScrollPosition): boolean {
  return position.scrollY < Math.max(0, position.scrollHeight - position.viewportHeight);
}

export async function executeTrustedScroll(input: {
  record: ManagedPageRecord;
  request: ScrollPageRequest;
  assertLeasedRunRecord: () => void;
  emit: (eventType: string, reason: string | null, actionId: string | null) => void;
}): Promise<PageScrollResult> {
  const { record, request } = input;
  validateTrustedScrollRequest(request);
  if (record.attemptedActionIds.has(request.actionId)) {
    throw hostError({ code: 'action_already_attempted', category: 'action', scope: 'action' });
  }
  input.assertLeasedRunRecord();
  if (record.state !== 'leased') {
    throw hostError({
      code: 'scroll_page_not_ready',
      category: 'page_identity',
      scope: 'page',
      retryClass: 'local_query_only'
    });
  }
  if (record.documentGeneration !== request.expectedDocumentGeneration) {
    throw hostError({
      code: 'managed_page_document_generation_mismatch',
      category: 'page_identity',
      scope: 'page',
      retryClass: 'local_query_only'
    });
  }
  if (!pageIdentityMatches(record, request)) {
    record.activeLease = null;
    transitionRecord(record, 'quarantined', 'unexpected_navigation');
    input.emit('scroll_context_changed', 'unexpected_navigation', null);
    throw hostError({
      code: 'scroll_page_identity_unverified',
      category: 'page_identity',
      scope: 'page',
      retryClass: 'new_run_required',
      pageDisposition: 'quarantined',
      profileSafetyDisposition: 'stop_run_no_retry'
    });
  }

  let before: PageScrollPosition;
  try {
    before = await readTrustedScrollPosition(record.page, request.timeoutMs);
  } catch (error) {
    record.activeLease = null;
    transitionRecord(record, 'quarantined', 'scroll_precondition_unavailable');
    input.emit('scroll_precondition_unavailable', 'scroll_precondition_unavailable', null);
    throw hostError({
      code: 'scroll_precondition_unavailable',
      category: 'browser_input',
      scope: 'page',
      retryClass: 'new_run_required',
      pageDisposition: 'quarantined',
      profileSafetyDisposition: 'stop_run_no_retry',
      safeDetails: { errorType: error instanceof Error ? error.name : 'unknown' }
    });
  }
  if (!canScrollDown(before)) {
    throw hostError({
      code: 'scroll_precondition_unmet',
      category: 'action',
      scope: 'action',
      retryClass: 'local_query_only',
      safeDetails: {
        scrollY: before.scrollY,
        maximumScrollY: Math.max(0, before.scrollHeight - before.viewportHeight)
      }
    });
  }

  record.attemptedActionIds.add(request.actionId);
  touchRecord(record);
  input.emit('action_attempted', null, request.actionId);
  try {
    const after = await performTrustedScroll({
      page: record.page,
      before,
      deltaY: request.deltaY,
      timeoutMs: request.timeoutMs
    });
    const contextChanged = record.documentGeneration !== request.expectedDocumentGeneration ||
      !pageIdentityMatches(record, request);
    if (contextChanged || after.scrollY <= before.scrollY) {
      throw new Error(contextChanged ? 'trusted_scroll_context_changed' : 'trusted_scroll_postcondition_unmet');
    }
    input.emit('scroll_completed', null, request.actionId);
    return {
      schemaVersion: PAGE_SCROLL_RESULT_SCHEMA_VERSION,
      pageAlias: record.pageAlias,
      actionId: request.actionId,
      recordVersion: record.recordVersion,
      documentGeneration: record.documentGeneration,
      routeGeneration: record.routeGeneration,
      completedAt: new Date().toISOString(),
      before,
      after
    };
  } catch (error) {
    record.activeLease = null;
    transitionRecord(record, 'quarantined', 'scroll_outcome_unknown');
    input.emit('scroll_outcome_unknown', 'scroll_outcome_unknown', request.actionId);
    throw hostError({
      code: 'scroll_outcome_unknown',
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

function validateScrollPosition(value: unknown): PageScrollPosition {
  if (!value || typeof value !== 'object') throw new Error('trusted_scroll_position_invalid');
  const candidate = value as Partial<PageScrollPosition>;
  const values = [
    candidate.scrollX,
    candidate.scrollY,
    candidate.scrollHeight,
    candidate.viewportWidth,
    candidate.viewportHeight
  ];
  if (!values.every(isNonNegativeSafeInteger) ||
    candidate.viewportWidth === 0 || candidate.viewportHeight === 0) {
    throw new Error('trusted_scroll_position_invalid');
  }
  return {
    scrollX: candidate.scrollX!,
    scrollY: candidate.scrollY!,
    scrollHeight: candidate.scrollHeight!,
    viewportWidth: candidate.viewportWidth!,
    viewportHeight: candidate.viewportHeight!
  };
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

async function withinDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('trusted_scroll_deadline_exceeded')), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
