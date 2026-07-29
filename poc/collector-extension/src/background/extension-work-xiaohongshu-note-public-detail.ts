import {
  classifyXiaohongshuCurrentPageRisk,
  xiaohongshuCurrentPageNetworkPublicSurface,
  XIAOHONGSHU_NOTE_PUBLIC_COMMENTS_BUDGET,
  type XiaohongshuNotePublicDetailProjection,
  type XiaohongshuNotePublicCommentsWorkItem,
  type XiaohongshuNotePublicDetailTerminalReason,
  type XiaohongshuNotePublicDetailWorkItem,
  type XiaohongshuNotePublicDetailWorkResult
} from '@intelligence/collector-contracts';
import {
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

interface SearchDocument { tabId: number; windowId: number; documentId: string }
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
    /** Reuse a debugger lease already owned by the enclosing search action. */
    debuggee?: chrome.debugger.Debuggee;
  } = {}
): Promise<XiaohongshuNotePublicDetailWorkResult> {
  let pageDocument: SearchDocument | null = null;
  let attached = false;
  let debuggerDetached = true;
  let attempted = false;
  let projection: XiaohongshuNotePublicDetailProjection | null = null;
  let pageReady = false;
  let errorCode: string | null = null;
  try {
    pageDocument = await findUniqueSearchDocument();
    await foreground(pageDocument);
    try {
      await requireSameDocument(pageDocument);
    } catch {
      throw new Error('xiaohongshu_public_search_document_changed_before_detail');
    }
    const baseline = await readRisk(pageDocument);
    assertRisk(baseline);
    const continuity = await readDocumentContinuity(pageDocument);
    const target = await findRankedDetailTarget(pageDocument, item.input.resultRank);
    await armXiaohongshuExistingSearchWorkObserver(pageDocument.tabId, item.workId);
    await bindXiaohongshuObserverSelectedNote(pageDocument.tabId, item.workId, target.noteId);
    await prepareXiaohongshuNoteDetailClick(item.workId);
    const debuggee: chrome.debugger.Debuggee = options.debuggee ?? { tabId: pageDocument.tabId };
    if (!options.debuggee) {
      await chrome.debugger.attach(debuggee, '1.3').catch(() => { throw new Error('debugger_attach_failed'); });
      attached = true;
      debuggerDetached = false;
    }
    const baselineChildTabIds = new Set((await chrome.tabs.query({}))
      .filter((tab) => tab.openerTabId === pageDocument!.tabId && typeof tab.id === 'number')
      .map((tab) => tab.id!));
    await recordXiaohongshuNoteDetailClickIntent(item.workId);
    attempted = true;
    await dispatchClick(debuggee, target).catch(() => { throw new Error('debugger_input_failed'); });
    const dom = await waitForDomProjection(pageDocument, 6_000);
    const opened = (await chrome.tabs.query({}))
      .some((tab) => tab.openerTabId === pageDocument!.tabId && typeof tab.id === 'number' &&
        !baselineChildTabIds.has(tab.id));
    if (opened) throw new Error('xiaohongshu_note_detail_new_tab_detected');
    await completeXiaohongshuNoteDetailClick(item.workId);
    const network = await readXiaohongshuExistingSearchNoteDetailNetworkProjection(pageDocument.tabId, item.workId);
    const networkDetail = network.detail;
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
          allowSearchOverlay: true
        }
      );
      if (commentsResult.state !== 'completed' || !commentsResult.projection) {
        throw new Error(commentsResult.errorCode ?? 'xiaohongshu_note_comments_postcondition_unmet');
      }
      projection = { ...projection, comments: commentsResult.projection };
    }
    if (options.closeOverlayAfterCapture) {
      await closeDetailOverlay(pageDocument, debuggee, continuity.timeOrigin);
    }
    pageReady = true;
  } catch (error) {
    errorCode = safeErrorCode(error);
  } finally {
    if (attached && pageDocument) {
      try {
        await chrome.debugger.detach({ tabId: pageDocument.tabId });
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
    executionTarget: 'existing_public_search_tab',
    state: completed ? 'completed' : 'stopped',
    errorCode: completed ? null : errorCode ?? 'xiaohongshu_note_detail_postcondition_unmet',
    terminalReason: completed ? 'note_detail_ready' : terminalReason(errorCode),
    completedAt: new Date().toISOString(),
    navigation: { attempted: false, attemptCount: 0 },
    semanticAction: { attempted, attemptCount: attempted ? 1 : 0 },
    page: pageReady ? { publicSurface: 'note_detail_overlay', sameDocument: true } : null,
    projection,
    rawPayloadStored: false,
    responseUrlsStored: false,
    debuggerDetached
  };
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

/**
 * Depth collection reuses the same search document for several ranked notes.
 * The detail click itself is still at-most-once; after the projection is read
 * we discover the visible public close control and click it once through the
 * browser input layer. A failed or unknown cleanup is terminal for that depth
 * run, never a reason to click another card.
 */
async function closeDetailOverlay(
  pageDocument: SearchDocument,
  debuggee: chrome.debugger.Debuggee,
  timeOriginBefore: number
): Promise<void> {
  const closeTarget = await findDetailCloseTarget(pageDocument);
  if (!closeTarget) throw new Error('xiaohongshu_note_detail_close_target_unavailable');
  await dispatchClick(debuggee, closeTarget);
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const state = await readCloseContinuity(pageDocument.tabId).catch(() => null);
    if (state && state.timeOrigin !== timeOriginBefore) {
      throw new Error('xiaohongshu_public_search_document_changed_during_close');
    }
    if (state?.surface === 'search' && state.overlayVisible === false && state.renderedCardCount > 0) return;
    await delay(150);
  }
  throw new Error('xiaohongshu_note_detail_overlay_close_postcondition_unmet');
}

async function findDetailCloseTarget(pageDocument: SearchDocument): Promise<Target | null> {
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
      } => Boolean(candidate) && candidate.semantic && candidate.pointerHitTarget &&
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

async function readDocumentContinuity(pageDocument: SearchDocument): Promise<DocumentContinuity> {
  const result = await chrome.scripting.executeScript({
    target: { tabId: pageDocument.tabId, documentIds: [pageDocument.documentId] },
    func: () => ({ timeOrigin: performance.timeOrigin })
  });
  const timeOrigin = result[0]?.result?.timeOrigin;
  if (!Number.isFinite(timeOrigin)) throw new Error('xiaohongshu_public_search_document_unavailable');
  return { documentId: pageDocument.documentId, timeOrigin };
}

async function readCloseContinuity(tabId: number): Promise<{
  documentId: string;
  timeOrigin: number;
  surface: 'search' | 'other';
  overlayVisible: boolean;
  renderedCardCount: number;
}> {
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
  if (!frame.documentId) throw new Error('xiaohongshu_public_search_document_unavailable');
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
        '[role="dialog"], [aria-modal="true"], [class*="note-detail"], [class*="note-container"], [class*="modal"]'
      )).filter(visible);
      return {
        timeOrigin: performance.timeOrigin,
        surface: /^\/search_result(?:_ai)?\/?$/.test(location.pathname) ? 'search' as const : 'other' as const,
        overlayVisible: roots.some((element) => (element.textContent ?? '').trim().length > 0),
        renderedCardCount: Array.from(document.querySelectorAll('section.note-item')).filter(visible).length
      };
    }
  });
  const value = results[0]?.result;
  if (!value || !Number.isFinite(value.timeOrigin)) throw new Error('xiaohongshu_public_search_document_unavailable');
  return { documentId: frame.documentId, ...value };
}

