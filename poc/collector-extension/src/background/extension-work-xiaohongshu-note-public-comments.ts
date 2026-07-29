import {
  classifyXiaohongshuCurrentPageRisk,
  xiaohongshuCurrentPageNetworkPublicSurface as baseXiaohongshuCurrentPageNetworkPublicSurface,
  type XiaohongshuNotePublicCommentsProjection,
  type XiaohongshuNotePublicCommentsTerminalReason,
  type XiaohongshuNotePublicCommentsWorkItem,
  type XiaohongshuNotePublicCommentsWorkResult,
  type XiaohongshuPublicCommentProjection
} from '@intelligence/collector-contracts';
import {
  armXiaohongshuExistingNoteOverlayWorkObserver,
  clearXiaohongshuWorkObserver,
  readXiaohongshuExistingNoteCommentsNetworkProjection
} from './xiaohongshu-current-page-network';
import {
  completeXiaohongshuNoteCommentsScroll,
  prepareXiaohongshuNoteCommentsScroll,
  recordXiaohongshuNoteCommentsScrollIntent
} from './xiaohongshu-note-comments-scroll-ledger';

interface NoteDocument { tabId: number; windowId: number; documentId: string }
interface DomProbe {
  scrollTarget: { x: number; y: number } | null;
  renderedCommentCount: number;
  comments: Omit<XiaohongshuPublicCommentProjection, 'rank' | 'source'>[];
}
function noteSurface(value: string): boolean {
  if (baseXiaohongshuCurrentPageNetworkPublicSurface(value)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'www.xiaohongshu.com' &&
    !url.port && !url.username && !url.password && !url.hash && /^\/explore\/[^/]+\/?$/.test(url.pathname); }
  catch { return false; }
}

