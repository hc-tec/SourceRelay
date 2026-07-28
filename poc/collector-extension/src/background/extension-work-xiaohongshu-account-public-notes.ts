import {
  classifyXiaohongshuCurrentPageRisk,
  xiaohongshuCurrentPageNetworkPublicSurface,
  type XiaohongshuAccountPublicNotesTerminalReason,
  type XiaohongshuAccountPublicNotesWorkItem,
  type XiaohongshuAccountPublicNotesWorkResult,
  type XiaohongshuManagedProfileNotesProjectionResult
} from '@intelligence/collector-contracts';
import {
  armXiaohongshuExistingPublicProfileWorkObserver,
  clearXiaohongshuWorkObserver,
  readXiaohongshuExistingPublicProfileWorkProjection
} from './xiaohongshu-current-page-network';
import {
  completeXiaohongshuProfileScroll,
  prepareXiaohongshuProfileScroll,
  recordXiaohongshuProfileScrollIntent
} from './xiaohongshu-profile-scroll-ledger';

interface ProfileDocument {
  tabId: number;
  windowId: number;
  documentId: string;
}

export async function executeXiaohongshuAccountPublicNotesExtensionWork(
  item: XiaohongshuAccountPublicNotesWorkItem
): Promise<XiaohongshuAccountPublicNotesWorkResult> {
  let document: ProfileDocument | null = null;
  let attached = false;
  let debuggerDetached = true;
  let attemptedCount: 0 | 1 | 2 | 3 = 0;
  let completedCount: 0 | 1 | 2 | 3 = 0;
  let projection: XiaohongshuManagedProfileNotesProjectionResult | null = null;
  let renderedCardCount = 0;
  let errorCode: string | null = null;
  try {
    document = await findUniquePublicProfileDocument();
    await foreground(document);
    await requireSameDocument(document);
    const baseline = await readPageProbe(document);
    assertRisk(baseline.risk);
    await armXiaohongshuExistingPublicProfileWorkObserver(document.tabId, item.workId);
    await prepareXiaohongshuProfileScroll(item.workId);
    const debuggee: chrome.debugger.Debuggee = { tabId: document.tabId };
    await chrome.debugger.attach(debuggee, '1.3').catch(() => {
      throw new Error('debugger_attach_failed');
    });
    attached = true;
    debuggerDetached = false;
    for (let index = 1; index <= item.input.maximumScrolls; index += 1) {
      await requireSameDocument(document);
      await recordXiaohongshuProfileScrollIntent(item.workId, index as 1 | 2 | 3);
      attemptedCount = index as 1 | 2 | 3;
      const viewport = await readPageProbe(document);
      await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: Math.floor(viewport.viewportWidth / 2),
        y: Math.floor(viewport.viewportHeight * 0.8),
        deltaX: 0,
        deltaY: Math.max(320, Math.floor(viewport.viewportHeight * 0.75))
      }).catch(() => {
        throw new Error('debugger_input_failed');
      });
      completedCount = index as 1 | 2 | 3;
      await delay(1_400);
      const afterScroll = await readPageProbe(document);
      assertRisk(afterScroll.risk);
    }
    await completeXiaohongshuProfileScroll(item.workId);
    projection = await readXiaohongshuExistingPublicProfileWorkProjection(document.tabId, item.workId);
    const page = await readPageProbe(document);
    renderedCardCount = page.renderedCardCount;
    assertRisk(page.risk);
    if (projection.items.length < 1 || renderedCardCount < 1) {
      throw new Error('xiaohongshu_profile_notes_postcondition_unmet');
    }
  } catch (error) {
    errorCode = safeErrorCode(error);
  } finally {
    if (attached && document) {
      try {
        await chrome.debugger.detach({ tabId: document.tabId });
        debuggerDetached = true;
      } catch {
        debuggerDetached = false;
        errorCode = 'xiaohongshu_profile_scroll_debugger_detach_failed';
      }
    }
    if (document) await clearXiaohongshuWorkObserver(document.tabId, item.workId).catch(() => undefined);
  }
  const completed = errorCode === null && projection !== null && projection.items.length > 0 &&
    attemptedCount === item.input.maximumScrolls && debuggerDetached;
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    workId: item.workId,
    operationId: item.operationId,
    browserBindingId: item.browserBindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.account.public_notes.v1',
    executionTarget: 'existing_public_profile_tab',
    state: completed ? 'completed' : 'stopped',
    errorCode: completed ? null : errorCode ?? 'xiaohongshu_profile_notes_postcondition_unmet',
    terminalReason: completed ? 'profile_notes_ready' : terminalReason(errorCode),
    completedAt: new Date().toISOString(),
    navigation: { attempted: false, attemptCount: 0 },
    semanticAction: { attempted: attemptedCount > 0, attemptCount: attemptedCount },
    scroll: { requestedCount: item.input.maximumScrolls, completedCount },
    page: renderedCardCount > 0
      ? { publicSurface: 'public_profile', renderedCardCount: Math.min(80, renderedCardCount) }
      : null,
    projection,
    rawPayloadStored: false,
    responseUrlsStored: false,
    debuggerDetached
  };
}

