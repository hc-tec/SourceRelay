import {
  classifyXiaohongshuCurrentPageRisk,
  type XiaohongshuNotePublicCommentRepliesTerminalReason,
  type XiaohongshuNotePublicCommentRepliesWorkItem,
  type XiaohongshuNotePublicCommentRepliesWorkResult,
  type XiaohongshuPublicReplyProjection,
  type XiaohongshuPublicReplyThreadProjection
} from '@intelligence/collector-contracts';
import {
  armXiaohongshuExistingNoteOverlayWorkObserver,
  clearXiaohongshuWorkObserver,
  readXiaohongshuExistingNoteReplyNetworkProjection
} from './xiaohongshu-current-page-network';
import {
  completeXiaohongshuCommentRepliesClick,
  prepareXiaohongshuCommentRepliesClick,
  recordXiaohongshuCommentRepliesClickIntent
} from './xiaohongshu-comment-replies-click-ledger';

interface BoundPage {
  tabId: number;
  windowId: number;
  documentId: string;
}

interface ReplyExpansionTarget {
  x: number;
  y: number;
  label: string;
  parent: XiaohongshuPublicReplyProjection;
}

interface DomReplyThread {
  parent: XiaohongshuPublicReplyProjection;
  replies: XiaohongshuPublicReplyProjection[];
}

type ReplyNetworkProjection = Awaited<ReturnType<typeof readXiaohongshuExistingNoteReplyNetworkProjection>>;

export async function executeXiaohongshuNotePublicCommentRepliesExtensionWork(
  item: XiaohongshuNotePublicCommentRepliesWorkItem,
  options: {
    /** Reuse the already-bound detail document in composed search depth. */
    page?: BoundPage;
    debuggee?: chrome.debugger.Debuggee;
    observerWorkId?: string;
    allowSearchOverlay?: boolean;
    preserveObserver?: boolean;
  } = {}
): Promise<XiaohongshuNotePublicCommentRepliesWorkResult> {
  const observerWorkId = options.observerWorkId ?? item.workId;
  let page: BoundPage | null = null;
  let debuggerAttached = false;
  let debuggerDetached = true;
  let actionAttempted = false;
  let pageReady = false;
  let projection: XiaohongshuPublicReplyThreadProjection | null = null;
  let errorCode: string | null = null;

  try {
    page = options.page ?? await findUniqueExistingPublicNoteOverlay();
    await foregroundPage(page);
    await assertSameDocument(page, options.allowSearchOverlay === true);
    assertNoPageRisk(await readPageRisk(page));

    await armXiaohongshuExistingNoteOverlayWorkObserver(page.tabId, observerWorkId);
    await prepareXiaohongshuCommentRepliesClick(item.workId);
    await delay(1_200);

    const networkBefore = await readXiaohongshuExistingNoteReplyNetworkProjection(
      page.tabId,
      observerWorkId,
      options.allowSearchOverlay === true
    );
    projection = projectArchivedReplyThread(networkBefore);
    if (!projection) {
      const target = await findReplyExpansionTarget(page);
      const debuggee: chrome.debugger.Debuggee = options.debuggee ?? { tabId: page.tabId };
      if (!options.debuggee) {
        await chrome.debugger.attach(debuggee, '1.3').catch(() => {
          throw new Error('debugger_attach_failed');
        });
        debuggerAttached = true;
        debuggerDetached = false;
      }

      const existingChildTabIds = await readChildTabIds(page.tabId);
      await recordXiaohongshuCommentRepliesClickIntent(item.workId);
      actionAttempted = true;
      await dispatchTrustedClick(debuggee, target).catch(() => {
        throw new Error('debugger_input_failed');
      });

      await delay(3_500);
      await assertSameDocument(page, options.allowSearchOverlay === true);
      await assertNoNewChildTab(page.tabId, existingChildTabIds);
      assertNoPageRisk(await readPageRisk(page));

      const domAfter = await readExpandedReplyThread(page, target.label);
      await completeXiaohongshuCommentRepliesClick(item.workId);
      const networkAfter = await readXiaohongshuExistingNoteReplyNetworkProjection(
        page.tabId,
        observerWorkId,
        options.allowSearchOverlay === true
      );
      projection = mergeReplyEvidence(target, domAfter, networkBefore, networkAfter);
    }
    pageReady = true;
  } catch (error) {
    errorCode = safeErrorCode(error);
  } finally {
    if (debuggerAttached && page) {
      try {
        await chrome.debugger.detach({ tabId: page.tabId });
        debuggerDetached = true;
      } catch {
        debuggerDetached = false;
        errorCode = 'xiaohongshu_comment_replies_debugger_detach_failed';
      }
    }
    if (page && options.preserveObserver !== true) {
      await clearXiaohongshuWorkObserver(page.tabId, observerWorkId).catch(() => undefined);
    }
  }

  const completed = errorCode === null && pageReady && projection !== null && debuggerDetached;
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    workId: item.workId,
    operationId: item.operationId,
    browserBindingId: item.browserBindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.note.public_comment_replies.v1',
    executionTarget: 'existing_public_note_overlay',
    state: completed ? 'completed' : 'stopped',
    errorCode: completed ? null : errorCode ?? 'xiaohongshu_comment_replies_postcondition_unmet',
    terminalReason: completed ? 'comment_replies_ready' : terminalReasonFor(errorCode),
    completedAt: new Date().toISOString(),
    navigation: { attempted: false, attemptCount: 0 },
    semanticAction: { attempted: actionAttempted, attemptCount: actionAttempted ? 1 : 0 },
    thread: { requestedCount: 1, completedCount: completed ? 1 : 0 },
    page: pageReady ? { publicSurface: 'note_detail_overlay', sameDocument: true } : null,
    projection,
    rawPayloadStored: false,
    responseUrlsStored: false,
    debuggerDetached
  };
}

