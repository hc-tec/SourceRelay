import type { Page, Response } from 'playwright';
import {
  BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_MAX_NETWORK_OBSERVATIONS,
  BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_MAX_TARGET_PAGE,
  BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_MIN_ACTIVE_PAGE,
  BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_SCHEMA_VERSION,
  type BilibiliAccountVideoPageClickBounds,
  type BilibiliAccountVideoPageClickNetworkObservation,
  type BilibiliAccountVideoPageClickRequest,
  type BilibiliAccountVideoPageClickResult,
  type PageScrollPosition
} from '@intelligence/collector-contracts';
import { hostError } from '../host-errors.js';
import {
  digestUrl,
  touchRecord,
  transitionRecord,
  type ManagedPageRecord
} from './page-record.js';
import { captureManagedPageVisualEvidence } from './page-visual-evidence.js';
import { canScrollDown, readTrustedScrollPosition } from './trusted-scroll.js';

const ACTION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const MINIMUM_TIMEOUT_MS = 1_000;
const MAXIMUM_TIMEOUT_MS = 15_000;
const MAXIMUM_SINGLE_SCROLL_DELTA = 2_400;
const TARGET_ROUTE_ORIGIN = 'https://api.bilibili.com';
const ACCOUNT_VIDEO_ROUTE_PATH = '/x/space/wbi/arc/search';
const SERIES_DETAIL_ROUTE_PATH = '/x/polymer/web-space/seasons_archives_list';

interface PaginationProbe {
  activePage: number | null;
  target: {
    page: number;
    bounds: BilibiliAccountVideoPageClickBounds;
    rendered: boolean;
    enabled: boolean;
    inViewport: boolean;
    pointerHitTarget: boolean;
    pointerHoveredTarget: boolean;
  } | null;
  renderedCardCount: number;
}

interface NeutralPointerTarget {
  x: number;
  y: number;
}

export function validateTrustedBilibiliAccountVideoPageClickRequest(
  request: BilibiliAccountVideoPageClickRequest
): void {
  if (request.schemaVersion !== BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_SCHEMA_VERSION) {
    throw hostError({ code: 'bilibili_page_click_schema_invalid', category: 'protocol', scope: 'action' });
  }
  if (request.pageRole !== undefined && request.pageRole !== 'account_video_inventory' && request.pageRole !== 'series_detail') {
    throw hostError({ code: 'bilibili_page_click_page_role_rejected', category: 'page_identity', scope: 'page' });
  }
  if (!ACTION_ID_PATTERN.test(request.actionId)) {
    throw hostError({ code: 'bilibili_page_click_action_id_invalid', category: 'action', scope: 'action' });
  }
  if (
    !Number.isSafeInteger(request.expectedActivePage) ||
    request.expectedActivePage < BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_MIN_ACTIVE_PAGE ||
    request.expectedActivePage >= BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_MAX_TARGET_PAGE ||
    !Number.isSafeInteger(request.targetPage) ||
    request.targetPage !== request.expectedActivePage + 1 ||
    request.targetPage > BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_MAX_TARGET_PAGE
  ) {
    throw hostError({ code: 'bilibili_page_click_target_rejected', category: 'action', scope: 'action' });
  }
  if (!Number.isSafeInteger(request.timeoutMs) ||
    request.timeoutMs < MINIMUM_TIMEOUT_MS || request.timeoutMs > MAXIMUM_TIMEOUT_MS) {
    throw hostError({
      code: 'bilibili_page_click_timeout_invalid',
      category: 'action',
      scope: 'action',
      safeDetails: { maximumTimeoutMs: MAXIMUM_TIMEOUT_MS }
    });
  }
}

/**
 * Executes exactly one source-specific, browser-trusted click. The Host owns
 * selector semantics, bounds, pointer movement, and Network metadata so the
 * Gateway never receives an arbitrary selector, script, or coordinate API.
 */