export async function executeXiaohongshuNotePublicCommentsExtensionWork(
  item: XiaohongshuNotePublicCommentsWorkItem,
  options: {
    /** Reuse the detail action's page and debugger lease in composed mode. */
    page?: NoteDocument;
    debuggee?: chrome.debugger.Debuggee;
    observerWorkId?: string;
    allowSearchOverlay?: boolean;
    /** Keep the enclosing detail observer alive for a following reply action. */
    preserveObserver?: boolean;
  } = {}
): Promise<XiaohongshuNotePublicCommentsWorkResult> {
  const observerWorkId = options.observerWorkId ?? item.workId;
  let page: NoteDocument | null = null;
  let attached = false;
  let debuggerDetached = true;
  let attemptedCount: 0 | 1 | 2 | 3 = 0;
  let completedCount: 0 | 1 | 2 | 3 = 0;
  let projection: XiaohongshuNotePublicCommentsProjection | null = null;
  let pageReady = false;
  let errorCode: string | null = null;
  try {
    page = options.page ?? await findUniqueNoteDocument();
    await foreground(page);
    await requireSameDocument(page, options.allowSearchOverlay === true);
    assertRisk(await readRisk(page));
    await armXiaohongshuExistingNoteOverlayWorkObserver(page.tabId, observerWorkId);
    await prepareXiaohongshuNoteCommentsScroll(item.workId);
    await delay(4_500);
    let dom = await readDomProbe(page);
    let network = await readXiaohongshuExistingNoteCommentsNetworkProjection(page.tabId, observerWorkId);
    // Keep the Network-first fast path: a complete archive needs no page
    // action.  If the page only exposed a partial DOM sample, however, the
    // platform may defer the remaining comments until the panel is scrolled.
    // Use the caller's small budget rather than treating the first visible
    // comments as the whole discussion.
    const shouldScroll = network.comments.length === 0 || network.hasMore === true;
    if (shouldScroll) {
      // A note may render a bounded public comment sample directly without a
      // scrollable container.  That is still a valid DOM fallback; only stop
      // when both independent evidence surfaces are empty.
      if (!dom.scrollTarget && network.comments.length === 0 && dom.comments.length === 0) {
        const waitDeadline = Date.now() + 8_000;
        while (Date.now() < waitDeadline && !dom.scrollTarget &&
          network.comments.length === 0 && dom.comments.length === 0) {
          await delay(500);
          await requireSameDocument(page, options.allowSearchOverlay === true);
          assertRisk(await readRisk(page));
          dom = await readDomProbe(page);
          network = await readXiaohongshuExistingNoteCommentsNetworkProjection(page.tabId, observerWorkId);
        }
      }
      if (!dom.scrollTarget && network.comments.length === 0 && dom.comments.length === 0) {
        throw new Error('xiaohongshu_comment_scroll_container_unavailable');
      }
      if (dom.scrollTarget) {
        const debuggee: chrome.debugger.Debuggee = options.debuggee ?? { tabId: page.tabId };
        if (!options.debuggee) {
          await chrome.debugger.attach(debuggee, '1.3').catch(() => { throw new Error('debugger_attach_failed'); });
          attached = true;
          debuggerDetached = false;
        }
        let previousCommentCount = mergeComments(network.comments, dom.comments).length;
        let noProgressRounds = 0;
        for (let ordinal = 1; ordinal <= item.input.maximumScrolls; ordinal += 1) {
          await requireSameDocument(page, options.allowSearchOverlay === true);
          assertRisk(await readRisk(page));
          const scrollTarget = dom.scrollTarget;
          if (!scrollTarget) throw new Error('xiaohongshu_comment_scroll_container_unavailable');
          const count = ordinal as 1 | 2 | 3;
          await recordXiaohongshuNoteCommentsScrollIntent(item.workId, count);
          attemptedCount = count;
          await dispatchWheel(debuggee, scrollTarget).catch(() => { throw new Error('debugger_input_failed'); });
          await delay(3_000);
          await requireSameDocument(page, options.allowSearchOverlay === true);
          await completeXiaohongshuNoteCommentsScroll(item.workId, count);
          completedCount = count;
          dom = await readDomProbe(page);
          network = await readXiaohongshuExistingNoteCommentsNetworkProjection(page.tabId, observerWorkId);
          const currentCommentCount = mergeComments(network.comments, dom.comments).length;
          if (currentCommentCount > previousCommentCount) {
            previousCommentCount = currentCommentCount;
            noProgressRounds = 0;
          } else {
            noProgressRounds += 1;
          }
          if (noProgressRounds >= 1 || network.hasMore !== true && currentCommentCount >= 80) break;
        }
      }
    }
    const merged = mergeComments(network.comments, dom.comments);
    if (merged.length === 0) throw new Error('xiaohongshu_note_comments_postcondition_unmet');
    const networkCount = merged.filter((comment) => comment.source === 'network').length;
    projection = {
      schemaVersion: 1,
      captureMode: networkCount === 0 ? 'dom_fallback' : networkCount === merged.length ? 'network_projection' : 'hybrid',
      network: {
        matchedPayloadCount: network.matchedPayloadCount,
        bodyBytesRead: network.bodyBytesRead,
        hasMore: network.hasMore,
        cursorObserved: network.cursorObserved
      },
      renderedCommentCount: dom.renderedCommentCount,
      comments: merged,
      rawPayloadStored: false,
      responseUrlsStored: false
    };
    pageReady = true;
  } catch (error) {
    errorCode = safeErrorCode(error);
  } finally {
    if (attached && page) {
      try {
        await chrome.debugger.detach({ tabId: page.tabId });
        debuggerDetached = true;
      } catch {
        debuggerDetached = false;
        errorCode = 'xiaohongshu_note_comments_debugger_detach_failed';
      }
    }
    if (page && options.preserveObserver !== true) {
      await clearXiaohongshuWorkObserver(page.tabId, observerWorkId).catch(() => undefined);
    }
  }
  const completed = errorCode === null && pageReady && projection !== null && debuggerDetached;
  return {
    schemaVersion: 1, protocolVersion: 1, workId: item.workId, operationId: item.operationId,
    browserBindingId: item.browserBindingId, platform: 'xiaohongshu',
    capability: 'xiaohongshu.note.public_comments.v1', executionTarget: 'existing_public_note_overlay',
    state: completed ? 'completed' : 'stopped',
    errorCode: completed ? null : errorCode ?? 'xiaohongshu_note_comments_postcondition_unmet',
    terminalReason: completed ? 'note_comments_ready' : terminalReason(errorCode),
    completedAt: new Date().toISOString(), navigation: { attempted: false, attemptCount: 0 },
    semanticAction: { attempted: attemptedCount > 0, attemptCount: attemptedCount },
    scroll: { requestedCount: item.input.maximumScrolls, completedCount },
    page: pageReady ? { publicSurface: 'note_detail_overlay', sameDocument: true } : null,
    projection, rawPayloadStored: false, responseUrlsStored: false, debuggerDetached
  };
}