function projectArchivedReplyThread(
  network: ReplyNetworkProjection
): XiaohongshuPublicReplyThreadProjection | null {
  const firstReply = network.comments.find((comment) => comment.parentCommentId.length > 0);
  if (!firstReply) return null;
  const parent = network.comments.find((comment) => comment.commentId === firstReply.parentCommentId);
  if (!parent) return null;
  const replies = network.comments
    .filter((comment) => comment.parentCommentId === parent.commentId)
    .slice(0, 40)
    .map((comment, index) => projectArchivedComment(comment, index + 1));
  if (replies.length === 0) return null;
  return {
    schemaVersion: 1,
    captureMode: 'network_projection',
    network: {
      matchedPayloadCount: network.matchedPayloadCount,
      bodyBytesRead: network.bodyBytesRead,
      cursorObserved: network.cursorObserved,
      actionTriggeredResponseCount: 0
    },
    expandedLabelText: 'network_archive',
    parentComment: projectArchivedComment(parent, 1),
    replies,
    rawPayloadStored: false,
    responseUrlsStored: false
  };
}

function projectArchivedComment(
  comment: ReplyNetworkProjection['comments'][number],
  rank: number
): XiaohongshuPublicReplyProjection {
  return {
    rank,
    commentId: comment.commentId,
    publicText: comment.publicText,
    authorNickname: comment.authorNickname,
    likedCountText: comment.likedCountText,
    createdAtText: comment.createdAtText,
    locationText: comment.locationText,
    source: 'network'
  };
}