async function findUniqueSearchDocument(): Promise<SearchDocument> {
  const tabs = await chrome.tabs.query({ url: ['https://www.xiaohongshu.com/search_result*'] });
  const eligible = tabs.filter((tab) => Number.isSafeInteger(tab.id) && Number.isSafeInteger(tab.windowId) &&
    !tab.incognito && tab.status === 'complete' &&
    isSearchContinuitySurface(xiaohongshuCurrentPageNetworkPublicSurface(tab.url ?? '')));
  if (eligible.length === 0) throw new Error('xiaohongshu_public_search_tab_required');
  if (eligible.length !== 1) throw new Error('xiaohongshu_public_search_tab_ambiguous');
  const tab = eligible[0]!;
  const frame = await chrome.webNavigation.getFrame({ tabId: tab.id!, frameId: 0 }).catch(() => null);
  if (!frame?.documentId || !isSearchContinuitySurface(xiaohongshuCurrentPageNetworkPublicSurface(frame.url))) {
    throw new Error('xiaohongshu_public_search_document_unavailable');
  }
  return { tabId: tab.id!, windowId: tab.windowId!, documentId: frame.documentId };
}

async function foreground(pageDocument: SearchDocument): Promise<void> {
  await chrome.windows.update(pageDocument.windowId, { focused: true }).catch(() => undefined);
  await chrome.tabs.update(pageDocument.tabId, { active: true });
  await delay(350);
}

async function requireSameDocument(pageDocument: SearchDocument): Promise<void> {
  const frame = await chrome.webNavigation.getFrame({ tabId: pageDocument.tabId, frameId: 0 }).catch(() => null);
  if (!frame || frame.documentId !== pageDocument.documentId ||
    !isSearchContinuitySurface(xiaohongshuCurrentPageNetworkPublicSurface(frame.url))) {
    throw new Error('xiaohongshu_public_search_document_changed');
  }
}

function isSearchContinuitySurface(
  surface: ReturnType<typeof xiaohongshuCurrentPageNetworkPublicSurface>
): boolean {
  return surface === 'search' || surface === 'public_note_detail';
}

