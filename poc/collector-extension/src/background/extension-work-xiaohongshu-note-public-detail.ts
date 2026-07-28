import {
  classifyXiaohongshuCurrentPageRisk,
  xiaohongshuCurrentPageNetworkPublicSurface,
  type XiaohongshuNotePublicDetailProjection,
  type XiaohongshuNotePublicDetailTerminalReason,
  type XiaohongshuNotePublicDetailWorkItem,
  type XiaohongshuNotePublicDetailWorkResult
} from '@intelligence/collector-contracts';
import {
  armXiaohongshuExistingSearchWorkObserver,
  clearXiaohongshuWorkObserver,
  readXiaohongshuExistingSearchNoteDetailNetworkProjection
} from './xiaohongshu-current-page-network';
import {
  completeXiaohongshuNoteDetailClick,
  prepareXiaohongshuNoteDetailClick,
  recordXiaohongshuNoteDetailClickIntent
} from './xiaohongshu-note-detail-click-ledger';

interface SearchDocument { tabId: number; windowId: number; documentId: string }
interface Target { x: number; y: number }
interface DomProjection {
  publicText: string;
  authorNickname: string;
  interactionText: string;
  visibleMediaCount: number;
  commentEntryVisible: boolean;
}

export async function executeXiaohongshuNotePublicDetailExtensionWork(
  item: XiaohongshuNotePublicDetailWorkItem
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
    await requireSameDocument(pageDocument);
    const baseline = await readRisk(pageDocument);
    assertRisk(baseline);
    const target = await findRankedDetailTarget(pageDocument, item.input.resultRank);
    await armXiaohongshuExistingSearchWorkObserver(pageDocument.tabId, item.workId);
    await prepareXiaohongshuNoteDetailClick(item.workId);
    const debuggee: chrome.debugger.Debuggee = { tabId: pageDocument.tabId };
    await chrome.debugger.attach(debuggee, '1.3').catch(() => { throw new Error('debugger_attach_failed'); });
    attached = true;
    debuggerDetached = false;
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

async function findUniqueSearchDocument(): Promise<SearchDocument> {
  const tabs = await chrome.tabs.query({ url: ['https://www.xiaohongshu.com/search_result*'] });
  const eligible = tabs.filter((tab) => Number.isSafeInteger(tab.id) && Number.isSafeInteger(tab.windowId) &&
    !tab.incognito && tab.status === 'complete' &&
    xiaohongshuCurrentPageNetworkPublicSurface(tab.url ?? '') === 'search');
  if (eligible.length === 0) throw new Error('xiaohongshu_public_search_tab_required');
  if (eligible.length !== 1) throw new Error('xiaohongshu_public_search_tab_ambiguous');
  const tab = eligible[0]!;
  const frame = await chrome.webNavigation.getFrame({ tabId: tab.id!, frameId: 0 }).catch(() => null);
  if (!frame?.documentId || xiaohongshuCurrentPageNetworkPublicSurface(frame.url) !== 'search') {
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
    xiaohongshuCurrentPageNetworkPublicSurface(frame.url) !== 'search') {
    throw new Error('xiaohongshu_public_search_document_changed');
  }
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
      if (!hit || !section.contains(hit)) return null;
      if (anchor instanceof HTMLAnchorElement && anchor.target && anchor.target !== '_self') {
        return { newTab: true, x, y };
      }
      return { newTab: false, x, y };
    }
  });
  const value = results[0]?.result;
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new Error('xiaohongshu_search_result_rank_unavailable');
  }
  if (value.newTab) throw new Error('xiaohongshu_note_detail_target_new_tab');
  return { x: value.x, y: value.y };
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
        )).filter(visible).sort((left, right) => {
          const l = left.getBoundingClientRect();
          const r = right.getBoundingClientRect();
          return (r.width * r.height) - (l.width * l.height);
        });
        const overlay = roots.find((root) => root.querySelector('a[href*="/user/profile/"]')) ?? roots[0] ?? null;
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