async function findUniqueExistingPublicNoteOverlay(): Promise<BoundPage> {
  const tabs = await chrome.tabs.query({ url: ['https://www.xiaohongshu.com/explore/*'] });
  const eligible = tabs.filter((tab) =>
    Number.isSafeInteger(tab.id) &&
    Number.isSafeInteger(tab.windowId) &&
    !tab.incognito &&
    tab.status === 'complete'
  );
  if (eligible.length === 0) throw new Error('xiaohongshu_public_note_overlay_required');
  if (eligible.length !== 1) throw new Error('xiaohongshu_public_note_overlay_ambiguous');

  const tab = eligible[0]!;
  const frame = await chrome.webNavigation.getFrame({ tabId: tab.id!, frameId: 0 }).catch(() => null);
  if (!frame?.documentId || !/^https:\/\/www\.xiaohongshu\.com\/explore\/[A-Za-z0-9_-]+/.test(frame.url)) {
    throw new Error('xiaohongshu_public_note_document_unavailable');
  }
  return { tabId: tab.id!, windowId: tab.windowId!, documentId: frame.documentId };
}

async function foregroundPage(page: BoundPage): Promise<void> {
  await chrome.windows.update(page.windowId, { focused: true }).catch(() => undefined);
  await chrome.tabs.update(page.tabId, { active: true });
  await delay(350);
}

async function assertSameDocument(page: BoundPage, allowSearchOverlay = false): Promise<void> {
  const frame = await chrome.webNavigation.getFrame({ tabId: page.tabId, frameId: 0 }).catch(() => null);
  const surface = frame?.url ? xiaohongshuCurrentPageSurface(frame.url) : null;
  if (!frame || frame.documentId !== page.documentId ||
    (surface !== 'public_note_detail' && !(allowSearchOverlay && surface === 'search'))) {
    throw new Error('xiaohongshu_public_note_document_changed');
  }
}

function xiaohongshuCurrentPageSurface(value: string): 'search' | 'public_note_detail' | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'www.xiaohongshu.com' || url.port ||
      url.username || url.password || url.hash) return null;
    if (/^\/search_result(?:_ai)?\/?$/.test(url.pathname)) return 'search';
    if (/^\/explore\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return 'public_note_detail';
    return null;
  } catch { return null; }
}

async function readPageRisk(page: BoundPage) {
  const result = await chrome.scripting.executeScript({
    target: { tabId: page.tabId, documentIds: [page.documentId] },
    func: () => ({
      pathname: location.pathname,
      title: document.title.slice(0, 300),
      visibleText: (document.body?.innerText ?? '').slice(0, 12_000)
    })
  });
  if (!result[0]?.result) throw new Error('xiaohongshu_public_note_probe_unavailable');
  return classifyXiaohongshuCurrentPageRisk(result[0].result);
}

function assertNoPageRisk(value: ReturnType<typeof classifyXiaohongshuCurrentPageRisk>): void {
  if (value.verificationRequired) throw new Error('xiaohongshu_verification_required');
  if (value.rateLimited) throw new Error('xiaohongshu_rate_limited');
  if (value.sourceUnavailable) throw new Error('xiaohongshu_source_unavailable');
  if (value.loginRequired) throw new Error('xiaohongshu_login_required');
}

async function findReplyExpansionTarget(page: BoundPage): Promise<ReplyExpansionTarget> {
  const result = await chrome.scripting.executeScript({
    target: { tabId: page.tabId, documentIds: [page.documentId] },
    func: () => {
      const visible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
          style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.01;
      };
      const clean = (value: string, maximum: number): string => value
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maximum);
      const hashText = (value: string): string => {
        let hash = 2_166_136_261;
        for (const character of value) {
          hash ^= character.charCodeAt(0);
          hash = Math.imul(hash, 16_777_619);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
      };

      const targets = Array.from(document.querySelectorAll('*'))
        .filter((element) => {
          if (!visible(element)) return false;
          const ownText = Array.from(element.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent ?? '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          return /^展开\s*\d+\s*条回复$/.test(ownText);
        })
        .sort((left, right) => {
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
        });
      const target = targets[0] ?? null;
      if (!target) return null;

      const rect = target.getBoundingClientRect();
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(target === hit || target.contains(hit))) return null;

      let root = target.parentElement;
      for (let depth = 0; root && depth < 7; depth += 1, root = root.parentElement) {
        const rootRect = root.getBoundingClientRect();
        const text = clean(root.textContent ?? '', 2_000);
        const author = Array.from(root.querySelectorAll('a[href*="/user/profile/"]')).find(visible) as
          HTMLElement | undefined;
        const authorName = clean(author?.innerText ?? '', 200);
        if (
          rootRect.width >= 220 && rootRect.height >= 50 && rootRect.height <= 650 &&
          author && text.length > authorName.length + 3
        ) {
          return {
            x,
            y,
            label: clean(target.textContent ?? '', 80),
            parent: {
              rank: 1,
              commentId: `dom-${hashText(text)}`,
              publicText: text,
              authorNickname: authorName,
              likedCountText: '',
              createdAtText: '',
              locationText: '',
              source: 'dom' as const
            }
          };
        }
      }
      return null;
    }
  });
  const value = result[0]?.result;
  if (!value) throw new Error('xiaohongshu_reply_thread_target_unavailable');
  return value;
}

