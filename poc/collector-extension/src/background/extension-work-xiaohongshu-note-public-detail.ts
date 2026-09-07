import {
  classifyXiaohongshuCurrentPageRisk,
  xiaohongshuCurrentPageNetworkPublicSurface,
  XIAOHONGSHU_NOTE_PUBLIC_COMMENTS_BUDGET,
  type XiaohongshuNotePublicDetailProjection,
  XIAOHONGSHU_NOTE_PUBLIC_COMMENT_REPLIES_BUDGET,
  XIAOHONGSHU_NOTE_PUBLIC_COMMENT_REPLIES_MULTI_BUDGET,
  type XiaohongshuNotePublicCommentRepliesWorkItem,
  type XiaohongshuNotePublicCommentsWorkItem,
  type XiaohongshuNotePublicDetailTerminalReason,
  type XiaohongshuNotePublicDetailWorkItem,
  type XiaohongshuNotePublicDetailWorkResult
} from '@intelligence/collector-contracts';
import {
  armXiaohongshuExistingPublicProfileWorkObserver,
  armXiaohongshuExistingSearchWorkObserver,
  bindXiaohongshuObserverSelectedNote,
  clearXiaohongshuWorkObserver,
  readXiaohongshuExistingSearchNoteDetailNetworkProjection
} from './xiaohongshu-current-page-network';
import {
  completeXiaohongshuNoteDetailClick,
  prepareXiaohongshuNoteDetailClick,
  recordXiaohongshuNoteDetailClickIntent
} from './xiaohongshu-note-detail-click-ledger';
import { executeXiaohongshuNotePublicCommentsExtensionWork } from './extension-work-xiaohongshu-note-public-comments';
import { executeXiaohongshuNotePublicCommentRepliesExtensionWork } from './extension-work-xiaohongshu-note-public-comment-replies';
import {
  activateManagedWorkTabIfInactive,
  commitXiaohongshuNoteOverlayNavigation,
  prepareXiaohongshuNoteOverlayNavigation,
  prepareXiaohongshuSearchSurfaceNavigation
} from './extension-work-tabs';
import { attachDebuggerBounded, DEBUGGER_CLEANUP_TIMEOUT_MS, detachDebuggerBounded, sendDebuggerCommandBounded } from './bounded-debugger';

// The platform renders the result feed lazily and currently wraps note links
// in zero-size anchors; the click surface materializes on the card a beat
// after the search postcondition, and covers lazy-load only near the
// viewport. Poll with bounded scroll-into-view passes before declaring the
// rank unavailable.
const RANK_DETAIL_TARGET_READY_WINDOW_MS = 15_000;
const RANK_DETAIL_TARGET_RETRY_MS = 500;

/**
 * Failure codes that will equally hit every following rank of a composed
 * depth run: platform gates, a lost/changed document, or broken debugger
 * input. The composed loop aborts on these instead of grinding through ranks
 * that cannot succeed. Everything else (one lazy card, one odd note) is
 * per-rank noise and must not discard the successful notes around it.
 */
export const XIAOHONGSHU_DEPTH_GATE_ERROR_CODES: ReadonlySet<string> = new Set([
  'xiaohongshu_login_required',
  'xiaohongshu_verification_required',
  'xiaohongshu_rate_limited',
  'xiaohongshu_source_unavailable',
  'xiaohongshu_public_search_document_changed',
  'xiaohongshu_public_search_document_changed_before_detail',
  'xiaohongshu_public_search_document_unavailable',
  'xiaohongshu_public_search_tab_required',
  'xiaohongshu_public_search_tab_ambiguous',
  'xiaohongshu_public_profile_tab_required',
  'xiaohongshu_public_profile_tab_ambiguous',
  'xiaohongshu_note_detail_new_tab_detected',
  'debugger_attach_failed',
  'debugger_input_failed'
]);

interface DetailDocument { tabId: number; windowId: number; documentId: string }
interface Target { x: number; y: number; noteId: string }
interface DocumentContinuity {
  documentId: string;
  timeOrigin: number;
}
interface DomProjection {
  publicText: string;
  authorNickname: string;
  interactionText: string;
  visibleMediaCount: number;
  commentEntryVisible: boolean;
}