export async function executeTrustedBilibiliAccountVideoPageClick(input: {
  record: ManagedPageRecord;
  request: BilibiliAccountVideoPageClickRequest;
  visualEvidenceDirectory: string;
  assertLeasedRunRecord: () => void;
  emit: (eventType: string, reason: string | null, actionId: string | null) => void;
}): Promise<BilibiliAccountVideoPageClickResult> {
  const { record, request } = input;
  validateTrustedBilibiliAccountVideoPageClickRequest(request);
  if (record.attemptedActionIds.has(request.actionId)) {
    throw hostError({ code: 'action_already_attempted', category: 'action', scope: 'action' });
  }
  input.assertLeasedRunRecord();
  if (record.state !== 'leased') {
    throw hostError({
      code: 'bilibili_page_click_page_not_ready',
      category: 'page_identity',
      scope: 'page',
      retryClass: 'local_query_only'
    });
  }
  const pageRole = request.pageRole ?? 'account_video_inventory';
  if (record.platform !== 'bilibili' || record.pageRole !== pageRole) {
    throw hostError({ code: 'bilibili_page_click_page_role_rejected', category: 'page_identity', scope: 'page' });
  }
  if (record.documentGeneration !== request.expectedDocumentGeneration) {
    throw hostError({
      code: 'managed_page_document_generation_mismatch',
      category: 'page_identity',
      scope: 'page',
      retryClass: 'local_query_only'
    });
  }
  if (record.page.isClosed() || digestUrl(record.page.url()) !== record.expectedIdentity.targetUrlDigest) {
    throw hostError({
      code: 'bilibili_page_click_page_identity_unverified',
      category: 'page_identity',
      scope: 'page',
      retryClass: 'new_run_required'
    });
  }

  const deadline = Date.now() + request.timeoutMs;
  let actionAttempted = false;
  try {
    let beforeScroll = await readTrustedScrollPosition(record.page, remaining(deadline));
    const routeMode: PaginationRouteMode = pageRole === 'series_detail' ? 'series_detail' : 'account_video_inventory';
    let initial = await waitForInitialPaginationPrecondition(
      record.page,
      request.expectedActivePage,
      request.targetPage,
      deadline,
      routeMode
    );

    let afterScroll = beforeScroll;
    let scrollAttempted = false;
    if (!initial.target!.inViewport) {
      if (!canScrollDown(beforeScroll)) {
        throw hostError({
          code: 'bilibili_page_click_scroll_precondition_unmet',
          category: 'action',
          scope: 'action',
          retryClass: 'local_query_only'
        });
      }
      const deltaY = requiredSingleScrollDelta(initial.target!.bounds, beforeScroll);
      if (deltaY === null) {
        throw hostError({
          code: 'bilibili_page_click_target_requires_multiple_scrolls',
          category: 'action',
          scope: 'action',
          retryClass: 'new_run_required'
        });
      }
      record.attemptedActionIds.add(request.actionId);
      actionAttempted = true;
      touchRecord(record);
      input.emit('action_attempted', null, request.actionId);
      scrollAttempted = true;
      await withinDeadline(
        record.page.mouse.move(Math.floor(beforeScroll.viewportWidth / 2), Math.floor(beforeScroll.viewportHeight / 2)),
        remaining(deadline)
      );
      await withinDeadline(record.page.mouse.wheel(0, deltaY), remaining(deadline));
      afterScroll = await readTrustedScrollPosition(record.page, remaining(deadline));
      initial = await readPaginationProbe(record.page, request.targetPage, remaining(deadline), routeMode);
      assertInitialPrecondition(initial, request.expectedActivePage, request.targetPage);
      if (!initial.target!.inViewport) throw new Error('bilibili_page_click_target_not_in_viewport_after_scroll');
    }

    if (!actionAttempted) {
      record.attemptedActionIds.add(request.actionId);
      actionAttempted = true;
      touchRecord(record);
      input.emit('action_attempted', null, request.actionId);
    }

    const target = initial.target!;
    const pointerX = Math.floor(target.bounds.x + target.bounds.width / 2);
    const pointerY = Math.floor(target.bounds.y + target.bounds.height / 2);
    await withinDeadline(record.page.mouse.move(pointerX, pointerY), remaining(deadline));
    const hovered = await readPaginationProbe(record.page, request.targetPage, remaining(deadline), routeMode);
    assertClickableTarget(hovered, request.expectedActivePage, request.targetPage);
    const beforeVisualEvidence = await withinDeadline(captureManagedPageVisualEvidence({
      page: record.page,
      pageAlias: record.pageAlias,
      documentGeneration: record.documentGeneration,
      routeGeneration: record.routeGeneration,
      directory: input.visualEvidenceDirectory
    }), remaining(deadline));

    const observations: BilibiliAccountVideoPageClickNetworkObservation[] = [];
    const onResponse = (response: Response): void => {
      const observation = routeObservation(response, routeMode);
      if (observation && observations.length < BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_MAX_NETWORK_OBSERVATIONS) {
        observations.push(observation);
      }
    };
    record.page.on('response', onResponse);
    try {
      await withinDeadline(record.page.mouse.down({ button: 'left' }), remaining(deadline));
      await withinDeadline(record.page.mouse.up({ button: 'left' }), remaining(deadline));
      const neutral = await findNeutralPointerTarget(record.page, remaining(deadline));
      await withinDeadline(record.page.mouse.move(neutral.x, neutral.y), remaining(deadline));
      const after = await waitForPaginationPostcondition(record.page, request.targetPage, observations, deadline, routeMode);
      assertSameDocument(record, request);
      const afterVisualEvidence = await withinDeadline(captureManagedPageVisualEvidence({
        page: record.page,
        pageAlias: record.pageAlias,
        documentGeneration: record.documentGeneration,
        routeGeneration: record.routeGeneration,
        directory: input.visualEvidenceDirectory
      }), remaining(deadline));
      input.emit('bilibili_page_click_completed', null, request.actionId);
      return {
        schemaVersion: BILIBILI_ACCOUNT_VIDEO_PAGE_CLICK_SCHEMA_VERSION,
        pageAlias: record.pageAlias,
        actionId: request.actionId,
        recordVersion: record.recordVersion,
        documentGeneration: record.documentGeneration,
        routeGeneration: record.routeGeneration,
        completedAt: new Date().toISOString(),
        clickAttempted: true,
        scrollToControl: { attempted: scrollAttempted, before: beforeScroll, after: afterScroll },
        before: {
          activePage: request.expectedActivePage,
          targetPage: request.targetPage,
          targetBounds: hovered.target!.bounds,
          pointerHitTarget: true,
          pointerHoveredTarget: true,
          visualEvidence: beforeVisualEvidence
        },
        after: {
          activePage: after.activePage,
          renderedCardCount: after.renderedCardCount,
          scroll: await readTrustedScrollPosition(record.page, remaining(deadline)),
          neutralPointer: { ...neutral, targetKind: 'non_media_non_interactive' },
          visualEvidence: afterVisualEvidence
        },
        network: { observations }
      };
    } finally {
      record.page.off('response', onResponse);
    }
  } catch (error) {
    if (!actionAttempted) throw error;
    record.activeLease = null;
    transitionRecord(record, 'quarantined', 'bilibili_page_click_outcome_unknown');
    input.emit('bilibili_page_click_outcome_unknown', 'bilibili_page_click_outcome_unknown', request.actionId);
    throw hostError({
      code: 'bilibili_page_click_outcome_unknown',
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

function assertInitialPrecondition(
  probe: PaginationProbe,
  expectedActivePage: number,
  targetPage: number
): void {
  if (!hasInitialPrecondition(probe, expectedActivePage, targetPage)) {
    throw hostError({
      code: 'bilibili_page_click_precondition_unmet',
      category: 'action',
      scope: 'action',
      retryClass: 'local_query_only'
    });
  }
}

function hasInitialPrecondition(
  probe: PaginationProbe,
  expectedActivePage: number,
  targetPage: number
): boolean {
  return probe.activePage === expectedActivePage && Boolean(
    probe.target && probe.target.page === targetPage && probe.target.rendered && probe.target.enabled
  );
}

function assertClickableTarget(
  probe: PaginationProbe,
  expectedActivePage: number,
  targetPage: number
): void {
  assertInitialPrecondition(probe, expectedActivePage, targetPage);
  if (!probe.target!.inViewport || !probe.target!.pointerHitTarget || !probe.target!.pointerHoveredTarget) {
    throw new Error('bilibili_page_click_pointer_precondition_unmet');
  }
}

function requiredSingleScrollDelta(bounds: BilibiliAccountVideoPageClickBounds, position: PageScrollPosition): number | null {
  const targetCenter = bounds.y + bounds.height / 2;
  const desiredCenter = position.viewportHeight / 2;
  const delta = Math.ceil(targetCenter - desiredCenter);
  return delta >= 1 && delta <= MAXIMUM_SINGLE_SCROLL_DELTA ? delta : null;
}

type PaginationRouteMode = 'account_video_inventory' | 'series_detail';

async function readPaginationProbe(
  page: Page,
  targetPage: number,
  timeoutMs: number,
  _routeMode: PaginationRouteMode
): Promise<PaginationProbe> {
  const value = await withinDeadline(page.evaluate((pageNumber) => {
    const rendered = (element: Element | null): element is HTMLButtonElement => {
      if (!(element instanceof HTMLButtonElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' &&
        Number.parseFloat(style.opacity || '1') > 0.01;
    };
    const numericPage = (element: Element | null): number | null => {
      const text = (element?.textContent ?? '').trim();
      return /^\d{1,3}$/.test(text) ? Number(text) : null;
    };
    // The account list currently adds `.video-pagination`, while the
    // collection/series detail page exposes only the stable Bilibili
    // pagination class.  Keep the platform-owned class as the fallback so
    // both page roles use the same trusted input path.
    const root = document.querySelector('.video-pagination.vui_pagenation, .vui_pagenation');
    const buttons = root ? Array.from(root.querySelectorAll<HTMLButtonElement>('button.vui_pagenation--btn-num')) : [];
    const active = buttons.find((button) => button.classList.contains('vui_button--active')) ?? null;
    const target = buttons.find((button) => numericPage(button) === pageNumber) ?? null;
    const targetRendered = rendered(target);
    const rect = target?.getBoundingClientRect();
    const centerX = rect ? Math.floor(rect.x + rect.width / 2) : -1;
    const centerY = rect ? Math.floor(rect.y + rect.height / 2) : -1;
    const hit = targetRendered && rect ? document.elementFromPoint(centerX, centerY) : null;
    const cards = document.querySelector('.video-list.grid-mode, .list-video-item');
    const renderedCardCount = cards
      ? Array.from(cards.querySelectorAll<HTMLElement>('.bili-video-card__wrap, .list-video-item'))
        .concat(cards.matches('.list-video-item') ? [cards as HTMLElement] : [])
        .filter((card) => {
        const cardRect = card.getBoundingClientRect();
        const style = getComputedStyle(card);
        return cardRect.width > 0 && cardRect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      }).length
      : 0;
    return {
      activePage: numericPage(active),
      target: target && rect ? {
        page: pageNumber,
        bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        rendered: targetRendered,
        enabled: !target.disabled && target.getAttribute('aria-disabled') !== 'true',
        inViewport: targetRendered && rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth,
        pointerHitTarget: Boolean(hit && (hit === target || target.contains(hit))),
        pointerHoveredTarget: target.matches(':hover')
      } : null,
      renderedCardCount
    };
  }, targetPage), timeoutMs);
  return validatePaginationProbe(value, targetPage);
}

function validatePaginationProbe(value: unknown, targetPage: number): PaginationProbe {
  if (!value || typeof value !== 'object') throw new Error('bilibili_page_click_probe_invalid');
  const candidate = value as Partial<PaginationProbe>;
  const activePage = candidate.activePage;
  const renderedCardCount = candidate.renderedCardCount;
  if (activePage !== null && activePage !== undefined && (!Number.isSafeInteger(activePage) || activePage < 1)) {
    throw new Error('bilibili_page_click_probe_invalid');
  }
  if (typeof renderedCardCount !== 'number' || !Number.isSafeInteger(renderedCardCount) ||
    renderedCardCount < 0 || renderedCardCount > 40) {
    throw new Error('bilibili_page_click_probe_invalid');
  }
  if (candidate.target === null) return { activePage: activePage ?? null, target: null, renderedCardCount };
  const target = candidate.target;
  const bounds = target?.bounds;
  if (!target || target.page !== targetPage || !bounds ||
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isSafeInteger) ||
    bounds.width < 1 || bounds.height < 1 || bounds.width > 1_000 || bounds.height > 1_000 ||
    typeof target.rendered !== 'boolean' || typeof target.enabled !== 'boolean' ||
    typeof target.inViewport !== 'boolean' || typeof target.pointerHitTarget !== 'boolean' ||
    typeof target.pointerHoveredTarget !== 'boolean') {
    throw new Error('bilibili_page_click_probe_invalid');
  }
  return {
    activePage: activePage ?? null,
    target: {
      page: targetPage,
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      rendered: target.rendered,
      enabled: target.enabled,
      inViewport: target.inViewport,
      pointerHitTarget: target.pointerHitTarget,
      pointerHoveredTarget: target.pointerHoveredTarget
    },
    renderedCardCount
  };
}

function routeObservation(
  response: Response,
  routeMode: PaginationRouteMode
): BilibiliAccountVideoPageClickNetworkObservation | null {
  try {
    if (response.request().method() !== 'GET') return null;
    const url = new URL(response.url());
    const expectedPath = routeMode === 'series_detail' ? SERIES_DETAIL_ROUTE_PATH : ACCOUNT_VIDEO_ROUTE_PATH;
    if (url.origin !== TARGET_ROUTE_ORIGIN || url.pathname !== expectedPath) return null;
    const status = response.status();
    if (!Number.isSafeInteger(status) || status < 100 || status > 599) return null;
    return {
      method: 'GET',
      origin: TARGET_ROUTE_ORIGIN,
      path: expectedPath,
      status,
      receivedAt: new Date().toISOString()
    };
  } catch {
    return null;
  }
}

async function findNeutralPointerTarget(page: Page, timeoutMs: number): Promise<NeutralPointerTarget> {
  const value = await withinDeadline(page.evaluate(() => {
    const points: Array<readonly [number, number]> = [
      [8, Math.max(8, Math.floor(window.innerHeight - 8))],
      [Math.max(8, Math.floor(window.innerWidth - 8)), Math.max(8, Math.floor(window.innerHeight - 8))],
      [8, Math.max(8, Math.floor(window.innerHeight / 2))],
      [Math.max(8, Math.floor(window.innerWidth - 8)), Math.max(8, Math.floor(window.innerHeight / 2))]
    ];
    for (const [x, y] of points) {
      const element = document.elementFromPoint(x, y);
      if (!element) continue;
      const unsafe = element.closest([
        'a', 'button', 'input', 'textarea', 'select', '[role="button"]', 'video',
        '.bili-video-card__wrap', '[class*="player" i]', '[class*="video-card" i]'
      ].join(','));
      if (!unsafe) return { x, y };
    }
    return null;
  }), timeoutMs);
  if (!value || typeof value !== 'object') throw new Error('bilibili_page_click_neutral_pointer_unavailable');
  const candidate = value as Partial<NeutralPointerTarget>;
  const x = candidate.x;
  const y = candidate.y;
  if (typeof x !== 'number' || typeof y !== 'number' ||
    !Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0) {
    throw new Error('bilibili_page_click_neutral_pointer_invalid');
  }
  return { x, y };
}

async function waitForPaginationPostcondition(
  page: Page,
  targetPage: number,
  observations: readonly BilibiliAccountVideoPageClickNetworkObservation[],
  deadline: number,
  routeMode: PaginationRouteMode
): Promise<PaginationProbe> {
  let latest: PaginationProbe | null = null;
  while (Date.now() < deadline) {
    const available = deadline - Date.now();
    if (available < 100) break;
    latest = await readPaginationProbe(page, targetPage, available, routeMode);
    if (latest.activePage === targetPage && observations.length > 0) return latest;
    await delay(Math.min(100, Math.max(1, deadline - Date.now())));
  }
  if (!latest) throw new Error('bilibili_page_click_postcondition_unavailable');
  return latest;
}

async function waitForInitialPaginationPrecondition(
  page: Page,
  expectedActivePage: number,
  targetPage: number,
  deadline: number,
  routeMode: PaginationRouteMode
): Promise<PaginationProbe> {
  let latest: PaginationProbe | null = null;
  while (Date.now() < deadline) {
    const available = deadline - Date.now();
    if (available < 100) break;
    latest = await readPaginationProbe(page, targetPage, available, routeMode);
    if (hasInitialPrecondition(latest, expectedActivePage, targetPage)) return latest;
    await delay(Math.min(100, Math.max(1, deadline - Date.now())));
  }
  if (!latest) throw new Error('bilibili_page_click_initial_precondition_unavailable');
  assertInitialPrecondition(latest, expectedActivePage, targetPage);
  return latest;
}

function assertSameDocument(record: ManagedPageRecord, request: BilibiliAccountVideoPageClickRequest): void {
  if (record.documentGeneration !== request.expectedDocumentGeneration || record.page.isClosed() ||
    digestUrl(record.page.url()) !== record.expectedIdentity.targetUrlDigest) {
    throw new Error('bilibili_page_click_context_changed');
  }
}

function remaining(deadline: number): number {
  const value = deadline - Date.now();
  if (value < 100) throw new Error('bilibili_page_click_deadline_exceeded');
  return value;
}

async function withinDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('bilibili_page_click_deadline_exceeded')), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function delay(timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
}
