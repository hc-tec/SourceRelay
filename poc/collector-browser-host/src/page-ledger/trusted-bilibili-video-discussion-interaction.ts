import type { Page, Response } from 'playwright';
import {
  BrowserHostError,
  BILIBILI_VIDEO_DISCUSSION_INTERACTION_ACTIONS,
  BILIBILI_VIDEO_DISCUSSION_INTERACTION_MAX_NETWORK_OBSERVATIONS,
  BILIBILI_VIDEO_DISCUSSION_INTERACTION_MAX_TIMEOUT_MS,
  BILIBILI_VIDEO_DISCUSSION_INTERACTION_SCHEMA_VERSION,
  type BilibiliVideoDiscussionInteractionAction,
  type BilibiliVideoDiscussionInteractionBounds,
  type BilibiliVideoDiscussionInteractionDomState,
  type BilibiliVideoDiscussionInteractionNetworkObservation,
  type BilibiliVideoDiscussionInteractionRequest,
  type BilibiliVideoDiscussionInteractionResult,
  type PageVisualEvidence
} from '@intelligence/collector-contracts';
import { hostError } from '../host-errors.js';
import { touchRecord, transitionRecord, type ManagedPageRecord } from './page-record.js';
import { captureManagedPageVisualEvidence } from './page-visual-evidence.js';
import { matchesBilibiliVideoDiscussionPageIdentity } from './bilibili-video-discussion-page-identity.js';

const ACTION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;
const PROBE_INTERVAL_MS = 120;
const MINIMUM_TIMEOUT_MS = 1_000;
const TARGET_ROUTES = {
  select_latest_comments: '/x/v2/reply/wbi/main',
  expand_first_thread: '/x/v2/reply/reply'
} as const;

interface DiscussionProbe {
  dom: BilibiliVideoDiscussionInteractionDomState;
}

export function validateTrustedBilibiliVideoDiscussionInteractionRequest(
  request: BilibiliVideoDiscussionInteractionRequest
): void {
  if (request.schemaVersion !== BILIBILI_VIDEO_DISCUSSION_INTERACTION_SCHEMA_VERSION ||
    !(BILIBILI_VIDEO_DISCUSSION_INTERACTION_ACTIONS as readonly string[]).includes(request.action) ||
    !ACTION_ID_PATTERN.test(request.actionId) ||
    !BVID_PATTERN.test(request.bvid) ||
    !Number.isSafeInteger(request.expectedRecordVersion) || request.expectedRecordVersion < 1 ||
    !Number.isSafeInteger(request.expectedDocumentGeneration) || request.expectedDocumentGeneration < 1 ||
    !Number.isSafeInteger(request.timeoutMs) ||
    request.timeoutMs < MINIMUM_TIMEOUT_MS ||
    request.timeoutMs > BILIBILI_VIDEO_DISCUSSION_INTERACTION_MAX_TIMEOUT_MS) {
    throw hostError({ code: 'bilibili_video_discussion_interaction_schema_invalid', category: 'protocol', scope: 'action' });
  }
}

/**
 * Executes one source-specific, browser-trusted discussion click. The caller
 * supplies only a semantic action. The Host discovers the live open Shadow DOM
 * target, rechecks its bounds after pointer movement, and records only route
 * metadata for the corresponding public response.
 */