export async function executeXiaohongshuNotePublicDetailExtensionWork(
  item: XiaohongshuNotePublicDetailWorkItem,
  options: {
    closeOverlayAfterCapture?: boolean;
    collectComments?: { maximumScrolls: 1 | 2 | 3 };
    collectReplies?: { maximumThreads: 1 | 2 | 3 };
    /** Reuse a debugger lease already owned by the enclosing search action. */
    debuggee?: chrome.debugger.Debuggee;
    /** Internal managed-tab binding; never accepted from an AI request. */
    expectedTabId?: number;
    /** The enclosing managed search already foregrounded this tab. */
    skipForeground?: boolean;
    /** Rank-probe failure diagnostics sink (metadata-only counters). */
    onDiagnostic?: (errorCode: string, details: Record<string, unknown>) => void;
    /** Rank-target hints from the enclosing search projection (internal only):
     * cached DOM semantics are avoided, so when the platform changes card link
     * paths the enclosing search's known title/noteId can identify the card. */
    expectedTitle?: string;
    expectedNoteId?: string;
  } = {}
): Promise<XiaohongshuNotePublicDetailWorkResult> {
  let pageDocument: DetailDocument | null = null;
  let attached = false;
  let debuggerDetached = true;
  let attempted = false;
  let projection: XiaohongshuNotePublicDetailProjection | null = null;
  let pageReady = false;
  let errorCode: string | null = null;
  let overlayOpen = false;
  let overlayCleanup: XiaohongshuNotePublicDetailWorkResult['overlayCleanup'] = 'not_applicable';
  let commentsCapture: XiaohongshuNotePublicDetailProjection['commentsCapture'] = undefined;
  let repliesCapture: XiaohongshuNotePublicDetailProjection['repliesCapture'] = undefined;
  let debuggee: chrome.debugger.Debuggee | null = null;
  let continuityTimeOrigin = 0;
  let closeAttempted = false;
  const profileDocument = item.executionTarget === 'existing_public_profile_tab';
  // A detail click can route the document off the search surface; leaving the
  // overlay open silently destroyed the page state that the next sequential
  // operation (the next rank of a search-then-detail plan) depends on, which
  // surfaced as an instant `xiaohongshu_public_search_tab_required`. Restore
  // the surface we found, exactly like profile executions already do and the
  // composed depth loop does.
  const closeAfterCapture = options.closeOverlayAfterCapture || profileDocument ||
    item.executionTarget === 'existing_public_search_tab';
  try {
    pageDocument = profileDocument
      ? await findUniqueProfileDocument(options.expectedTabId)
      : await findUniqueSearchDocument(options.expectedTabId);
    if (!options.skipForeground) await foreground(pageDocument);
    try {
      await requireSameDocument(pageDocument, profileDocument);
    } catch {
      throw new Error('xiaohongshu_public_search_document_changed_before_detail');
    }
    const baseline = await readRisk(pageDocument);
    assertRisk(baseline);
    continuityTimeOrigin = (await readDocumentContinuity(pageDocument)).timeOrigin;
    const target = await findRankedDetailTarget(pageDocument, item.input.resultRank, {
      expectedTitle: options.expectedTitle,
      expectedNoteId: options.expectedNoteId
    }, options.onDiagnostic);
    prepareXiaohongshuNoteOverlayNavigation(pageDocument.tabId, target.noteId);
    if (profileDocument) {
      await armXiaohongshuExistingPublicProfileWorkObserver(pageDocument.tabId, item.workId);
    } else {
      await armXiaohongshuExistingSearchWorkObserver(pageDocument.tabId, item.workId);
    }
    await bindXiaohongshuObserverSelectedNote(pageDocument.tabId, item.workId, target.noteId);
    await prepareXiaohongshuNoteDetailClick(item.workId);
    debuggee = options.debuggee ?? { tabId: pageDocument.tabId };
    if (!options.debuggee) {
      await attachDebuggerBounded(debuggee, '1.3').catch(() => { throw new Error('debugger_attach_failed'); });
      attached = true;
      debuggerDetached = false;
    }
    const baselineChildTabIds = new Set((await chrome.tabs.query({}))
      .filter((tab) => tab.openerTabId === pageDocument!.tabId && typeof tab.id === 'number')
      .map((tab) => tab.id!));
    await recordXiaohongshuNoteDetailClickIntent(item.workId);
    attempted = true;
    try {
      await dispatchClick(debuggee, target);
    } catch (error) {
      if (!options.debuggee) throw new Error('debugger_input_failed');
      // The enclosing search's debugger lease can be dropped mid-depth-run
      // (external detach, transient CDP failure), which used to abort every
      // remaining rank as platform_gate. Rebuild the lease deterministically
      // and retry once; the re-attached lease is marked ours so the
      // finally-block detaches it.
      await detachDebuggerBounded(debuggee, DEBUGGER_CLEANUP_TIMEOUT_MS).catch(() => undefined);
      await attachDebuggerBounded(debuggee, '1.3').catch(() => { throw new Error('debugger_attach_failed'); });
      attached = true;
      debuggerDetached = false;
      await dispatchClick(debuggee, target).catch(() => { throw new Error('debugger_input_failed'); });
    }
    const dom = await waitForDomProjection(pageDocument, 6_000, options.expectedTitle, target.x, target.y);
    // Positive evidence the note overlay rendered. Only with this evidence is
    // a failure-path close click safe; without it the close-target finder
    // could mis-hit an unrelated search-page control.
    overlayOpen = true;
    const opened = (await chrome.tabs.query({}))
      .some((tab) => tab.openerTabId === pageDocument!.tabId && typeof tab.id === 'number' &&
        !baselineChildTabIds.has(tab.id));
    if (opened) throw new Error('xiaohongshu_note_detail_new_tab_detected');
    await completeXiaohongshuNoteDetailClick(item.workId);
    const detailTab = await chrome.tabs.get(pageDocument.tabId).catch(() => null);
    commitXiaohongshuNoteOverlayNavigation(pageDocument.tabId, target.noteId, detailTab?.url ?? '');
    const network = await readXiaohongshuExistingSearchNoteDetailNetworkProjection(
      pageDocument.tabId, item.workId, item.input.resultRank
    );
    // Network is the primary source; DOM only assists clicking and serves as
    // the last-resort fallback. The promotion guard is an identity check, not
    // a text-equality gate: accept the network payload when it matches the
    // DOM overlay text, or when it carries the rank's expected title (the
    // full-page DOM text carries search-page chrome, so prefix alignment
    // routinely fails and used to demote good network captures to a noisy
    // DOM fallback).
    const expectedTitleSample = (options.expectedTitle ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);
    const networkDetail = network.detail &&
      (publicTextMatchesDom(network.detail.publicText, dom.publicText) ||
        (expectedTitleSample.length >= 8 && network.detail.publicText.includes(expectedTitleSample)))
      ? network.detail : null;
    projection = {
      schemaVersion: 1,
      sourceRank: item.input.resultRank,
      captureMode: networkDetail ? 'network_projection' : 'dom_fallback',
      network: {
        matchedPayloadCount: network.matchedPayloadCount,
        bodyBytesRead: network.bodyBytesRead
      },
      publicText: networkDetail?.publicText ?? dom.publicText,
      authorNickname: networkDetail?.authorNickname || dom.authorNickname,
      interactionText: networkDetail?.interactionText || dom.interactionText,
      visibleMediaCount: dom.visibleMediaCount,
      commentEntryVisible: dom.commentEntryVisible,
      rawPayloadStored: false,
      responseUrlsStored: false
    };
    if (options.collectComments) {
      const commentsResult = await executeXiaohongshuNotePublicCommentsExtensionWork(
        createComposedCommentsWorkItem(item, options.collectComments.maximumScrolls),
        {
          page: pageDocument,
          debuggee,
          observerWorkId: item.workId,
          allowSearchOverlay: true,
          preserveObserver: options.collectReplies !== undefined
        }
      );
      if (commentsResult.state === 'completed' && commentsResult.projection) {
        projection = { ...projection, comments: commentsResult.projection };
        commentsCapture = commentsResult.evidence ?? 'captured';
      } else if (commentsResult.evidence === 'unconfirmed') {
        // The comment area produced no usable evidence within budget. The
        // note detail stands; the absence of `comments` records "unknown",
        // never "zero" — a slow-rendering discussion must not be written
        // into the artifact as an empty one.
        commentsCapture = 'unconfirmed';
      } else {
        throw new Error(commentsResult.errorCode ?? 'xiaohongshu_note_comments_postcondition_unmet');
      }
    }
    if (options.collectReplies) {
      const repliesResult = await executeXiaohongshuNotePublicCommentRepliesExtensionWork(
        createComposedRepliesWorkItem(item, options.collectReplies.maximumThreads),
        {
          page: pageDocument,
          debuggee,
          observerWorkId: item.workId,
          allowSearchOverlay: true,
          preserveObserver: true
        }
      );
      if (repliesResult.state === 'completed' && repliesResult.projection) {
        projection = {
          ...projection,
          ...(repliesResult.projections && repliesResult.projections.length > 1
            ? { replyThreads: repliesResult.projections, replyThread: repliesResult.projection! }
            : { replyThread: repliesResult.projection! })
        };
        repliesCapture = 'captured';
      } else if (repliesResult.errorCode === null || !XIAOHONGSHU_DEPTH_GATE_ERROR_CODES.has(repliesResult.errorCode)) {
        repliesCapture = 'unconfirmed';
      } else {
        throw new Error(repliesResult.errorCode ?? 'xiaohongshu_comment_replies_postcondition_unmet');
      }
    }
    projection = {
      ...projection,
      ...(commentsCapture === undefined ? {} : { commentsCapture }),
      ...(repliesCapture === undefined ? {} : { repliesCapture })
    };
    if (closeAfterCapture) {
      closeAttempted = true;
      prepareXiaohongshuSearchSurfaceNavigation(pageDocument.tabId);
      await closeDetailOverlay(pageDocument, debuggee, continuityTimeOrigin, profileDocument ? 'profile' : 'search');
      overlayCleanup = 'closed';
    }
    pageReady = true;
  } catch (error) {
    errorCode = safeErrorCode(error);
    // A failure after the overlay rendered must still close the overlay: an
    // open full-screen mask makes every further rank's card hit-test fail,
    // which is how one bad note used to cascade into the rest of a depth
    // run. Best effort — if this close also fails, the caller must abort the
    // remaining ranks (overlayCleanup 'unclosed') instead of walking into
    // the same mask. A close already attempted on the success path is never
    // repeated: a second click against an overlay that may be half-closed
    // risks a stray interaction with the underlying page.
    if (overlayOpen && pageDocument && debuggee) {
      if (closeAttempted) {
        overlayCleanup = 'unclosed';
      } else {
        try {
          await closeDetailOverlay(pageDocument, debuggee, continuityTimeOrigin, profileDocument ? 'profile' : 'search');
          overlayCleanup = 'closed';
        } catch {
          overlayCleanup = 'unclosed';
        }
      }
    }
  } finally {
    if (attached && pageDocument) {
      try {
        await detachDebuggerBounded({ tabId: pageDocument.tabId });
        debuggerDetached = true;
      } catch {
        debuggerDetached = false;
        errorCode = 'xiaohongshu_note_detail_debugger_detach_failed';
      }
    }
    if (pageDocument) await clearXiaohongshuWorkObserver(pageDocument.tabId, item.workId).catch(() => undefined);
  }
  const completed = errorCode === null && attempted && pageReady && projection !== null && debuggerDetached;
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    workId: item.workId,
    operationId: item.operationId,
    browserBindingId: item.browserBindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.note.public_detail.v1',
    executionTarget: item.executionTarget,
    state: completed ? 'completed' : 'stopped',
    errorCode: completed ? null : errorCode ?? 'xiaohongshu_note_detail_postcondition_unmet',
    terminalReason: completed ? 'note_detail_ready' : terminalReason(errorCode),
    completedAt: new Date().toISOString(),
    navigation: { attempted: false, attemptCount: 0 },
    semanticAction: { attempted, attemptCount: attempted ? 1 : 0 },
    page: pageReady ? { publicSurface: 'note_detail_overlay', sameDocument: true } : null,
    projection,
    overlayCleanup,
    rawPayloadStored: false,
    responseUrlsStored: false,
    debuggerDetached
  };
}

