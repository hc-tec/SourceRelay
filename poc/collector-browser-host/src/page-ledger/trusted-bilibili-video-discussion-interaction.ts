import type { Page, Response } from 'playwright';
import {
  BrowserHostError,
  BILIBILI_VIDEO_DISCUSSION_INTERACTION_ACTIONS,
  BILIBILI_VIDEO_DISCUSSION_MAX_REPLY_ITEMS,
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
const TARGET_ROUTES: Partial<Record<
  BilibiliVideoDiscussionInteractionAction,
  BilibiliVideoDiscussionInteractionNetworkObservation['path']
>> = {
  select_latest_comments: '/x/v2/reply/wbi/main',
  expand_first_thread: '/x/v2/reply/reply',
  expand_second_thread: '/x/v2/reply/reply',
  next_first_thread_page: '/x/v2/reply/reply',
  next_second_thread_page: '/x/v2/reply/reply'
};

function threadOrdinalForAction(action: BilibiliVideoDiscussionInteractionAction): number {
  return action === 'expand_second_thread' || action === 'reveal_second_thread' ||
    action === 'reveal_second_thread_pagination' ||
    action === 'next_second_thread_page' ? 1 : 0;
}

function isNextReplyPageAction(action: BilibiliVideoDiscussionInteractionAction): boolean {
  return action === 'next_first_thread_page' || action === 'next_second_thread_page';
}

function isRevealReplyPaginationAction(action: BilibiliVideoDiscussionInteractionAction): boolean {
  return action === 'reveal_first_thread_pagination' || action === 'reveal_second_thread_pagination';
}

function isRevealSecondThreadAction(action: BilibiliVideoDiscussionInteractionAction): boolean {
  return action === 'reveal_second_thread';
}

function isRevealAction(action: BilibiliVideoDiscussionInteractionAction): boolean {
  return isRevealReplyPaginationAction(action) || isRevealSecondThreadAction(action);
}

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
 * Executes one source-specific, browser-trusted discussion input. The caller
 * supplies only a semantic action. Click actions discover the live open Shadow
 * DOM target and recheck its bounds after pointer movement. The explicit
 * pagination-reveal action is a single bounded wheel and never a hidden page
 * click. Only route metadata for a corresponding public response is kept.
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
  let wheelOutcomeConfirmed = false;
  let wheelDeltaY: number | null = null;
  try {
    let beforeProbe = await waitForProbe(record.page, request, deadline, (candidate) =>
      candidate.dom.commentHostPresent && candidate.dom.commentHostVisible &&
      candidate.dom.commentHostInViewport && candidate.dom.targetVisible &&
      (isNextReplyPageAction(request.action)
        ? candidate.dom.targetBounds !== null && candidate.dom.targetInViewport
        : isRevealSecondThreadAction(request.action)
          ? candidate.dom.targetBounds !== null
          : isRevealReplyPaginationAction(request.action)
          ? candidate.dom.targetBounds !== null && candidate.dom.targetExpanded
          : candidate.dom.targetInViewport)
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

    if (isRevealAction(request.action)) {
      // The control may already be mounted and inside the viewport by the
      // time the independent reveal action is evaluated. Treat that as a
      // completed local discovery, not as a reason to send an unnecessary
      // wheel. The following next-page action will still perform its own
      // fresh hover/hit-test before clicking.
      const revealAlreadyReady = isRevealSecondThreadAction(request.action)
        ? beforeProbe.dom.rootCommentCount >= 2 && beforeProbe.dom.targetInViewport
        : beforeProbe.dom.replyNextPageVisible && beforeProbe.dom.targetInViewport;
      if (revealAlreadyReady) {
        const afterProbe = await readProbe(record.page, request.action, remaining(deadline));
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
          inputKind: 'none',
          bvid: request.bvid,
          threadOrdinal: threadOrdinalForAction(request.action),
          clickAttempted: false,
          wheelDeltaY: null,
          completedAt: new Date().toISOString(),
          before: {
            dom: beforeProbe.dom,
            targetBounds,
            pointerHitTarget: beforeProbe.dom.targetPointerHit,
            pointerHoveredTarget: beforeProbe.dom.targetHovered,
            visualEvidence: beforeVisualEvidence
          },
          after: { dom: afterProbe.dom, visualEvidence: afterVisualEvidence },
          network: { observations: [] }
        };
      }
      const viewportHeight = await withinDeadline(
        record.page.evaluate(() => window.innerHeight),
        remaining(deadline)
      );
      const requiredDelta = targetBounds.y < 0
        ? targetBounds.y - 120
        : targetBounds.y + targetBounds.height - viewportHeight + 120;
      // When Bilibili has not mounted a next-page control yet, the reply
      // renderer's rect describes only the currently painted window. Use one
      // explicit bounded reveal wheel instead of pretending that rect is the
      // missing button's location. Once the real control exists, use its
      // smaller rect-derived delta to avoid unnecessary movement.
      const targetIsMissing = isRevealSecondThreadAction(request.action)
        ? beforeProbe.dom.rootCommentCount < 2
        : !beforeProbe.dom.replyNextPageVisible;
      wheelDeltaY = targetIsMissing
        ? 1_200
        : Math.sign(requiredDelta) === 0
          ? 240
          : Math.sign(requiredDelta) * Math.max(200, Math.min(1_200, Math.abs(Math.ceil(requiredDelta))));

      if (targetIsMissing) {
        // The first reply thread exposes a tall, lazily-mounted renderer. Put
        // the real pointer over the renderer's currently visible portion so
        // the trusted wheel follows the same nested-scroll path as a person;
        // do not use a synthetic event or an element.click fallback.
        const pointerX = Math.floor(targetBounds.x + targetBounds.width / 2);
        const pointerY = Math.max(10, Math.min(
          viewportHeight - 10,
          targetBounds.y + Math.min(targetBounds.height / 2, viewportHeight / 2)
        ));
        await withinDeadline(record.page.mouse.move(pointerX, pointerY), remaining(deadline));
      }

      record.attemptedActionIds.add(request.actionId);
      touchRecord(record);
      input.emit('action_attempted', null, request.actionId);
      browserInputAttempted = true;
      await withinDeadline(record.page.mouse.wheel(0, wheelDeltaY), remaining(deadline));
      // A successful local scroll-position read distinguishes a known wheel
      // outcome from a context loss. If the pagination control still does not
      // appear, the run can be retained for review without guessing a click.
      await withinDeadline(record.page.evaluate(() => window.scrollY), remaining(deadline));
      wheelOutcomeConfirmed = true;
      const afterProbe = await waitForPostcondition(record.page, request, [], beforeProbe, deadline);
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
        inputKind: 'wheel',
        bvid: request.bvid,
        threadOrdinal: threadOrdinalForAction(request.action),
        clickAttempted: false,
        wheelDeltaY,
        completedAt: new Date().toISOString(),
        before: {
          dom: beforeProbe.dom,
          targetBounds,
          pointerHitTarget: beforeProbe.dom.targetPointerHit,
          pointerHoveredTarget: beforeProbe.dom.targetHovered,
          visualEvidence: beforeVisualEvidence
        },
        after: { dom: afterProbe.dom, visualEvidence: afterVisualEvidence },
        network: { observations: [] }
      };
    }

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
      const afterProbe = await waitForPostcondition(record.page, request, observations, beforeProbe, deadline);
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
        inputKind: 'click',
        bvid: request.bvid,
        threadOrdinal: threadOrdinalForAction(request.action),
        clickAttempted: true,
        wheelDeltaY: null,
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
    if (isRevealAction(request.action) && wheelOutcomeConfirmed &&
      !(error instanceof BrowserHostError)) {
      throw hostError({
        code: 'bilibili_video_discussion_reply_pagination_reveal_postcondition_unmet',
        category: 'browser_input',
        scope: 'action',
        retryClass: 'local_query_only',
        platformActionAttempted: true,
        pageDisposition: 'retained_for_review',
        profileSafetyDisposition: 'ready',
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
  if (isRevealReplyPaginationAction(action)) {
    if (!probe.dom.targetExpanded ||
      probe.dom.replyHasMore === false || !probe.dom.targetVisible || !probe.dom.targetBounds) {
      throw new Error('bilibili_video_discussion_reply_page_reveal_precondition_unmet');
    }
    return;
  }
  if (isRevealSecondThreadAction(action)) {
    if (!probe.dom.targetVisible || !probe.dom.targetBounds) {
      throw new Error('bilibili_video_discussion_second_thread_reveal_precondition_unmet');
    }
    return;
  }
  if (isNextReplyPageAction(action)) {
    if (!probe.dom.targetExpanded || !probe.dom.replyPaginationVisible || !probe.dom.replyNextPageVisible ||
      probe.dom.replyHasMore === false || !probe.dom.targetPointerHit) {
      throw new Error('bilibili_video_discussion_reply_page_precondition_unmet');
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
  before: DiscussionProbe,
  deadline: number
): Promise<DiscussionProbe> {
  let latest: DiscussionProbe | null = null;
  while (Date.now() < deadline) {
    latest = await readProbe(page, request.action, remaining(deadline));
    const routeSeen = observations.some((observation) => observation.status >= 200 && observation.status < 300);
    const pageContentChanged = JSON.stringify(latest.dom.firstThreadReplies) !== JSON.stringify(before.dom.firstThreadReplies) ||
      latest.dom.replyPage !== before.dom.replyPage;
    const domReady = request.action === 'select_latest_comments'
      ? latest.dom.latestState === 'active'
      : isRevealReplyPaginationAction(request.action)
        ? latest.dom.targetExpanded && latest.dom.replyPaginationVisible && latest.dom.replyNextPageVisible &&
          latest.dom.targetInViewport
      : isRevealSecondThreadAction(request.action)
        ? latest.dom.rootCommentCount >= 2 && latest.dom.targetVisible && latest.dom.targetInViewport
      : isNextReplyPageAction(request.action)
        ? latest.dom.targetExpanded && latest.dom.replyPaginationVisible && pageContentChanged
        : latest.dom.targetExpanded && latest.dom.replyPaginationVisible;
    if (domReady && (isRevealAction(request.action) || routeSeen)) return latest;
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
  const value = await withinDeadline(page.evaluate((input) => {
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
        // Bilibili's bili-text-button keeps its visible label in the host's
        // light DOM and renders it through a Shadow DOM <slot>. Once the
        // composed walker enters the shadow root, childNodes alone no longer
        // contain the assigned label ("最热" / "最新"). Preserve the real
        // composed-tree semantics before falling back to shadow children.
        if (candidate instanceof HTMLSlotElement) {
          const assigned = candidate.assignedNodes({ flatten: true });
          if (assigned.length > 0) return assigned.map(visit).join(' ');
        }
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
    const findComposedAll = (
      root: Element,
      predicate: (element: Element) => boolean,
      maximumNodes = 3_000
    ): Element[] => {
      const matches: Element[] = [];
      let visited = 0;
      const visit = (container: Element | ShadowRoot): void => {
        for (const element of Array.from(container.children)) {
          visited += 1;
          if (visited > maximumNodes) return;
          if (predicate(element)) matches.push(element);
          if (element.shadowRoot) visit(element.shadowRoot);
          visit(element);
          if (visited > maximumNodes) return;
        }
      };
      if (predicate(root)) matches.push(root);
      if (root.shadowRoot) visit(root.shadowRoot);
      visit(root);
      return matches;
    };
    /**
     * Pagination controls are siblings of the visible reply renderers. Do
     * not spend the probe budget walking every reply's user/rich-text Shadow
     * DOM before looking for "下一页"; that made the first (large) thread
     * look as if its real control was absent and slowed ordinary expansion.
     */
    const findReplyPaginationAll = (
      root: Element,
      predicate: (element: Element) => boolean,
      maximumNodes = 1_200
    ): Element[] => {
      const matches: Element[] = [];
      let visited = 0;
      const visit = (container: Element | ShadowRoot): void => {
        for (const element of Array.from(container.children)) {
          visited += 1;
          if (visited > maximumNodes) return;
          if (predicate(element)) matches.push(element);
          // Reply item fields are data, not pagination controls. Keep the
          // search structural and bounded by skipping their deep renderer.
          if (element.tagName.toLowerCase() === 'bili-comment-reply-renderer') continue;
          if (element.shadowRoot) visit(element.shadowRoot);
          visit(element);
          if (visited > maximumNodes) return;
        }
      };
      if (predicate(root)) matches.push(root);
      if (root.shadowRoot) visit(root.shadowRoot);
      visit(root);
      return matches;
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
        const current = candidate.getAttribute('aria-current');
        if (current === 'page' || current === 'true') return 'active';
        if (candidate.classList.contains('active') || candidate.classList.contains('selected') ||
          candidate.classList.contains('is-active') || candidate.classList.contains('is-selected') ||
          candidate.classList.contains('current')) return 'active';
      }
      let current: Node | null = element;
      while (current) {
        if (current instanceof Element) {
          const pressed = current.getAttribute('aria-pressed') ?? current.getAttribute('aria-selected');
          if (pressed === 'true') return 'active';
          if (pressed === 'false') return 'inactive';
          const currentPage = current.getAttribute('aria-current');
          if (currentPage === 'page' || currentPage === 'true') return 'active';
          if (current.classList.contains('active') || current.classList.contains('selected') ||
            current.classList.contains('is-active') || current.classList.contains('is-selected') ||
            current.classList.contains('current')) return 'active';
        }
        if (current.parentNode) {
          current = current.parentNode;
          continue;
        }
        const root = current.getRootNode();
        current = root instanceof ShadowRoot ? root.host : null;
      }
      return 'unknown';
    };
    const sortModeOf = (element: Element | null): 'hot' | 'latest' | 'unknown' => {
      let current: Node | null = element;
      while (current) {
        if (current instanceof Element && current.id === 'sort-actions') {
          if (current.classList.contains('hot')) return 'hot';
          if (current.classList.contains('time') || current.classList.contains('latest')) return 'latest';
        }
        if (current.parentNode) {
          current = current.parentNode;
          continue;
        }
        const root = current.getRootNode();
        current = root instanceof ShadowRoot ? root.host : null;
      }
      return 'unknown';
    };
    const targetFor = (root: Element, label: string): Element | null =>
      findComposed(root, (element) => interactive(element) && renderedControl(element) &&
        clean(composedText(element), 100) === label);
    const parseLikeCount = (value: string | null): number | null => {
      const candidate = clean(value, 40);
      if (!candidate) return null;
      if (/^\d+$/.test(candidate)) {
        const parsed = Number(candidate);
        return Number.isSafeInteger(parsed) ? parsed : null;
      }
      const abbreviated = candidate.match(/^([\d.]+)\s*([万千])$/);
      if (!abbreviated) return null;
      const amount = Number(abbreviated[1]);
      const multiplier = abbreviated[2] === '万' ? 10_000 : 1_000;
      if (!Number.isFinite(amount)) return null;
      const parsed = Math.round(amount * multiplier);
      return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
    };
    const replyRecord = (renderer: Element): {
      author: string | null;
      content: string;
      publishedAt: string | null;
      likeCount: number | null;
    } | null => {
      const userName = findComposed(renderer, (element) =>
        element instanceof HTMLElement && element.id === 'user-name');
      const contents = findComposed(renderer, (element) =>
        element instanceof HTMLElement && element.id === 'contents');
      if (!contents) return null;
      const content = clean(composedText(contents), 4_000);
      if (!content) return null;
      const pubdate = findComposed(renderer, (element) =>
        element instanceof HTMLElement && element.id === 'pubdate');
      const count = findComposed(renderer, (element) =>
        element instanceof HTMLElement && element.id === 'count');
      return {
        author: userName ? (clean(composedText(userName), 200) || null) : null,
        content,
        publishedAt: pubdate ? (clean(composedText(pubdate), 100) || null) : null,
        likeCount: count ? parseLikeCount(composedText(count)) : null
      };
    };
    const host = document.querySelector<HTMLElement>('#commentapp');
    const commentRoot = host?.querySelector<HTMLElement>('bili-comments') ?? null;
    const commentText = clean(composedText(commentRoot ?? host ?? document.body), 20_000);
    const threadRenderers = commentRoot
      ? findComposedAll(commentRoot, (element) =>
        element.tagName.toLowerCase() === 'bili-comment-thread-renderer' && rendered(element), 3_000)
      : [];
    const threadOrdinal = input.action === 'expand_second_thread' ||
      input.action === 'reveal_second_thread' ||
      input.action === 'reveal_second_thread_pagination' ||
      input.action === 'next_second_thread_page' ? 1 : 0;
    const selectedThread = threadRenderers[threadOrdinal] ?? null;
    let target: Element | null = null;
    let latestControl: Element | null = null;
    let hotControl: Element | null = null;
    let targetExpanded = false;
    let replyPaginationVisible = false;
    let replyNextPageVisible = false;
    let firstThreadReplies: Array<{
      author: string | null;
      content: string;
      publishedAt: string | null;
      likeCount: number | null;
    }> = [];
    let replyPage: number | null = null;
    let replyPageCount: number | null = null;
    let replyHasMore: boolean | null = null;
    let replyCoverage: 'not_expanded' | 'current_page' | 'empty' | 'unknown' = 'not_expanded';
    if (input.action === 'select_latest_comments') {
      const header = commentRoot
        ? findComposed(commentRoot, (element) => element.tagName.toLowerCase() === 'bili-comments-header-renderer', 400)
        : null;
      latestControl = targetFor(header ?? commentRoot ?? host ?? document.body, '最新');
      hotControl = targetFor(header ?? commentRoot ?? host ?? document.body, '最热');
      target = latestControl;
    } else {
      const replyRenderer = selectedThread
        ? findComposed(selectedThread, (element) =>
          element.tagName.toLowerCase() === 'bili-comment-replies-renderer' && rendered(element), 800)
        : null;
      const expandTarget = replyRenderer ? targetFor(replyRenderer, '点击查看') : null;
      const nextButton = replyRenderer
        ? findReplyPaginationAll(replyRenderer, (element) => renderedControl(element) && interactive(element) &&
          /下一页/.test(clean(composedText(element), 20)), 500)[0] ?? null
        : null;
      const nextReplyPage = input.action === 'next_first_thread_page' || input.action === 'next_second_thread_page';
      const revealSecondThread = input.action === 'reveal_second_thread';
      const revealReplyPagination = input.action === 'reveal_first_thread_pagination' ||
        input.action === 'reveal_second_thread_pagination';
      // A reveal action targets the already-expanded reply renderer when the
      // next control is not mounted yet; once mounted, the live next control
      // becomes the target used for the postcondition read.
      target = nextReplyPage ? nextButton : revealReplyPagination ? (nextButton ?? replyRenderer) :
        revealSecondThread ? (expandTarget ?? selectedThread ?? commentRoot ?? host) : expandTarget;
      const replyText = clean(replyRenderer ? composedText(replyRenderer) : '', 20_000);
      const expandVisible = Boolean(expandTarget);
      const replyRenderers = replyRenderer
        ? findComposedAll(replyRenderer, (element) =>
          element.tagName.toLowerCase() === 'bili-comment-reply-renderer' && rendered(element), 2_000)
        : [];
      const replyRecords = replyRenderers
        .slice(0, input.maxReplyItems)
        .map(replyRecord)
        .filter((value): value is NonNullable<ReturnType<typeof replyRecord>> => value !== null);
      const activePageButton = replyRenderer
        ? findReplyPaginationAll(replyRenderer, (element) => renderedControl(element) && interactive(element) &&
          /^\d+$/.test(clean(composedText(element), 20)), 500)
          .find((element) => stateOf(element) === 'active')
        : null;
      const activePageText = activePageButton ? clean(composedText(activePageButton), 20) : null;
      const pageMatch = replyText.match(/第\s*(\d+)\s*页/);
      const pageCountMatch = replyText.match(/共\s*(\d+)\s*页/);
      const slashMatch = replyText.match(/(?:^|\s)(\d+)\s*\/\s*(\d+)(?:\s|$)/);
      replyPage = pageMatch ? Number(pageMatch[1])
        : slashMatch ? Number(slashMatch[1])
          : activePageText ? Number(activePageText)
            : null;
      replyPageCount = pageCountMatch ? Number(pageCountMatch[1]) : slashMatch ? Number(slashMatch[2]) : null;
      const collapseButton = replyRenderer
        ? findReplyPaginationAll(replyRenderer, (element) => renderedControl(element) && interactive(element) &&
          /收起/.test(clean(composedText(element), 20)), 500)[0] ?? null
        : null;
      const nextDisabled = Boolean(nextButton && (
        nextButton.getAttribute('aria-disabled') === 'true' ||
        nextButton.hasAttribute('disabled') ||
        nextButton.classList.contains('disabled') ||
        nextButton.classList.contains('is-disabled')
      ));
      replyNextPageVisible = Boolean(nextButton && renderedControl(nextButton));
      const visiblePaginationText = Boolean(replyRenderer && findReplyPaginationAll(replyRenderer, (element) =>
        renderedControl(element) && /第\s*\d+\s*页|共\s*\d+\s*页|上一页/.test(clean(composedText(element), 100)), 500).length > 0);
      replyPaginationVisible = Boolean(replyRenderer && (nextButton || collapseButton || activePageButton || visiblePaginationText));
      targetExpanded = Boolean(replyRenderer && !expandVisible && (
        replyPaginationVisible || replyRenderers.length > 0 || stateOf(replyRenderer) === 'active'
      ));
      if (targetExpanded) {
        firstThreadReplies = replyRecords;
        replyCoverage = replyRecords.length > 0 ? 'current_page' : replyPaginationVisible ? 'empty' : 'unknown';
        replyHasMore = replyPage !== null && replyPageCount !== null
          ? replyPage < replyPageCount
          : nextButton
            ? !nextDisabled
            : null;
      }
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
    const latestState = stateOf(latestControl);
    const hotState = stateOf(hotControl);
    const sortMode = sortModeOf(latestControl ?? hotControl);
    const resolvedLatestState = sortMode === 'hot'
      ? 'inactive' as const
      : sortMode === 'latest'
        ? 'active' as const
        : latestState === 'unknown' && hotState === 'active'
          ? 'inactive' as const
          : latestState;
    return {
      dom: {
        commentHostPresent: Boolean(host && commentRoot),
        commentHostVisible: Boolean(commentRoot && rendered(commentRoot)),
        commentHostInViewport: Boolean(host && (() => { const r = host.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; })()),
        loginGateVisible: /登录后查看|登录参与社区互动/.test(commentText),
        verificationRequired: /验证码|安全验证|完成验证|请进行验证|异常访问/.test(commentText),
        rateLimited: /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(commentText),
        sourceUnavailable: /页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(commentText),
        latestState: resolvedLatestState,
        targetVisible: Boolean(target && renderedControl(target)),
        targetInViewport: Boolean(rect && rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth),
        targetBounds: bounds,
        targetPointerHit: Boolean(hit && target && (hit === target || target.contains(hit) ||
          isComposedAncestor(hit, target) || isComposedAncestor(target, hit))),
        targetHovered: composedHovered(target),
        targetExpanded,
        threadOrdinal,
        rootCommentCount: threadRenderers.length,
        replyPaginationVisible,
        replyNextPageVisible,
        firstThreadReplies,
        replyPage,
        replyPageCount,
        replyHasMore,
        replyCoverage
      }
    };
  }, { action, maxReplyItems: BILIBILI_VIDEO_DISCUSSION_MAX_REPLY_ITEMS }), timeoutMs);
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
  const threadOrdinal = dom.threadOrdinal;
  const rootCommentCount = dom.rootCommentCount;
  const firstThreadReplies = dom.firstThreadReplies;
  const replyPage = dom.replyPage;
  const replyPageCount = dom.replyPageCount;
  const replyHasMore = dom.replyHasMore;
  const replyCoverage = dom.replyCoverage;
  const validReplies = Array.isArray(firstThreadReplies) && firstThreadReplies.length <= BILIBILI_VIDEO_DISCUSSION_MAX_REPLY_ITEMS &&
    firstThreadReplies.every((reply) => reply && typeof reply === 'object' &&
      (reply.author === null || typeof reply.author === 'string') && typeof reply.content === 'string' &&
      reply.content.length > 0 && reply.content.length <= 4_000 &&
      (reply.publishedAt === null || typeof reply.publishedAt === 'string') &&
      (reply.likeCount === null || (typeof reply.likeCount === 'number' && Number.isSafeInteger(reply.likeCount) && reply.likeCount >= 0)));
  const validPage = (value: unknown): value is number => value === null ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 100_000);
  if ((latestState !== 'active' && latestState !== 'inactive' && latestState !== 'unknown') ||
    typeof dom.commentHostPresent !== 'boolean' || typeof dom.commentHostVisible !== 'boolean' ||
    typeof dom.commentHostInViewport !== 'boolean' || typeof dom.loginGateVisible !== 'boolean' ||
    typeof dom.verificationRequired !== 'boolean' || typeof dom.rateLimited !== 'boolean' ||
    typeof dom.sourceUnavailable !== 'boolean' || typeof dom.targetVisible !== 'boolean' ||
    typeof dom.targetInViewport !== 'boolean' || typeof dom.targetPointerHit !== 'boolean' ||
    typeof dom.targetHovered !== 'boolean' || typeof dom.targetExpanded !== 'boolean' ||
    typeof dom.replyPaginationVisible !== 'boolean' || typeof dom.replyNextPageVisible !== 'boolean' || !validReplies ||
    !validPage(replyPage) || !validPage(replyPageCount) ||
    (replyHasMore !== null && typeof replyHasMore !== 'boolean') ||
    (replyCoverage !== 'not_expanded' && replyCoverage !== 'current_page' &&
      replyCoverage !== 'empty' && replyCoverage !== 'unknown') || typeof rootCommentCount !== 'number' ||
    !Number.isSafeInteger(rootCommentCount) || rootCommentCount < 0 || rootCommentCount > 20 ||
    typeof threadOrdinal !== 'number' || !Number.isSafeInteger(threadOrdinal) || threadOrdinal < 0 || threadOrdinal > 1) {
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
      threadOrdinal,
      targetExpanded: dom.targetExpanded,
      rootCommentCount,
      replyPaginationVisible: dom.replyPaginationVisible,
      replyNextPageVisible: dom.replyNextPageVisible,
      firstThreadReplies: firstThreadReplies as BilibiliVideoDiscussionInteractionDomState['firstThreadReplies'],
      replyPage,
      replyPageCount,
      replyHasMore,
      replyCoverage
    }
  };
}

function routeObservation(
  response: Response,
  action: BilibiliVideoDiscussionInteractionAction
): BilibiliVideoDiscussionInteractionNetworkObservation | null {
  try {
    if (isRevealAction(action)) return null;
    const request = response.request();
    if (request.method() !== 'GET') return null;
    const url = new URL(response.url());
    const expectedPath = TARGET_ROUTES[action];
    if (!expectedPath || url.origin !== 'https://api.bilibili.com' || url.pathname !== expectedPath) return null;
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