async function readExpandedReplyThread(page: BoundPage, oldLabel: string): Promise<DomReplyThread> {
  const result = await chrome.scripting.executeScript({
    target: { tabId: page.tabId, documentIds: [page.documentId] },
    args: [oldLabel],
    func: (labelBeforeClick) => {
      const visible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
          style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.01;
      };
      const clean = (value: string, maximum: number): string => value
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maximum);
      const stillCollapsed = Array.from(document.querySelectorAll('*')).some(
        (element) => visible(element) && clean(element.textContent ?? '', 80) === labelBeforeClick
      );
      if (stillCollapsed) return null;

      const candidateRoots = Array.from(document.querySelectorAll('a[href*="/user/profile/"]'))
        .filter(visible)
        .map((anchor) => {
          let root = anchor.parentElement;
          for (let depth = 0; root && depth < 6; depth += 1, root = root.parentElement) {
            const rect = root.getBoundingClientRect();
            if (
              rect.width >= 220 && rect.height >= 38 && rect.height <= 700 &&
              root.querySelectorAll('a[href*="/user/profile/"]').length >= 2
            ) return root;
          }
          return null;
        })
        .filter((value): value is HTMLElement => value !== null)
        .sort((left, right) => left.getBoundingClientRect().height - right.getBoundingClientRect().height);
      const root = candidateRoots[0] ?? null;
      if (!root) return null;

      const anchors = Array.from(root.querySelectorAll('a[href*="/user/profile/"]')).filter(visible) as HTMLElement[];
      const project = (anchor: HTMLElement, index: number) => {
        let node = anchor.parentElement;
        while (node && node !== root) {
          const rect = node.getBoundingClientRect();
          const text = clean(node.textContent ?? '', 2_000);
          const author = clean(anchor.innerText ?? '', 200);
          if (rect.width >= 180 && rect.height >= 30 && text.length > author.length + 2) {
            let hash = 2_166_136_261;
            for (const character of text) {
              hash ^= character.charCodeAt(0);
              hash = Math.imul(hash, 16_777_619);
            }
            return {
              rank: index + 1,
              commentId: `dom-${(hash >>> 0).toString(16).padStart(8, '0')}`,
              publicText: text,
              authorNickname: author,
              likedCountText: '',
              createdAtText: '',
              locationText: '',
              source: 'dom' as const
            };
          }
          node = node.parentElement;
        }
        return null;
      };
      const comments = anchors.map(project).filter((value): value is NonNullable<typeof value> => value !== null);
      if (comments.length < 2) return null;
      return { parent: comments[0]!, replies: comments.slice(1, 40) };
    }
  });
  const value = result[0]?.result;
  if (!value?.replies?.length) throw new Error('xiaohongshu_comment_replies_postcondition_unmet');
  return value;
}

async function readChildTabIds(openerTabId: number): Promise<Set<number>> {
  const tabs = await chrome.tabs.query({});
  return new Set(
    tabs
      .filter((tab) => tab.openerTabId === openerTabId && typeof tab.id === 'number')
      .map((tab) => tab.id!)
  );
}