function publicTextMatchesDom(networkText: string, domText: string): boolean {
  const normalise = (value: string): string => value.replace(/\s+/g, ' ').trim();
  const network = normalise(networkText);
  const dom = normalise(domText);
  if (network.length < 20 || dom.length < 20) return false;
  const networkSample = network.slice(0, Math.min(96, network.length));
  const domSample = dom.slice(0, Math.min(96, dom.length));
  return dom.includes(networkSample) || network.includes(domSample);
}

function createComposedCommentsWorkItem(
  detailItem: XiaohongshuNotePublicDetailWorkItem,
  maximumScrolls: 1 | 2 | 3
): XiaohongshuNotePublicCommentsWorkItem {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    workId: crypto.randomUUID(),
    operationId: detailItem.operationId,
    browserBindingId: detailItem.browserBindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.note.public_comments.v1',
    executionTarget: 'existing_public_note_overlay',
    issuedAt: new Date().toISOString(),
    expiresAt: detailItem.expiresAt,
    input: { maximumScrolls },
    budget: XIAOHONGSHU_NOTE_PUBLIC_COMMENTS_BUDGET,
    gatewaySignature: 'a'.repeat(64)
  };
}

function createComposedRepliesWorkItem(
  detailItem: XiaohongshuNotePublicDetailWorkItem,
  maximumThreads: 1 | 2 | 3
): XiaohongshuNotePublicCommentRepliesWorkItem {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    workId: crypto.randomUUID(),
    operationId: detailItem.operationId,
    browserBindingId: detailItem.browserBindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.note.public_comment_replies.v1',
    executionTarget: 'existing_public_note_overlay',
    issuedAt: new Date().toISOString(),
    expiresAt: detailItem.expiresAt,
    input: { maximumThreads },
    budget: maximumThreads === 1
      ? XIAOHONGSHU_NOTE_PUBLIC_COMMENT_REPLIES_BUDGET
      : XIAOHONGSHU_NOTE_PUBLIC_COMMENT_REPLIES_MULTI_BUDGET,
    gatewaySignature: 'a'.repeat(64)
  };
}