async function findUniqueNoteDocument(): Promise<NoteDocument> {
  const tabs = await chrome.tabs.query({ url: ['https://www.xiaohongshu.com/explore/*'] });
  const eligible = tabs.filter((tab) => Number.isSafeInteger(tab.id) && Number.isSafeInteger(tab.windowId) &&
    !tab.incognito && tab.status === 'complete' &&
    noteSurface(tab.url ?? ''));
  if (eligible.length === 0) throw new Error('xiaohongshu_public_note_overlay_required');
  if (eligible.length !== 1) throw new Error('xiaohongshu_public_note_overlay_ambiguous');
  const tab = eligible[0]!;
  const frame = await chrome.webNavigation.getFrame({ tabId: tab.id!, frameId: 0 }).catch(() => null);
  if (!frame?.documentId || !noteSurface(frame.url)) {
    throw new Error('xiaohongshu_public_note_document_unavailable');
  }
  return { tabId: tab.id!, windowId: tab.windowId!, documentId: frame.documentId };
}
async function foreground(page: NoteDocument): Promise<void> {
  await chrome.windows.update(page.windowId, { focused: true }).catch(() => undefined);
  await chrome.tabs.update(page.tabId, { active: true });
  await delay(350);
}
async function requireSameDocument(page: NoteDocument, allowSearchOverlay = false): Promise<void> {
  const frame = await chrome.webNavigation.getFrame({ tabId: page.tabId, frameId: 0 }).catch(() => null);
  if (!frame || frame.documentId !== page.documentId ||
    (!noteSurface(frame.url) && !(allowSearchOverlay && baseXiaohongshuCurrentPageNetworkPublicSurface(frame.url) === 'search'))) {
    throw new Error('xiaohongshu_public_note_document_changed');
  }
}
async function readRisk(page: NoteDocument): Promise<ReturnType<typeof classifyXiaohongshuCurrentPageRisk>> {
  const result = await chrome.scripting.executeScript({
    target: { tabId: page.tabId, documentIds: [page.documentId] },
    func: () => ({ pathname: location.pathname, title: document.title.slice(0, 300),
      visibleText: (document.body?.innerText ?? '').slice(0, 12_000) })
  });
  if (!result[0]?.result) throw new Error('xiaohongshu_public_note_probe_unavailable');
  return classifyXiaohongshuCurrentPageRisk(result[0].result);
}
function assertRisk(risk: ReturnType<typeof classifyXiaohongshuCurrentPageRisk>): void {
  if (risk.verificationRequired) throw new Error('xiaohongshu_verification_required');
  if (risk.rateLimited) throw new Error('xiaohongshu_rate_limited');
  if (risk.sourceUnavailable) throw new Error('xiaohongshu_source_unavailable');
  if (risk.loginRequired) throw new Error('xiaohongshu_login_required');
}