async function findUniquePublicProfileDocument(): Promise<ProfileDocument> {
  const tabs = await chrome.tabs.query({ url: ['https://www.xiaohongshu.com/user/profile/*'] });
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

async function foreground(document: ProfileDocument): Promise<void> {
  await chrome.windows.update(document.windowId, { focused: true }).catch(() => undefined);
  await chrome.tabs.update(document.tabId, { active: true });
  await delay(350);
}

async function requireSameDocument(document: ProfileDocument): Promise<void> {
  const tab = await chrome.tabs.get(document.tabId).catch(() => null);
  const frame = await chrome.webNavigation.getFrame({ tabId: document.tabId, frameId: 0 }).catch(() => null);
  if (!tab || tab.windowId !== document.windowId || tab.incognito || !frame ||
    frame.documentId !== document.documentId ||
    xiaohongshuCurrentPageNetworkPublicSurface(frame.url) !== 'public_profile') {
    throw new Error('xiaohongshu_public_profile_document_changed');
  }
}

async function readPageProbe(profileDocument: ProfileDocument): Promise<{
  renderedCardCount: number;
  viewportWidth: number;
  viewportHeight: number;
  risk: ReturnType<typeof classifyXiaohongshuCurrentPageRisk>;
}> {
  const results = await chrome.scripting.executeScript({
    target: { tabId: profileDocument.tabId, documentIds: [profileDocument.documentId] },
    func: () => ({
      pathname: location.pathname,
      title: document.title.slice(0, 300),
      visibleText: (document.body?.innerText ?? '').slice(0, 12_000),
      renderedCardCount: document.querySelectorAll('section.note-item').length,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    })
  });
  const value = results[0]?.result;
  if (!value || typeof value.pathname !== 'string' || typeof value.title !== 'string' ||
    typeof value.visibleText !== 'string' || !Number.isSafeInteger(value.renderedCardCount) ||
    !Number.isFinite(value.viewportWidth) || !Number.isFinite(value.viewportHeight) ||
    value.viewportWidth < 320 || value.viewportHeight < 240) {
    throw new Error('xiaohongshu_public_profile_probe_unavailable');
  }
  return {
    renderedCardCount: Math.min(80, Math.max(0, value.renderedCardCount)),
    viewportWidth: value.viewportWidth,
    viewportHeight: value.viewportHeight,
    risk: classifyXiaohongshuCurrentPageRisk(value)
  };
}

function assertRisk(risk: ReturnType<typeof classifyXiaohongshuCurrentPageRisk>): void {
  if (risk.verificationRequired) throw new Error('xiaohongshu_verification_required');
  if (risk.rateLimited) throw new Error('xiaohongshu_rate_limited');
  if (risk.sourceUnavailable) throw new Error('xiaohongshu_source_unavailable');
  if (risk.loginRequired) throw new Error('xiaohongshu_login_required');
}

function terminalReason(errorCode: string | null): XiaohongshuAccountPublicNotesTerminalReason {
  switch (errorCode) {
    case 'xiaohongshu_public_profile_tab_required': return 'existing_public_profile_tab_required';
    case 'xiaohongshu_public_profile_tab_ambiguous': return 'existing_public_profile_tab_ambiguous';
    case 'xiaohongshu_public_profile_document_unavailable':
    case 'xiaohongshu_public_profile_document_changed':
    case 'xiaohongshu_current_page_network_selection_active': return 'document_context_changed';
    case 'xiaohongshu_current_page_network_permission_required': return 'permission_required';
    case 'xiaohongshu_login_required': return 'login_required';
    case 'xiaohongshu_verification_required': return 'verification_required';
    case 'xiaohongshu_rate_limited': return 'rate_limited';
    case 'xiaohongshu_source_unavailable': return 'source_unavailable';
    case 'debugger_attach_failed': return 'debugger_attach_failed';
    case 'debugger_input_failed': return 'debugger_input_failed';
    case 'xiaohongshu_profile_scroll_debugger_detach_failed': return 'debugger_detach_failed';
    default: return 'postcondition_unmet';
  }
}

function safeErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'xiaohongshu_profile_notes_failed';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