/**
 * Depth collection reuses the same search document for several ranked notes.
 * The detail click itself is still at-most-once; after the projection is read
 * we discover the visible public close control and click it once through the
 * browser input layer. A failed or unknown cleanup is terminal for that depth
 * run, never a reason to click another card.
 */
async function closeDetailOverlay(
  pageDocument: DetailDocument,
  debuggee: chrome.debugger.Debuggee,
  timeOriginBefore: number,
  expectedSurface: 'search' | 'profile'
): Promise<void> {
  // Keep the completed detail (and any requested comments/replies) visibly
  // settled for one second before issuing the close click. This prevents the
  // automated detail flow from appearing as an open-and-immediately-disappear
  // interaction and gives the page one final paint opportunity.
  await delay(1_000);
  const closeTarget = await findDetailCloseTarget(pageDocument);
  if (!closeTarget) throw new Error('xiaohongshu_note_detail_close_target_unavailable');
  await dispatchClick(debuggee, closeTarget);
  // The platform may keep the overlay mounted through a multi-second close
  // sequence (fade plus a search-page settle) that can exceed a tight poll
  // window even though the close click already landed. Poll longer before
  // declaring the run failed.
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const state = await readCloseContinuity(pageDocument.tabId).catch(() => null);
    if (state && state.timeOrigin !== timeOriginBefore) {
      throw new Error('xiaohongshu_public_search_document_changed_during_close');
    }
    if (state && state.surface === expectedSurface && state.overlayVisible === false && state.renderedCardCount > 0) return;
    await delay(150);
  }
  throw new Error('xiaohongshu_note_detail_overlay_close_postcondition_unmet');
}

async function findDetailCloseTarget(pageDocument: DetailDocument): Promise<Target | null> {
  const results = await chrome.scripting.executeScript({
    target: { tabId: pageDocument.tabId, documentIds: [pageDocument.documentId] },
    func: () => {
      const visible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
          style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.01;
      };
      const candidates = Array.from(document.querySelectorAll(
        'button, [role="button"], [aria-label], [title], [class*="close"], [class*="Close"], svg, path'
      )).filter(visible).map((rawElement) => {
        const element = rawElement.closest(
          'button, [role="button"], [aria-label], [title], [class*="close"], [class*="Close"]'
        ) ?? rawElement;
        if (!visible(element)) return null;
        const rect = element.getBoundingClientRect();
        const label = [element.getAttribute('aria-label'), element.getAttribute('title'),
          element.textContent, typeof element.className === 'string' ? element.className : '',
          rawElement.getAttribute('aria-label'), rawElement.getAttribute('title')]
          .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        const topLeft = rect.left >= 0 && rect.top >= 0 && rect.left < 140 && rect.top < 140;
        const semantic = /关闭|close|×|✕|✖|退出/i.test(label) ||
          ((rawElement.tagName.toLowerCase() === 'svg' || rawElement.tagName.toLowerCase() === 'path') && topLeft);
        const closeLike = /关闭|close|退出/i.test(label);
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return { element, rect, semantic, closeLike, topLeft,
          pointerHitTarget: Boolean(hit && (hit === element || element.contains(hit))) };
      }).filter((candidate): candidate is {
        element: Element; rect: DOMRect; semantic: boolean; closeLike: boolean; topLeft: boolean;
        pointerHitTarget: boolean;
      } => candidate !== null && candidate.semantic && candidate.pointerHitTarget &&
        candidate.rect.top >= 0 && candidate.rect.left >= 0 && candidate.rect.right <= window.innerWidth &&
        candidate.rect.bottom <= window.innerHeight)
        .sort((left, right) => Number(right.topLeft) - Number(left.topLeft) ||
          Number(right.closeLike) - Number(left.closeLike) || left.rect.top - right.rect.top ||
          left.rect.left - right.rect.left);
      const target = candidates[0];
      if (!target) return null;
      const hit = document.elementFromPoint(target.rect.left + target.rect.width / 2,
        target.rect.top + target.rect.height / 2);
      if (!hit || !(hit === target.element || target.element.contains(hit))) return null;
      return {
        x: target.rect.left + target.rect.width / 2,
        y: target.rect.top + target.rect.height / 2,
        noteId: 'close'
      };
    }
  });
  const value = results[0]?.result;
  return value && typeof value === 'object' && Number.isFinite((value as { x?: unknown }).x) &&
    Number.isFinite((value as { y?: unknown }).y) ? value as Target : null;
}

async function readDocumentContinuity(pageDocument: DetailDocument): Promise<DocumentContinuity> {
  const result = await chrome.scripting.executeScript({
    target: { tabId: pageDocument.tabId, documentIds: [pageDocument.documentId] },
    func: () => ({ timeOrigin: performance.timeOrigin })
  });
  const timeOrigin = result[0]?.result?.timeOrigin;
  if (!Number.isFinite(timeOrigin)) throw new Error('xiaohongshu_public_search_document_unavailable');
  return { documentId: pageDocument.documentId, timeOrigin: Number(timeOrigin) };
}