async function readDomProbe(page: NoteDocument): Promise<DomProbe> {
  const result = await chrome.scripting.executeScript({
    target: { tabId: page.tabId, documentIds: [page.documentId] },
    func: () => {
      const visible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' &&
          Number.parseFloat(style.opacity || '1') > 0.01;
      };
      const clean = (value: string, maximum: number): string => value.replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ').trim().slice(0, maximum);
      const authors = Array.from(document.querySelectorAll('a[href*="/user/profile/"]')).filter(visible);
      const ancestors = authors.flatMap((author) => { const values: Element[] = []; let current = author.parentElement;
        for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
          const rect = current.getBoundingClientRect();
          if (current !== document.body && current !== document.documentElement && visible(current) &&
            rect.width >= 400 && rect.width <= innerWidth * 0.92 && rect.height >= 300) values.push(current);
        } return values; });
      const overlay = ancestors.sort((a, b) => (b.textContent ?? '').length - (a.textContent ?? '').length)[0] ?? null;
      if (!overlay) return null;
      const scrollables = [overlay, ...Array.from(overlay.querySelectorAll('*'))].filter((element) => {
        if (!visible(element)) return false; const html = element as HTMLElement; const rect = element.getBoundingClientRect();
        const overflow = getComputedStyle(element).overflowY;
        return rect.width >= 300 && rect.x >= innerWidth * 0.35 && rect.height >= 180 &&
          html.scrollHeight > html.clientHeight + 80 && ['auto', 'scroll', 'overlay'].includes(overflow);
      }) as HTMLElement[];
      const scroll = scrollables.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0] ?? null;
      const heading = Array.from(overlay.querySelectorAll('*')).filter((element) => {
        if (!visible(element)) return false;
        const own = Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim();
        return /共\s*\d+\s*条评论|\d+\s*条评论/.test(own);
      }).sort((left, right) => {
        const l = left.getBoundingClientRect(); const r = right.getBoundingClientRect();
        return l.width * l.height - r.width * r.height;
      })[0] ?? null;
      const headingBottom = heading?.getBoundingClientRect().bottom ?? overlay.getBoundingClientRect().top + 240;
      const classCandidates = Array.from(overlay.querySelectorAll(
        '[class*="comment-item"], [class*="comment-inner"], [data-comment-id]'
      )).filter(visible);
      const semanticCandidates = Array.from(overlay.querySelectorAll('a[href*="/user/profile/"]')).filter((anchor) =>
        visible(anchor) && anchor.getBoundingClientRect().top >= headingBottom - 4
      ).map((anchor) => {
        const authorText = clean((anchor as HTMLElement).innerText ?? '', 200);
        let current = anchor.parentElement;
        for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
          const rect = current.getBoundingClientRect();
          const text = clean(current.textContent ?? '', 2_000);
          if (visible(current) && rect.top >= headingBottom - 8 && rect.width >= 220 && rect.height >= 38 &&
            rect.height <= 560 && text.length >= authorText.length + 3) return current;
        }
        return null;
      }).filter((value): value is HTMLElement => value !== null);
      const candidates = [...classCandidates, ...semanticCandidates].filter((node, index, all) =>
        all.indexOf(node) === index && node.getBoundingClientRect().top >= headingBottom - 8
      );
      const nodes = candidates.filter((node, index, all) => !all.some((other, otherIndex) =>
        otherIndex !== index && node.contains(other)
      )).sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);
      const digest = (value: string): string => { let hash = 2166136261; for (const char of value) {
        hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, '0'); };
      const comments = nodes.slice(0, 80).map((node) => {
        const publicText = clean(node.textContent ?? '', 2_000);
        const author = Array.from(node.querySelectorAll('a[href*="/user/profile/"]')).find(visible);
        const authorNickname = clean((author as HTMLElement | undefined)?.innerText ?? '', 200);
        const id = clean((node as HTMLElement).dataset.commentId ?? '', 100) || `dom-${digest(`${authorNickname}\n${publicText}`)}`;
        return { commentId: id, publicText, authorNickname, likedCountText: '', subCommentCountText: '',
          createdAtText: '', locationText: '' };
      }).filter((comment) => comment.publicText);
      const rect = scroll?.getBoundingClientRect() ?? null;
      return { scrollTarget: rect ? { x: rect.x + rect.width * 0.72, y: rect.y + rect.height * 0.68 } : null,
        renderedCommentCount: nodes.length, comments };
    }
  });
  const value = result[0]?.result;
  if (!value) throw new Error('xiaohongshu_public_note_overlay_required');
  return value;
}

async function dispatchWheel(debuggee: chrome.debugger.Debuggee, target: { x: number; y: number }): Promise<void> {
  await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });
  await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: target.x, y: target.y, deltaX: 0, deltaY: 420
  });
}
function mergeComments(
  network: Array<Omit<XiaohongshuPublicCommentProjection, 'rank' | 'source'>>,
  dom: Array<Omit<XiaohongshuPublicCommentProjection, 'rank' | 'source'>>
): XiaohongshuPublicCommentProjection[] {
  const merged = new Map<string, Omit<XiaohongshuPublicCommentProjection, 'rank'>>();
  for (const comment of network) merged.set(comment.commentId, { ...comment, source: 'network' });
  for (const comment of dom) if (!merged.has(comment.commentId)) merged.set(comment.commentId, { ...comment, source: 'dom' });
  return [...merged.values()].slice(0, 80).map((comment, index) => ({ rank: index + 1, ...comment }));
}
function terminalReason(errorCode: string | null): XiaohongshuNotePublicCommentsTerminalReason {
  switch (errorCode) {
    case 'xiaohongshu_public_note_overlay_required': return 'existing_public_note_overlay_required';
    case 'xiaohongshu_public_note_overlay_ambiguous': return 'existing_public_note_overlay_ambiguous';
    case 'xiaohongshu_comment_scroll_container_unavailable': return 'comment_scroll_container_unavailable';
    case 'xiaohongshu_public_note_document_unavailable':
    case 'xiaohongshu_public_note_document_changed':
    case 'xiaohongshu_current_page_network_selection_active': return 'document_context_changed';
    case 'xiaohongshu_login_required': return 'login_required';
    case 'xiaohongshu_verification_required': return 'verification_required';
    case 'xiaohongshu_rate_limited': return 'rate_limited';
    case 'xiaohongshu_source_unavailable': return 'source_unavailable';
    case 'debugger_attach_failed': return 'debugger_attach_failed';
    case 'debugger_input_failed': return 'debugger_input_failed';
    case 'xiaohongshu_note_comments_debugger_detach_failed': return 'debugger_detach_failed';
    default: return 'postcondition_unmet';
  }
}
function safeErrorCode(error: unknown): string { const code = error instanceof Error ? error.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'xiaohongshu_note_comments_failed'; }
function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