export async function executeTrustedBilibiliVideoDiscussionInteraction(input: {
  record: ManagedPageRecord;
  request: BilibiliVideoDiscussionInteractionRequest;
  visualEvidenceDirectory: string;
  assertLeasedRunRecord: () => void;
  emit: (eventType: string, reason: string | null, actionId: string | null) => void;
}): Promise<BilibiliVideoDiscussionInteractionResult> {
  const { record, request } = input;
  validateTrustedBilibiliVideoDiscussionInteractionRequest(request);
  if (record.attemptedActionIds.has(request.actionId)) {
    throw hostError({ code: 'action_already_attempted', category: 'action', scope: 'action' });
  }
  input.assertLeasedRunRecord();
  assertDiscussionPage(record, request);

  const deadline = Date.now() + request.timeoutMs;
  let browserInputAttempted = false;
  try {
    const beforeProbe = await waitForProbe(record.page, request, deadline, (candidate) =>
      candidate.dom.commentHostPresent && candidate.dom.commentHostVisible &&
      candidate.dom.commentHostInViewport && candidate.dom.targetVisible &&
      candidate.dom.targetInViewport
    );
    if (beforeProbe.dom.loginGateVisible || beforeProbe.dom.verificationRequired ||
      beforeProbe.dom.rateLimited || beforeProbe.dom.sourceUnavailable) {
      throw new Error('bilibili_video_discussion_interaction_risk_stopped');
    }
    assertActionPrecondition(beforeProbe, request.action);
    const targetBounds = beforeProbe.dom.targetBounds!;
    const beforeVisualEvidence = await captureEvidence(
      record,
      input.visualEvidenceDirectory,
      remaining(deadline)
    );

    const pointerX = Math.floor(targetBounds.x + targetBounds.width / 2);
    const pointerY = Math.floor(targetBounds.y + targetBounds.height / 2);
    await withinDeadline(record.page.mouse.move(pointerX, pointerY), remaining(deadline));
    const hoveredProbe = await readProbe(record.page, request.action, remaining(deadline));
    assertClickableTarget(hoveredProbe, request.action);

    record.attemptedActionIds.add(request.actionId);
    touchRecord(record);
    input.emit('action_attempted', null, request.actionId);
    browserInputAttempted = true;

    const observations: BilibiliVideoDiscussionInteractionNetworkObservation[] = [];
    const onResponse = (response: Response): void => {
      const observation = routeObservation(response, request.action);
      if (observation && observations.length < BILIBILI_VIDEO_DISCUSSION_INTERACTION_MAX_NETWORK_OBSERVATIONS) {
        observations.push(observation);
      }
    };
    record.page.on('response', onResponse);
    try {
      await withinDeadline(record.page.mouse.down({ button: 'left' }), remaining(deadline));
      await withinDeadline(record.page.mouse.up({ button: 'left' }), remaining(deadline));
      const afterProbe = await waitForPostcondition(record.page, request, observations, deadline);
      const afterVisualEvidence = await captureEvidence(
        record,
        input.visualEvidenceDirectory,
        remaining(deadline)
      );
      input.emit('bilibili_video_discussion_interaction_completed', null, request.actionId);
      return {
        schemaVersion: BILIBILI_VIDEO_DISCUSSION_INTERACTION_SCHEMA_VERSION,
        pageAlias: record.pageAlias,
        actionId: request.actionId,
        action: request.action,
        bvid: request.bvid,
        clickAttempted: true,
        completedAt: new Date().toISOString(),
        before: {
          dom: hoveredProbe.dom,
          targetBounds,
          pointerHitTarget: true,
          pointerHoveredTarget: true,
          visualEvidence: beforeVisualEvidence
        },
        after: { dom: afterProbe.dom, visualEvidence: afterVisualEvidence },
        network: { observations }
      };
    } finally {
      record.page.off('response', onResponse);
    }
  } catch (error) {
    if (!browserInputAttempted) {
      if (error instanceof BrowserHostError) throw error;
      throw hostError({
        code: safeDiscussionPreconditionErrorCode(error),
        category: 'browser_input',
        scope: 'action',
        retryClass: 'local_query_only',
        safeDetails: { errorType: error instanceof Error ? error.name : 'unknown' }
      });
    }
    record.activeLease = null;
    transitionRecord(record, 'quarantined', 'bilibili_video_discussion_interaction_outcome_unknown');
    input.emit(
      'bilibili_video_discussion_interaction_outcome_unknown',
      'bilibili_video_discussion_interaction_outcome_unknown',
      request.actionId
    );
    throw hostError({
      code: 'bilibili_video_discussion_interaction_outcome_unknown',
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

function safeDiscussionPreconditionErrorCode(error: unknown): string {
  const candidate = error instanceof Error ? error.message : '';
  if (candidate === 'run_deadline_exceeded') return 'bilibili_video_discussion_interaction_precondition_timeout';
  return /^[a-z0-9_]{1,100}$/.test(candidate)
    ? candidate
    : 'bilibili_video_discussion_interaction_precondition_unmet';
}

function assertDiscussionPage(
  record: ManagedPageRecord,
  request: BilibiliVideoDiscussionInteractionRequest
): void {
  if (record.state !== 'leased') {
    throw hostError({ code: 'bilibili_video_discussion_interaction_page_not_ready', category: 'page_identity', scope: 'page' });
  }
  if (record.platform !== 'bilibili' || record.pageRole !== 'video_discussion') {
    throw hostError({ code: 'bilibili_video_discussion_interaction_page_role_rejected', category: 'page_identity', scope: 'page' });
  }
  if (record.documentGeneration !== request.expectedDocumentGeneration) {
    throw hostError({
      code: 'managed_page_document_generation_mismatch',
      category: 'page_identity',
      scope: 'page',
      retryClass: 'local_query_only'
    });
  }
  if (!matchesBilibiliVideoDiscussionPageIdentity(record.page.url(), request.bvid)) {
    throw hostError({
      code: 'bilibili_video_discussion_interaction_page_identity_unverified',
      category: 'page_identity',
      scope: 'page',
      retryClass: 'new_run_required'
    });
  }
}

function assertActionPrecondition(
  probe: DiscussionProbe,
  action: BilibiliVideoDiscussionInteractionAction
): void {
  if (action === 'select_latest_comments') {
    if (probe.dom.latestState !== 'inactive' || !probe.dom.targetPointerHit) {
      throw new Error('bilibili_video_discussion_latest_precondition_unmet');
    }
    return;
  }
  if (probe.dom.targetExpanded || probe.dom.replyPaginationVisible || !probe.dom.targetPointerHit) {
    throw new Error('bilibili_video_discussion_thread_precondition_unmet');
  }
}

function assertClickableTarget(probe: DiscussionProbe, action: BilibiliVideoDiscussionInteractionAction): void {
  if (!probe.dom.targetVisible || !probe.dom.targetInViewport || !probe.dom.targetPointerHit ||
    !probe.dom.targetHovered) {
    throw new Error(`bilibili_video_discussion_${action}_pointer_precondition_unmet`);
  }
}

async function waitForPostcondition(
  page: Page,
  request: BilibiliVideoDiscussionInteractionRequest,
  observations: readonly BilibiliVideoDiscussionInteractionNetworkObservation[],
  deadline: number
): Promise<DiscussionProbe> {
  let latest: DiscussionProbe | null = null;
  while (Date.now() < deadline) {
    latest = await readProbe(page, request.action, remaining(deadline));
    const routeSeen = observations.some((observation) => observation.status >= 200 && observation.status < 300);
    const domReady = request.action === 'select_latest_comments'
      ? latest.dom.latestState === 'active'
      : latest.dom.targetExpanded && latest.dom.replyPaginationVisible;
    if (domReady && routeSeen) return latest;
    if (latest.dom.verificationRequired || latest.dom.rateLimited || latest.dom.sourceUnavailable) break;
    await delay(Math.min(PROBE_INTERVAL_MS, Math.max(1, deadline - Date.now())));
  }
  throw new Error('bilibili_video_discussion_interaction_postcondition_unmet');
}

async function waitForProbe(
  page: Page,
  request: BilibiliVideoDiscussionInteractionRequest,
  deadline: number,
  ready: (probe: DiscussionProbe) => boolean
): Promise<DiscussionProbe> {
  let latest: DiscussionProbe | null = null;
  while (Date.now() < deadline) {
    latest = await readProbe(page, request.action, remaining(deadline));
    if (ready(latest)) return latest;
    if (latest.dom.verificationRequired || latest.dom.rateLimited || latest.dom.sourceUnavailable) return latest;
    await delay(Math.min(PROBE_INTERVAL_MS, Math.max(1, deadline - Date.now())));
  }
  if (!latest) throw new Error('bilibili_video_discussion_interaction_probe_unavailable');
  return latest;
}

async function readProbe(page: Page, action: BilibiliVideoDiscussionInteractionAction, timeoutMs: number): Promise<DiscussionProbe> {
  const value = await withinDeadline(page.evaluate((targetAction) => {
    const clean = (value: string | null | undefined, maximum: number): string =>
      (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
    const rendered = (element: Element | null): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.01;
    };
    const composedText = (node: Node, maximum = 20_000): string => {
      let remaining = maximum;
      const visit = (candidate: Node): string => {
        if (remaining <= 0) return '';
        if (candidate.nodeType === Node.TEXT_NODE) {
          const text = (candidate.textContent ?? '').slice(0, remaining);
          remaining -= text.length;
          return text;
        }
        if (!(candidate instanceof Element || candidate instanceof DocumentFragment)) return '';
        if (candidate instanceof Element && ['STYLE', 'SCRIPT', 'TEMPLATE'].includes(candidate.tagName)) return '';
        const source = candidate instanceof Element ? candidate.shadowRoot ?? candidate : candidate;
        const parts: string[] = [];
        for (const child of Array.from(source.childNodes)) {
          if (remaining <= 0) break;
          parts.push(visit(child));
        }
        return parts.join(' ');
      };
      return visit(node);
    };
    const findComposed = (
      root: Element,
      predicate: (element: Element) => boolean,
      maximumNodes = 2_000
    ): Element | null => {
      let visited = 0;
      const visit = (container: Element | ShadowRoot): Element | null => {
        for (const element of Array.from(container.children)) {
          visited += 1;
          if (visited > maximumNodes) return null;
          if (predicate(element)) return element;
          if (element.shadowRoot) {
            const shadowMatch = visit(element.shadowRoot);
            if (shadowMatch) return shadowMatch;
          }
          const lightMatch = visit(element);
          if (lightMatch) return lightMatch;
        }
        return null;
      };
      if (predicate(root)) return root;
      if (root.shadowRoot) {
        const shadowMatch = visit(root.shadowRoot);
        if (shadowMatch) return shadowMatch;
      }
      return visit(root);
    };
    const renderedControl = (element: Element): boolean =>
      rendered(element) || Boolean(element.shadowRoot &&
        Array.from(element.shadowRoot.querySelectorAll('*')).some((candidate) => rendered(candidate)));
    const interactive = (element: Element): boolean => {
      const tag = element.tagName.toLowerCase();
      return tag === 'bili-text-button' || tag === 'button' || element.getAttribute('role') === 'button';
    };
    const stateOf = (element: Element | null): 'active' | 'inactive' | 'unknown' => {
      if (!element) return 'unknown';
      const candidates = [element, ...Array.from(element.querySelectorAll('*'))];
      for (const candidate of candidates) {
        const pressed = candidate.getAttribute('aria-pressed') ?? candidate.getAttribute('aria-selected');
        if (pressed === 'true') return 'active';
        if (pressed === 'false') return 'inactive';
        if (candidate.classList.contains('active') || candidate.classList.contains('selected') ||
          candidate.classList.contains('is-active') || candidate.classList.contains('is-selected')) return 'active';
      }
      return 'unknown';
    };
    const targetFor = (root: Element, label: string): Element | null =>
      findComposed(root, (element) => interactive(element) && renderedControl(element) &&
        clean(composedText(element), 100) === label);
    const host = document.querySelector<HTMLElement>('#commentapp');
    const commentRoot = host?.querySelector<HTMLElement>('bili-comments') ?? null;
    const commentText = clean(composedText(commentRoot ?? host ?? document.body), 20_000);
    const firstThread = commentRoot
      ? findComposed(commentRoot, (element) =>
        element.tagName.toLowerCase() === 'bili-comment-thread-renderer' && rendered(element), 3_000)
      : null;
    let target: Element | null = null;
    let latestControl: Element | null = null;
    let targetExpanded = false;
    let replyPaginationVisible = false;
    if (targetAction === 'select_latest_comments') {
      const header = commentRoot
        ? findComposed(commentRoot, (element) => element.tagName.toLowerCase() === 'bili-comments-header-renderer', 400)
        : null;
      latestControl = targetFor(header ?? commentRoot ?? host ?? document.body, '最新');
      target = latestControl;
    } else {
      const replyRenderer = firstThread
        ? findComposed(firstThread, (element) =>
          element.tagName.toLowerCase() === 'bili-comment-replies-renderer' && rendered(element), 800)
        : null;
      target = replyRenderer ? targetFor(replyRenderer, '点击查看') : null;
      targetExpanded = Boolean(replyRenderer &&
        (/收起|下一页|共\s*\d+\s*页/.test(clean(composedText(replyRenderer), 10_000)) ||
          stateOf(replyRenderer) === 'active'));
      replyPaginationVisible = Boolean(replyRenderer && /下一页|共\s*\d+\s*页|收起/.test(clean(composedText(replyRenderer), 10_000)));
    }
    const rect = target?.getBoundingClientRect() ?? null;
    const bounds = rect && rect.width > 0 && rect.height > 0
      ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
      : null;
    const centerX = rect ? Math.floor(rect.x + rect.width / 2) : -1;
    const centerY = rect ? Math.floor(rect.y + rect.height / 2) : -1;
    const hit = rect ? document.elementFromPoint(centerX, centerY) : null;
    const isComposedAncestor = (candidate: Element | null, descendant: Element | null): boolean => {
      if (!candidate || !descendant) return false;
      let current: Node | null = descendant;
      while (current) {
        if (current === candidate) return true;
        if (current.parentNode) {
          current = current.parentNode;
          continue;
        }
        const root = current.getRootNode();
        current = root instanceof ShadowRoot ? root.host : null;
      }
      return false;
    };
    const composedHovered = (element: Element | null): boolean => {
      if (!element) return false;
      if (element.matches(':hover') || Array.from(element.querySelectorAll('*')).some((candidate) => candidate.matches(':hover'))) {
        return true;
      }
      let current: Node | null = element;
      while (current) {
        if (current instanceof Element && current.matches(':hover')) return true;
        const root = current.getRootNode();
        current = root instanceof ShadowRoot ? root.host : current.parentNode;
      }
      return false;
    };
    return {
      dom: {
        commentHostPresent: Boolean(host && commentRoot),
        commentHostVisible: Boolean(commentRoot && rendered(commentRoot)),
        commentHostInViewport: Boolean(host && (() => { const r = host.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; })()),
        loginGateVisible: /登录后查看|登录参与社区互动/.test(commentText),
        verificationRequired: /验证码|安全验证|完成验证|请进行验证|异常访问/.test(commentText),
        rateLimited: /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(commentText),
        sourceUnavailable: /页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(commentText),
        latestState: stateOf(latestControl),
        targetVisible: Boolean(target && renderedControl(target)),
        targetInViewport: Boolean(rect && rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth),
        targetBounds: bounds,
        targetPointerHit: Boolean(hit && target && (hit === target || target.contains(hit) ||
          isComposedAncestor(hit, target) || isComposedAncestor(target, hit))),
        targetHovered: composedHovered(target),
        targetExpanded,
        rootCommentCount: firstThread ? 1 : 0,
        replyPaginationVisible
      }
    };
  }, action), timeoutMs);
  return validateProbe(value);
}

function validateProbe(value: unknown): DiscussionProbe {
  if (!value || typeof value !== 'object' || !('dom' in value) || !value.dom || typeof value.dom !== 'object') {
    throw new Error('bilibili_video_discussion_interaction_probe_invalid');
  }
  const dom = value.dom as Record<string, unknown>;
  const bounds = dom.targetBounds;
  const boundRecord = bounds && typeof bounds === 'object' ? bounds as Record<string, unknown> : null;
  const boundX = typeof boundRecord?.x === 'number' && Number.isSafeInteger(boundRecord.x) ? boundRecord.x : null;
  const boundY = typeof boundRecord?.y === 'number' && Number.isSafeInteger(boundRecord.y) ? boundRecord.y : null;
  const boundWidth = typeof boundRecord?.width === 'number' && Number.isSafeInteger(boundRecord.width) ? boundRecord.width : null;
  const boundHeight = typeof boundRecord?.height === 'number' && Number.isSafeInteger(boundRecord.height) ? boundRecord.height : null;
  const targetBounds = boundX !== null && boundY !== null && boundWidth !== null && boundHeight !== null
    ? { x: boundX, y: boundY, width: boundWidth, height: boundHeight }
    : null;
  const latestState = dom.latestState;
  const rootCommentCount = dom.rootCommentCount;
  if ((latestState !== 'active' && latestState !== 'inactive' && latestState !== 'unknown') ||
    typeof dom.commentHostPresent !== 'boolean' || typeof dom.commentHostVisible !== 'boolean' ||
    typeof dom.commentHostInViewport !== 'boolean' || typeof dom.loginGateVisible !== 'boolean' ||
    typeof dom.verificationRequired !== 'boolean' || typeof dom.rateLimited !== 'boolean' ||
    typeof dom.sourceUnavailable !== 'boolean' || typeof dom.targetVisible !== 'boolean' ||
    typeof dom.targetInViewport !== 'boolean' || typeof dom.targetPointerHit !== 'boolean' ||
    typeof dom.targetHovered !== 'boolean' || typeof dom.targetExpanded !== 'boolean' ||
    typeof dom.replyPaginationVisible !== 'boolean' || typeof rootCommentCount !== 'number' ||
    !Number.isSafeInteger(rootCommentCount) || rootCommentCount < 0 || rootCommentCount > 20) {
    throw new Error('bilibili_video_discussion_interaction_probe_invalid');
  }
  return {
    dom: {
      commentHostPresent: dom.commentHostPresent,
      commentHostVisible: dom.commentHostVisible,
      commentHostInViewport: dom.commentHostInViewport,
      loginGateVisible: dom.loginGateVisible,
      verificationRequired: dom.verificationRequired,
      rateLimited: dom.rateLimited,
      sourceUnavailable: dom.sourceUnavailable,
      latestState,
      targetVisible: dom.targetVisible,
      targetInViewport: dom.targetInViewport,
      targetBounds,
      targetPointerHit: dom.targetPointerHit,
      targetHovered: dom.targetHovered,
      targetExpanded: dom.targetExpanded,
      rootCommentCount,
      replyPaginationVisible: dom.replyPaginationVisible
    }
  };
}

function routeObservation(
  response: Response,
  action: BilibiliVideoDiscussionInteractionAction
): BilibiliVideoDiscussionInteractionNetworkObservation | null {
  try {
    const request = response.request();
    if (request.method() !== 'GET') return null;
    const url = new URL(response.url());
    const expectedPath = TARGET_ROUTES[action];
    if (url.origin !== 'https://api.bilibili.com' || url.pathname !== expectedPath) return null;
    return { method: 'GET', origin: 'https://api.bilibili.com', path: expectedPath, status: response.status(), receivedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}

async function captureEvidence(record: ManagedPageRecord, directory: string, timeoutMs: number): Promise<PageVisualEvidence> {
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
  if (value < 100) throw new Error('run_deadline_exceeded');
  return value;
}

async function withinDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('run_deadline_exceeded')), timeoutMs))
  ]);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