async function readCloseContinuity(tabId: number): Promise<{
  documentId: string;
  timeOrigin: number;
  surface: 'search' | 'profile' | 'other';
  overlayVisible: boolean;
  renderedCardCount: number;
}> {
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
  if (!frame?.documentId) throw new Error('xiaohongshu_public_search_document_unavailable');
  const results = await chrome.scripting.executeScript({
    target: { tabId, documentIds: [frame.documentId] },
    func: () => {
      const visible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
          style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.01;
      };
      const roots = Array.from(document.querySelectorAll(
        '[role="dialog"], [aria-modal="true"]'
      )).filter(visible);
      // The note overlay is a centered, modal-sized container. Broad class
      // matches (e.g. [class*="modal"]) also hit persistent side panels on
      // the search page, which would keep the close postcondition false after
      // the overlay was actually closed; require modal proportions instead.
      const classModals = Array.from(document.querySelectorAll(
        '[class*="note-detail"], [class*="note-container"]'
      )).filter(visible).filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width >= window.innerWidth * 0.5 && rect.height >= window.innerHeight * 0.5;
      });
      // The platform wraps note links in zero-size anchors, so "visible note
      // anchors" is always zero; count the visible CARDS instead (a card is an
      // ancestor of a note link that holds a large visible image), matching
      // the rank locator's click-surface semantics.
      const areaDesc = (left: Element, right: Element): number => {
        const l = left.getBoundingClientRect(); const r = right.getBoundingClientRect();
        return (r.width * r.height) - (l.width * l.height);
      };
      const cardHolders = new Set<Element>();
      for (const link of Array.from(document.querySelectorAll('a[href]'))) {
        if (!(link instanceof HTMLAnchorElement)) continue;
        try {
          if (!/^\/(?:explore|discovery\/item|search_result)\/[A-Za-z0-9_-]+(?:\/|$)/.test(new URL(link.href).pathname)) continue;
        } catch { continue; }
        let pointer: Element | null = link.parentElement;
        for (let depth = 0; pointer && depth < 8; depth += 1, pointer = pointer.parentElement) {
          const image = Array.from(pointer.querySelectorAll('img')).filter(visible).sort(areaDesc)[0];
          const rect = pointer.getBoundingClientRect();
          if (image && rect.width >= 160 && rect.height >= 120) {
            cardHolders.add(pointer);
            break;
          }
        }
      }
      return {
        timeOrigin: performance.timeOrigin,
        surface: /^\/search_result(?:_ai)?\/?$/.test(location.pathname) ? 'search' as const
          : /^\/user\/profile\/[A-Za-z0-9_-]+\/?$/.test(location.pathname) ? 'profile' as const
          : 'other' as const,
        overlayVisible: [...roots, ...classModals].some((element) => (element.textContent ?? '').trim().length > 0),
        renderedCardCount: cardHolders.size
      };
    }
  });
  const value = results[0]?.result;
  if (!value || !Number.isFinite(value.timeOrigin)) throw new Error('xiaohongshu_public_search_document_unavailable');
  return { documentId: frame.documentId, ...value };
}

/**
 * Locate the one eligible public search document. A tab that is still
 * `loading` is waited for (bounded) instead of being filtered out on the
 * first probe: the SPA route transition from Explore to the search results
 * previously made the very next operation stop in milliseconds with
 * `xiaohongshu_public_search_tab_required` for a tab that was about to be
 * fully eligible.
 */
async function findUniqueSearchDocument(expectedTabId?: number): Promise<DetailDocument> {
  const deadline = Date.now() + 8_000;
  for (;;) {
    const tabs = expectedTabId === undefined
      ? await chrome.tabs.query({ url: [
        'https://www.xiaohongshu.com/search_result*',
        'https://www.xiaohongshu.com/search_result/*'
      ] })
      : [await chrome.tabs.get(expectedTabId).catch(() => null)].filter((tab): tab is chrome.tabs.Tab => tab !== null);
    const eligible = tabs.filter((tab) => Number.isSafeInteger(tab.id) && Number.isSafeInteger(tab.windowId) &&
      !tab.incognito && isXiaohongshuSearchContinuityUrl(tab.url ?? ''));
    if (eligible.length === 0) {
      if (Date.now() >= deadline) throw new Error('xiaohongshu_public_search_tab_required');
      await delay(400);
      continue;
    }
    if (eligible.length !== 1) throw new Error('xiaohongshu_public_search_tab_ambiguous');
    const tab = eligible[0]!;
    if (tab.status !== 'complete') {
      if (Date.now() >= deadline) throw new Error('xiaohongshu_public_search_tab_required');
      await delay(400);
      continue;
    }
    const frame = await chrome.webNavigation.getFrame({ tabId: tab.id!, frameId: 0 }).catch(() => null);
    if (!frame?.documentId || !isXiaohongshuSearchContinuityUrl(frame.url)) {
      if (Date.now() >= deadline) throw new Error('xiaohongshu_public_search_document_unavailable');
      await delay(400);
      continue;
    }
    return { tabId: tab.id!, windowId: tab.windowId!, documentId: frame.documentId };
  }
}

async function findUniqueProfileDocument(expectedTabId?: number): Promise<DetailDocument> {
  const tabs = expectedTabId === undefined
    ? await chrome.tabs.query({ url: ['https://www.xiaohongshu.com/user/profile/*'] })
    : [await chrome.tabs.get(expectedTabId).catch(() => null)].filter((tab): tab is chrome.tabs.Tab => tab !== null);
  const eligible = tabs.filter((tab) => Number.isSafeInteger(tab.id) && Number.isSafeInteger(tab.windowId) &&
    !tab.incognito && tab.status === 'complete' &&
    xiaohongshuCurrentPageNetworkPublicSurface(tab.url ?? '') === 'public_profile');
  if (eligible.length === 0) throw new Error('xiaohongshu_public_profile_tab_required');
  if (eligible.length !== 1) throw new Error('xiaohongshu_public_profile_tab_ambiguous');
  const tab = eligible[0]!;
  const frame = await chrome.webNavigation.getFrame({ tabId: tab.id!, frameId: 0 }).catch(() => null);
  if (!frame?.documentId || xiaohongshuCurrentPageNetworkPublicSurface(frame.url) !== 'public_profile') {
    throw new Error('xiaohongshu_public_profile_document_unavailable');
  }
  return { tabId: tab.id!, windowId: tab.windowId!, documentId: frame.documentId };
}

async function foreground(pageDocument: DetailDocument): Promise<void> {
  await chrome.windows.update(pageDocument.windowId, { focused: true }).catch(() => undefined);
  await chrome.tabs.update(pageDocument.tabId, { active: true });
  await delay(350);
}

async function requireSameDocument(pageDocument: DetailDocument, profileDocument: boolean): Promise<void> {
  const frame = await chrome.webNavigation.getFrame({ tabId: pageDocument.tabId, frameId: 0 }).catch(() => null);
  if (!frame || frame.documentId !== pageDocument.documentId) {
    throw new Error('xiaohongshu_public_search_document_changed');
  }
  if (profileDocument) {
    if (xiaohongshuCurrentPageNetworkPublicSurface(frame.url ?? '') !== 'public_profile') {
      throw new Error('xiaohongshu_public_search_document_changed');
    }
    return;
  }
  if (!isXiaohongshuSearchContinuityUrl(frame.url ?? '')) {
    throw new Error('xiaohongshu_public_search_document_changed');
  }
}

function isSearchContinuitySurface(
  surface: ReturnType<typeof xiaohongshuCurrentPageNetworkPublicSurface>
): boolean {
  return surface === 'search' || surface === 'public_note_detail';
}