async function readRisk(pageDocument: SearchDocument): Promise<ReturnType<typeof classifyXiaohongshuCurrentPageRisk>> {
  const results = await chrome.scripting.executeScript({
    target: { tabId: pageDocument.tabId, documentIds: [pageDocument.documentId] },
    func: () => ({
      pathname: location.pathname,
      title: document.title.slice(0, 300),
      visibleText: (document.body?.innerText ?? '').slice(0, 12_000)
    })
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

async function findRankedDetailTarget(pageDocument: SearchDocument, rank: number): Promise<Target> {
  const results = await chrome.scripting.executeScript({
    target: { tabId: pageDocument.tabId, documentIds: [pageDocument.documentId] },
    args: [rank],
    func: (requestedRank) => {
      const visible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
          style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.01;
      };
      const sections = Array.from(document.querySelectorAll('section.note-item')).filter(visible)
        .sort((left, right) => left.getBoundingClientRect().y - right.getBoundingClientRect().y ||
          left.getBoundingClientRect().x - right.getBoundingClientRect().x);
      const section = sections[requestedRank - 1] ?? null;
      if (!section) return null;
      const image = Array.from(section.querySelectorAll('img')).filter(visible).sort((left, right) => {
        const l = left.getBoundingClientRect();
        const r = right.getBoundingClientRect();
        return (r.width * r.height) - (l.width * l.height);
      })[0] ?? null;
      const target = image ?? section;
      const rect = target.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      const anchor = hit?.closest('a[href]');
      const noteAnchor = Array.from(section.querySelectorAll('a[href]')).find((element) => {
        if (!(element instanceof HTMLAnchorElement)) return false;
        try { return /^\/explore\/[A-Za-z0-9_-]+\/?$/.test(new URL(element.href).pathname); } catch { return false; }
      }) as HTMLAnchorElement | undefined;
      let noteId = '';
      if (noteAnchor) {
        try { noteId = new URL(noteAnchor.href).pathname.match(/^\/explore\/([A-Za-z0-9_-]+)\/?$/)?.[1] ?? ''; }
        catch { noteId = ''; }
      }
      if (!hit || !section.contains(hit)) return null;
      if (anchor instanceof HTMLAnchorElement && anchor.target && anchor.target !== '_self') {
        return { newTab: true, x, y, noteId };
      }
      return { newTab: false, x, y, noteId };
    }
  });
  const value = results[0]?.result;
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) ||
    typeof value.noteId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value.noteId)) {
    throw new Error('xiaohongshu_search_result_rank_unavailable');
  }
  if (value.newTab) throw new Error('xiaohongshu_note_detail_target_new_tab');
  return { x: value.x, y: value.y, noteId: value.noteId };
}

async function dispatchClick(debuggee: chrome.debugger.Debuggee, target: Target): Promise<void> {
  await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: target.x, y: target.y
  });
  await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: target.x, y: target.y, button: 'left', buttons: 1, clickCount: 1
  });
  await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: target.x, y: target.y, button: 'left', buttons: 0, clickCount: 1
  });
}

async function waitForDomProjection(pageDocument: SearchDocument, timeoutMs: number): Promise<DomProjection> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const results = await chrome.scripting.executeScript({
      target: { tabId: pageDocument.tabId, documentIds: [pageDocument.documentId] },
      func: () => {
        const visible = (element: Element): boolean => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
            style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.01;
        };
        const roots = Array.from(document.querySelectorAll(
          '[role="dialog"], [aria-modal="true"], [class*="note-detail"], [class*="note-container"], [class*="modal"]'
        )).filter(visible);
        const visibleAuthors = Array.from(document.querySelectorAll('a[href*="/user/profile/"]')).filter(visible);
        const authorAncestors = visibleAuthors.flatMap((author) => {
          const ancestors: Element[] = [];
          let current = author.parentElement;
          for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
            const rect = current.getBoundingClientRect();
            if (current !== document.body && current !== document.documentElement && visible(current) &&
              rect.width >= 400 && rect.width <= window.innerWidth * 0.92 && rect.height >= 300) ancestors.push(current);
          }
          return ancestors;
        });
        for (const ancestor of authorAncestors) if (!roots.includes(ancestor)) roots.push(ancestor);
        const withAuthor = roots.filter((root) => root.querySelector('a[href*="/user/profile/"]'));
        const overlay = (withAuthor.length > 0 ? withAuthor : roots).sort((left, right) => {
          const leftText = (left.textContent ?? '').replace(/\s+/g, ' ').trim().length;
          const rightText = (right.textContent ?? '').replace(/\s+/g, ' ').trim().length;
          if (rightText !== leftText) return rightText - leftText;
          const l = left.getBoundingClientRect();
          const r = right.getBoundingClientRect();
          return (r.width * r.height) - (l.width * l.height);
        })[0] ?? null;
        if (!overlay) return null;
        const publicText = (overlay.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 12_000);
        if (!publicText) return null;
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