async function assertNoNewChildTab(openerTabId: number, existingIds: Set<number>): Promise<void> {
  const tabs = await chrome.tabs.query({});
  if (tabs.some((tab) =>
    tab.openerTabId === openerTabId && typeof tab.id === 'number' && !existingIds.has(tab.id)
  )) {
    throw new Error('xiaohongshu_comment_replies_new_tab_detected');
  }
}

async function dispatchTrustedClick(
  debuggee: chrome.debugger.Debuggee,
  target: ReplyExpansionTarget
): Promise<void> {
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

function mergeReplyEvidence(
  target: ReplyExpansionTarget,
  domAfter: DomReplyThread,
  networkBefore: ReplyNetworkProjection,
  networkAfter: ReplyNetworkProjection
): XiaohongshuPublicReplyThreadProjection {
  const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim();
  const normalizedDomParent = normalize(target.parent.publicText);
  const archivedParent = networkAfter.comments.find((comment) => {
    const normalizedNetworkText = normalize(comment.publicText);
    return normalizedDomParent.includes(normalizedNetworkText) ||
      normalizedNetworkText.includes(normalizedDomParent.slice(0, 40));
  });
  const parentId = archivedParent?.commentId ?? '';
  const archivedReplies = parentId
    ? networkAfter.comments.filter((comment) => comment.parentCommentId === parentId)
    : [];
  const parentComment = archivedParent ? projectArchivedComment(archivedParent, 1) : domAfter.parent;
  const replies = archivedReplies.length > 0
    ? archivedReplies.slice(0, 40).map((comment, index) => projectArchivedComment(comment, index + 1))
    : domAfter.replies.map((comment, index) => ({ ...comment, rank: index + 1 }));
  const networkUsed = Boolean(archivedParent || archivedReplies.length);

  return {
    schemaVersion: 1,
    captureMode: networkUsed
      ? (replies.some((comment) => comment.source === 'dom') ? 'hybrid' : 'network_projection')
      : 'dom_fallback',
    network: {
      matchedPayloadCount: networkAfter.matchedPayloadCount,
      bodyBytesRead: networkAfter.bodyBytesRead,
      cursorObserved: networkAfter.cursorObserved,
      actionTriggeredResponseCount: Math.max(
        0,
        networkAfter.matchedPayloadCount - networkBefore.matchedPayloadCount
      )
    },
    expandedLabelText: target.label,
    parentComment,
    replies,
    rawPayloadStored: false,
    responseUrlsStored: false
  };
}

function terminalReasonFor(errorCode: string | null): XiaohongshuNotePublicCommentRepliesTerminalReason {
  switch (errorCode) {
    case 'xiaohongshu_public_note_overlay_required': return 'existing_public_note_overlay_required';
    case 'xiaohongshu_public_note_overlay_ambiguous': return 'existing_public_note_overlay_ambiguous';
    case 'xiaohongshu_reply_thread_target_unavailable': return 'reply_thread_target_unavailable';
    case 'xiaohongshu_public_note_document_unavailable':
    case 'xiaohongshu_public_note_document_changed':
    case 'xiaohongshu_comment_replies_new_tab_detected': return 'document_context_changed';
    case 'xiaohongshu_login_required': return 'login_required';
    case 'xiaohongshu_verification_required': return 'verification_required';
    case 'xiaohongshu_rate_limited': return 'rate_limited';
    case 'xiaohongshu_source_unavailable': return 'source_unavailable';
    case 'debugger_attach_failed': return 'debugger_attach_failed';
    case 'debugger_input_failed': return 'debugger_input_failed';
    case 'xiaohongshu_comment_replies_debugger_detach_failed': return 'debugger_detach_failed';
    default: return 'postcondition_unmet';
  }
}

function safeErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'xiaohongshu_comment_replies_failed';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