/**
 * The search results document keeps its ranked cards while a note overlay is
 * open, and the platform moves that document to `/search_result/<noteId>`
 * (the overlay route) while the overlay is up. A rank click therefore stays
 * on the search surface across that route shape; refusing it made every
 * detail operation that followed an open overlay stop instantly with
 * `xiaohongshu_public_search_tab_required` even though the ranked cards were
 * still on the page.
 */
export function isXiaohongshuSearchResultOverlayPathname(pathname: string): boolean {
  return /^\/search_result(?:_ai)?\/[A-Za-z0-9_-]{1,80}\/?$/.test(pathname);
}

export function isXiaohongshuSearchContinuityUrl(url: string): boolean {
  if (isSearchContinuitySurface(xiaohongshuCurrentPageNetworkPublicSurface(url))) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'www.xiaohongshu.com' &&
      !parsed.port && !parsed.username && !parsed.password &&
      isXiaohongshuSearchResultOverlayPathname(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * Gate-scoped risk probe: note titles on the search wall routinely contain
 * platform-vocabulary words (“风控”, “验证码” in a tech note title), so the
 * historical full-page innerText scan misread ordinary content as a platform
 * gate. Only masks, dialogs, login and verification surfaces are read here.
 */
async function readRisk(pageDocument: DetailDocument): Promise<ReturnType<typeof classifyXiaohongshuCurrentPageRisk>> {
  const results = await chrome.scripting.executeScript({
    target: { tabId: pageDocument.tabId, documentIds: [pageDocument.documentId] },
    func: () => {
      const visible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
          style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.01;
      };
      const parts: string[] = [];
      const gateSelector = [
        '[role="dialog"]', '[aria-modal="true"]', '[class*="login" i]',
        '[class*="modal" i]', '[class*="mask" i]', '[class*="verify" i]',
        '[class*="captcha" i]', '[class*="forbidden" i]'
      ].join(', ');
      for (const element of Array.from(document.querySelectorAll(gateSelector))) {
        if (!visible(element)) continue;
        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (text.length >= 2 && text.length <= 600) parts.push(text);
      }
      return {
        pathname: location.pathname,
        title: document.title.slice(0, 300),
        visibleText: parts.join('\n').slice(0, 2_000)
      };
    }
  });
  const value = results[0]?.result;
  if (!value) throw new Error('xiaohongshu_public_search_probe_unavailable');
  return classifyXiaohongshuCurrentPageRisk(value);
}

function assertRisk(risk: ReturnType<typeof classifyXiaohongshuCurrentPageRisk>): void {
  if (risk.verificationRequired) throw new Error('xiaohongshu_verification_required');
  if (risk.rateLimited) throw new Error('xiaohongshu_rate_limited');
  if (risk.sourceUnavailable) throw new Error('xiaohongshu_source_unavailable');
  if (risk.loginRequired) throw new Error('xiaohongshu_login_required');
}

async function findRankedDetailTarget(
  pageDocument: DetailDocument,
  rank: number,
  hints: { expectedTitle?: string; expectedNoteId?: string } = {},
  onDiagnostic?: (errorCode: string, details: Record<string, unknown>) => void
): Promise<Target> {
  // The platform renders cards lazily and currently wraps the note link in a
  // zero-size anchor (0x0 href carrier) whose visible part lives on a card
  // container. Covers are also lazy: in a background tab (a delegated run
  // nobody is watching) the images may never materialise until the card is
  // scrolled into view. Poll with bounded scroll-into-view passes and
  // re-activate the extension's own leased work tab when the document went
  // hidden, instead of declaring the rank unavailable from one passive wait.
  const deadline = Date.now() + RANK_DETAIL_TARGET_READY_WINDOW_MS;
  let value: Target | null = null;
  let lastPending: RankedProbeOutcome & { kind: 'pending' } | null = null;
  let reactivationAttempted = false;
  while (Date.now() < deadline && value === null) {
    const probe = await probeRankedDetailTarget(pageDocument, rank, hints);
    if (probe.kind === 'target') {
      value = { x: probe.x, y: probe.y, noteId: probe.noteId };
      break;
    }
    if (probe.kind === 'pending') lastPending = probe;
    // One bounded re-activation per rank: the probe itself keeps working on a
    // hidden document, so this is only a rendering assist for lazy covers —
    // never a focus-stealing loop.
    if (probe.hidden && !reactivationAttempted) {
      reactivationAttempted = true;
      await activateManagedWorkTabIfInactive(pageDocument.tabId);
    }
    await delay(RANK_DETAIL_TARGET_RETRY_MS);
  }
  if (!value) {
    if (onDiagnostic && lastPending) {
      onDiagnostic('xiaohongshu_search_result_rank_unavailable', {
        ...lastPending.diagnostics,
        rank
      });
    }
    throw new Error('xiaohongshu_search_result_rank_unavailable');
  }
  return value;
}

type RankedProbeOutcome =
  | { kind: 'target'; x: number; y: number; noteId: string; hidden: boolean }
  | {
    kind: 'pending';
    hidden: boolean;
    diagnostics?: {
      stage: string;
      anchorTotal: number;
      cardSized: number;
      cardUnique: number;
      cardInViewport: number;
      docHidden: boolean;
      viewportWidth: number;
      viewportHeight: number;
      routeShape: string;
      hitMisses: number;
    };
  }
  | { kind: 'new_tab'; hidden: boolean };

async function probeRankedDetailTarget(
  pageDocument: DetailDocument,
  rank: number,
  hints: { expectedTitle?: string; expectedNoteId?: string }
): Promise<RankedProbeOutcome> {
  const results = await chrome.scripting.executeScript({
    target: { tabId: pageDocument.tabId, documentIds: [pageDocument.documentId] },
    args: [rank, hints.expectedTitle ?? '', hints.expectedNoteId ?? ''],
    // 语义定位，刻意不依赖任何 class / scoped-hash / 框架属性：
    // 小红书卡片必须包含指向笔记详情页的链接（/explore/<id>、
    // /discovery/item/<id> 或搜索页 overlay 路由 /search_result/<id>）。
    // 点击点定在「该链接所在卡片最近的可见大图」中心（平台可能把链接做成
    // 0x0 载体；封面图 lazy-load 未完成时退回同尺寸的卡片容器）；目标
    // rank 在首屏之外时先做一次有界 scrollIntoView 再等下一轮探测。
    func: (requestedRank: number, expectedTitle: string, expectedNoteId: string) => {
      const visible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
          style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.01;
      };
      const areaDesc = (left: Element, right: Element): number => {
        const l = left.getBoundingClientRect(); const r = right.getBoundingClientRect();
        return (r.width * r.height) - (l.width * l.height);
      };
      const noteIdOf = (href: string): string => {
        try {
          return new URL(href).pathname
            .match(/^\/(?:explore|discovery\/item|search_result)\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1] ?? '';
        } catch { return ''; }
      };
      const isNoteLink = (element: Element): boolean =>
        element instanceof HTMLAnchorElement && noteIdOf(element.href) !== '';
      // The click surface is the innermost ancestor of the note link that
      // holds a large visible image (the card). The anchor itself can be a
      // 0x0 href carrier and therefore not clickable at its own rect. A card
      // whose cover has not finished lazy-loading still counts through its
      // sized container — otherwise background-tab runs find no cards at all.
      const cardHolderOf = (anchor: HTMLAnchorElement): Element => {
        let sized: Element | null = null;
        let pointer: Element | null = anchor.parentElement;
        for (let depth = 0; pointer && depth < 8; depth += 1, pointer = pointer.parentElement) {
          const rect = pointer.getBoundingClientRect();
          if (rect.width >= 160 && rect.height >= 120) {
            if (sized === null) sized = pointer;
            const image = Array.from(pointer.querySelectorAll('img')).filter(visible)
              .sort(areaDesc)[0];
            if (image) return pointer;
          }
        }
        return sized ?? anchor;
      };
      const entries = Array.from(document.querySelectorAll('a[href]')).filter(isNoteLink)
        .map((link) => {
          const anchor = link as HTMLAnchorElement;
          const holder = cardHolderOf(anchor);
          const image = Array.from(holder.querySelectorAll('img')).filter(visible)
            .sort(areaDesc)[0] ?? null;
          const targetEl = image ?? (holder as Element);
          const rect = targetEl.getBoundingClientRect();
          return {
            el: targetEl,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            top: rect.top,
            left: rect.left,
            noteId: noteIdOf(anchor.href),
            newTab: anchor.target !== '' && anchor.target !== '_self',
            inViewport: rect.top < window.innerHeight && rect.bottom > 0 &&
              rect.left < window.innerWidth && rect.right > 0
          };
        })
        .filter((entry) => visible(entry.el))
        .sort((left, right) => (left.top - right.top) || (left.left - right.left));
      // Rank 语义按唯一笔记计数：当前卡片把图片和标题各包一个指向同一
      // noteId 的 <a>，不去重时相邻 rank 会解析成同一张卡（现场观测：一次
      // 深度运行反复点开同一篇笔记）。
      const seenNoteIds = new Set<string>();
      const uniqueEntries = entries.filter((entry) => {
        if (seenNoteIds.has(entry.noteId)) return false;
        seenNoteIds.add(entry.noteId);
        return true;
      });
      const documentHidden = document.visibilityState !== 'visible';
      const pending = {
        kind: 'pending' as const,
        hidden: documentHidden,
        diagnostics: {
          stage: 'rank_probe',
          anchorTotal: uniqueEntries.length,
          cardSized: entries.length,
          cardUnique: uniqueEntries.length,
          cardInViewport: uniqueEntries.filter((entry) => entry.inViewport).length,
          docHidden: documentHidden,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          routeShape: /^\/search_result(?:_ai)?\/?$/.test(location.pathname) ? 'search' :
            /^\/search_result(?:_ai)?\//.test(location.pathname) ? 'overlay' :
            /^\/explore/.test(location.pathname) ? 'explore' : 'other',
          hitMisses: 0
        }
      };
      // A hidden document (person switched away, occluded window) must NOT
      // block the probe: layout, hit-testing and debugger input all work in
      // background tabs, and field diagnostics showed 10 in-viewport cards
      // with 0 hit-test misses being skipped purely over visibilityState.
      // Hidden only hints findRankedDetailTarget to re-activate the leased
      // work tab so future lazy covers keep rendering.
      const target = uniqueEntries[requestedRank - 1];
      if (!target) {
        // 回退：卡片链接路径整体失效时，按标题文本（来自网络投影）匹配
        // 第 requestedRank 张可见卡片。
        const needle = expectedTitle.replace(/\s+/g, ' ').trim().slice(0, 30);
        if (needle === '') return pending;
        const textMatches = Array.from(document.querySelectorAll('img')).filter(visible)
          .map((image) => {
            const card = image.closest('a[href]') ?? image.parentElement;
            if (!card) return null;
            const text = (card.textContent ?? '').replace(/\s+/g, ' ').trim();
            if (!text.includes(needle)) return null;
            const rect = image.getBoundingClientRect();
            return {
              el: image as Element,
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
              noteId: expectedNoteId,
              newTab: false
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
          .sort((left, right) => (left.y - right.y) || (left.x - right.x));
        const fallback = textMatches[requestedRank - 1];
        if (!fallback) return pending;
        if (fallback.y < 0 || fallback.y > window.innerHeight ||
          fallback.x < 0 || fallback.x > window.innerWidth) {
          fallback.el.scrollIntoView({ block: 'center', behavior: 'instant' });
          return pending;
        }
        const hit = document.elementFromPoint(fallback.x, fallback.y);
        if (!hit || !(hit === fallback.el || fallback.el.contains(hit) || hit.contains(fallback.el))) {
          pending.diagnostics.hitMisses += 1;
          return pending;
        }
        return { kind: 'target' as const, x: fallback.x, y: fallback.y, noteId: fallback.noteId || 'fallback', hidden: documentHidden };
      }
      if (!target.inViewport) {
        // Below the fold: scroll the card into view once and let the next
        // probe tick measure it inside the viewport.
        target.el.scrollIntoView({ block: 'center', behavior: 'instant' });
        return pending;
      }
      const hit = document.elementFromPoint(target.x, target.y);
      if (!hit || !(hit === target.el || target.el.contains(hit) || hit.contains(target.el))) {
        pending.diagnostics.hitMisses += 1;
        return pending;
      }
      if (target.newTab) return { kind: 'new_tab' as const, hidden: documentHidden };
      return { kind: 'target' as const, x: target.x, y: target.y, noteId: target.noteId, hidden: documentHidden };
    }
  });
  const value = results[0]?.result as
    | { kind: 'target'; x: number; y: number; noteId: string; hidden: boolean }
    | { kind: 'pending'; hidden: boolean }
    | { kind: 'new_tab'; hidden: boolean }
    | undefined;
  if (!value || !['target', 'pending', 'new_tab'].includes(value.kind)) {
    return { kind: 'pending', hidden: false };
  }
  if (value.kind === 'new_tab') throw new Error('xiaohongshu_note_detail_target_new_tab');
  if (value.kind === 'target') {
    if (!Number.isFinite(value.x) || !Number.isFinite(value.y) ||
      typeof value.noteId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value.noteId)) {
      return { kind: 'pending', hidden: value.hidden };
    }
    return { kind: 'target', x: value.x, y: value.y, noteId: value.noteId, hidden: value.hidden };
  }
  return value;
}

async function dispatchClick(debuggee: chrome.debugger.Debuggee, target: Target): Promise<void> {
  await sendDebuggerCommandBounded(debuggee, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: target.x, y: target.y
  });
  await delay(100);
  await sendDebuggerCommandBounded(debuggee, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: target.x, y: target.y, button: 'left', buttons: 1, clickCount: 1
  });
  await delay(100);
  await sendDebuggerCommandBounded(debuggee, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: target.x, y: target.y, button: 'left', buttons: 0, clickCount: 1
  });
  await delay(150);
}

async function waitForDomProjection(
  pageDocument: DetailDocument,
  timeoutMs: number,
  expectedTitle = '',
  clickX = 0,
  clickY = 0
): Promise<DomProjection> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const results = await chrome.scripting.executeScript({
      target: { tabId: pageDocument.tabId, documentIds: [pageDocument.documentId] },
      args: [expectedTitle, clickX, clickY],
      func: (expectedTitle: string, clickX: number, clickY: number) => {
        const visible = (element: Element): boolean => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
            style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.01;
        };
        // Anchor on the click point: once the note overlay is open, the
        // pointer sits over the overlay/mask, so elementFromPoint lands
        // inside it. Climb to the outermost viewport-covering wrapper —
        // by construction the note container, never the results waterfall.
        // If the overlay did not open, the hit lands on the result card and
        // no qualifying wrapper exists → the rank fails truthfully instead
        // of attaching list text as a note body.
        let anchor = document.elementFromPoint(clickX, clickY);
        if (!anchor || !visible(anchor)) anchor = null;
        let overlay: Element | null = null;
        for (let node: Element | null = anchor; node && node !== document.body; node = node.parentElement) {
          const rect = node.getBoundingClientRect();
          if (rect.width >= window.innerWidth * 0.4 && rect.height >= window.innerHeight * 0.4) overlay = node;
        }
        if (!overlay) return null;
        const publicText = (overlay.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 12_000);
        if (!publicText) return null;
        // Attribution guard: a region that cannot be tied to THIS note (the
        // waterfall container also carries every card's title) would attach
        // another note's context to this rank. Keep polling for the real
        // overlay; if it never becomes attributable, the rank fails as noise
        // instead of storing misattributed content.
        const attributionNeedle = expectedTitle.replace(/\s+/g, ' ').trim().slice(0, 24);
        if (attributionNeedle.length >= 8 && !publicText.includes(attributionNeedle)) return null;
        const author = Array.from(overlay.querySelectorAll('a[href]')).find((element) =>
          element instanceof HTMLAnchorElement && visible(element) && (() => {
            try { return new URL(element.href).pathname.startsWith('/user/profile/'); } catch { return false; }
          })()) as HTMLAnchorElement | undefined;
        const interactionText = Array.from(overlay.querySelectorAll(
          '[class*="interact"], [class*="engage"], [class*="footer"], [class*="count"]'
        )).filter(visible).map((element) => element.textContent ?? '').join(' ')
          .replace(/\s+/g, ' ').trim().slice(0, 1_000);
        return {
          publicText,
          authorNickname: (author?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
          interactionText,
          visibleMediaCount: Math.min(20, Array.from(overlay.querySelectorAll('img, video')).filter(visible).length),
          commentEntryVisible: /评论/.test(publicText)
        };
      }
    }).catch(() => []);
    const value = results[0]?.result;
    if (value?.publicText) return value;
    await delay(250);
  }
  throw new Error('xiaohongshu_note_detail_postcondition_unmet');
}

function terminalReason(errorCode: string | null): XiaohongshuNotePublicDetailTerminalReason {
  switch (errorCode) {
    case 'xiaohongshu_public_search_tab_required': return 'existing_public_search_tab_required';
    case 'xiaohongshu_public_search_tab_ambiguous': return 'existing_public_search_tab_ambiguous';
    case 'xiaohongshu_public_profile_tab_required': return 'existing_public_profile_tab_required';
    case 'xiaohongshu_public_profile_tab_ambiguous': return 'existing_public_profile_tab_ambiguous';
    case 'xiaohongshu_search_result_rank_unavailable': return 'search_result_rank_unavailable';
    case 'xiaohongshu_note_detail_target_new_tab': return 'note_detail_target_new_tab';
    case 'xiaohongshu_public_search_document_unavailable':
    case 'xiaohongshu_public_search_document_changed':
    case 'xiaohongshu_note_detail_new_tab_detected':
    case 'xiaohongshu_current_page_network_selection_active': return 'document_context_changed';
    case 'xiaohongshu_login_required': return 'login_required';
    case 'xiaohongshu_verification_required': return 'verification_required';
    case 'xiaohongshu_rate_limited': return 'rate_limited';
    case 'xiaohongshu_source_unavailable': return 'source_unavailable';
    case 'debugger_attach_failed': return 'debugger_attach_failed';
    case 'debugger_input_failed': return 'debugger_input_failed';
    case 'xiaohongshu_note_detail_debugger_detach_failed': return 'debugger_detach_failed';
    default: return 'postcondition_unmet';
  }
}

function safeErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'xiaohongshu_note_detail_failed';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}