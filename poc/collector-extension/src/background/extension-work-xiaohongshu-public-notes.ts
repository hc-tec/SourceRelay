import {
  XIAOHONGSHU_NOTE_PUBLIC_DETAIL_BUDGET,
  classifyXiaohongshuCurrentPageRisk,
  xiaohongshuCurrentPageNetworkPublicSurface,
  type XiaohongshuManagedSearchProjectionResult,
  type XiaohongshuNotePublicDetailWorkItem,
  type XiaohongshuPublicNotesSearchTerminalReason,
  type XiaohongshuPublicNotesSearchWorkItem,
  type XiaohongshuPublicNotesSearchWorkResult
} from '@intelligence/collector-contracts';
import {
  armXiaohongshuExistingExploreWorkObserver,
  clearXiaohongshuWorkObserver,
  readXiaohongshuExistingExploreWorkProjection
} from './xiaohongshu-current-page-network';
import { executeXiaohongshuTrustedInputSearch } from './xiaohongshu-trusted-input';
import { executeXiaohongshuNotePublicDetailExtensionWork } from './extension-work-xiaohongshu-note-public-detail';
import {
  abandonExtensionWorkTab,
  acquireExtensionWorkTab,
  navigateXiaohongshuExploreOnce,
  releaseExtensionWorkTab,
  type ExtensionWorkTabLease,
  type WorkTabAcquisition,
  type WorkTabDisposition
} from './extension-work-tabs';

export interface XiaohongshuPublicNotesSearchExtensionLifecycle {
  onWorkTabAcquired?(acquisition: WorkTabAcquisition): Promise<void>;
  onNavigationIntent?(): Promise<void>;
}

export async function executeXiaohongshuPublicNotesSearchExtensionWork(
  item: XiaohongshuPublicNotesSearchWorkItem,
  internalBinding: { expectedTabId?: number } = {},
  lifecycle: XiaohongshuPublicNotesSearchExtensionLifecycle = {}
): Promise<XiaohongshuPublicNotesSearchWorkResult> {
  const projectionBox: { value: XiaohongshuManagedSearchProjectionResult | null } = { value: null };
  const detailActions = { requestedCount: 0, attemptedCount: 0, completedCount: 0, stoppedReason: null as string | null };
  const commentsPlan = item.input.comments;
  let observedTabId: number | null = null;
  let workTab: ExtensionWorkTabLease | null = null;
  let acquisition: WorkTabAcquisition | 'not_acquired' = 'not_acquired';
  let navigationAttempted = false;
  let workTabDisposition: WorkTabDisposition = 'closed_or_missing';
  let action: Awaited<ReturnType<typeof executeXiaohongshuTrustedInputSearch>>;
  try {
    if (internalBinding.expectedTabId === undefined) {
      workTab = await acquireExtensionWorkTab();
      acquisition = workTab.acquisition;
      await lifecycle.onWorkTabAcquired?.(acquisition);
      await navigateXiaohongshuExploreOnce(workTab, async () => {
        navigationAttempted = true;
        await lifecycle.onNavigationIntent?.();
      });
      await waitForXiaohongshuExploreReady(workTab, item.expiresAt);
    }
    action = await executeXiaohongshuTrustedInputSearch({
      schemaVersion: 1,
      actionId: item.workId,
      workId: item.workId,
      runId: item.operationId,
      browserBindingId: item.browserBindingId,
      query: item.input.query,
      expiresAt: item.expiresAt
    }, {
      expectedTabId: workTab?.tabId ?? internalBinding.expectedTabId,
      onEligibleDocument: async (document) => {
        if (internalBinding.expectedTabId !== undefined && document.tabId !== internalBinding.expectedTabId) {
          throw new Error('xiaohongshu_trusted_input_document_changed');
        }
        observedTabId = document.tabId;
        await armXiaohongshuExistingExploreWorkObserver(document.tabId, item.workId);
      },
      onSearchPostcondition: async (document) => {
        projectionBox.value = await readXiaohongshuExistingExploreWorkProjection(document.tabId, item.workId);
        if (projectionBox.value.items.length < 1) throw new Error('xiaohongshu_trusted_input_postcondition_unmet');
        const requestedCount = Math.min(
          Math.max(0, Math.floor(item.input.maximumDetails ?? 0)),
          projectionBox.value.items.length
        );
        detailActions.requestedCount = requestedCount;
        if (requestedCount === 0) return;
        await waitForSearchDocumentStability(document.tabId, item.expiresAt);

        // The search observer owns the initial Explore lease. Detail work uses
        // the same managed tab and same document; it never opens a new tab.
        await clearXiaohongshuWorkObserver(document.tabId, item.workId);
        const details = [...(projectionBox.value.details ?? [])];
        for (let rank = 1; rank <= requestedCount; rank += 1) {
          detailActions.attemptedCount = rank;
          const detailItem = createDepthDetailWorkItem(item, rank);
          const detailResult = await executeXiaohongshuNotePublicDetailExtensionWork(detailItem, {
            closeOverlayAfterCapture: true,
            collectComments: commentsPlan ? { maximumScrolls: commentsPlan.maximumScrolls } : undefined,
            collectReplies: commentsPlan?.replies,
            debuggee: { tabId: document.tabId },
            expectedTabId: document.tabId,
            skipForeground: true
          });
          if (detailResult.state !== 'completed' || !detailResult.projection) {
            detailActions.stoppedReason = detailResult.errorCode ?? 'xiaohongshu_note_detail_postcondition_unmet';
            throw new Error(detailActions.stoppedReason);
          }
          const noteId = projectionBox.value.items[rank - 1]?.noteId;
          if (noteId) {
            const enriched = {
              noteId,
              publicText: detailResult.projection.publicText,
              authorNickname: detailResult.projection.authorNickname,
              interactionText: detailResult.projection.interactionText
            } as (typeof details)[number];
            if (detailResult.projection.comments) enriched.comments = detailResult.projection.comments;
            if (detailResult.projection.replyThread) enriched.replyThread = detailResult.projection.replyThread;
            if (detailResult.projection.replyThreads) enriched.replyThreads = detailResult.projection.replyThreads;
            const existingIndex = details.findIndex((detail) => detail.noteId === noteId);
            if (existingIndex >= 0) details[existingIndex] = { ...details[existingIndex], ...enriched };
            else details.push(enriched);
          }
          detailActions.completedCount = rank;
          if (rank < requestedCount) await delay(1_500);
        }
        projectionBox.value = { ...projectionBox.value, details: details.slice(0, 40) };
      }
    });
    if (workTab) {
      workTabDisposition = action.state === 'completed'
        ? releaseExtensionWorkTab(workTab)
        : abandonExtensionWorkTab(workTab);
      workTab = null;
    }
  } catch (error) {
    const errorCode = safeErrorCode(error);
    if (workTab) {
      workTabDisposition = navigationAttempted
        ? abandonExtensionWorkTab(workTab)
        : releaseExtensionWorkTab(workTab);
      workTab = null;
    }
    action = {
      schemaVersion: 1,
      actionId: item.workId,
      state: 'stopped',
      errorCode,
      semanticAction: { attempted: false, attemptCount: 0 },
      input: { queryEchoed: false, enterAttempted: false },
      page: null,
      debuggerDetached: true
    };
  }
  const projection = projectionBox.value;
  const depthRequested = detailActions.requestedCount > 0;
  const depthCompleted = !depthRequested || detailActions.completedCount === detailActions.requestedCount;
  const completed = action.state === 'completed' && projection !== null && projection.items.length > 0 && depthCompleted;
  const depthStopped = depthRequested && !depthCompleted;
  const result: XiaohongshuPublicNotesSearchWorkResult = {
    schemaVersion: 1,
    protocolVersion: 1,
    workId: item.workId,
    operationId: item.operationId,
    browserBindingId: item.browserBindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.search.public_notes.v1',
    executionTarget: 'existing_public_explore_tab',
    state: completed ? 'completed' : 'stopped',
    errorCode: completed ? null : depthStopped
      ? detailActions.stoppedReason ?? action.errorCode ?? 'xiaohongshu_note_detail_postcondition_unmet'
      : action.errorCode ?? 'xiaohongshu_trusted_input_postcondition_unmet',
    terminalReason: completed
      ? depthRequested ? 'search_depth_ready' : 'search_ready'
      : depthStopped ? 'search_depth_stopped' : terminalReason(action.errorCode),
    completedAt: new Date().toISOString(),
    navigation: { attempted: navigationAttempted, attemptCount: navigationAttempted ? 1 : 0 },
    ...(internalBinding.expectedTabId === undefined
      ? { workTabAcquisition: acquisition, workTabDisposition }
      : {}),
    semanticAction: action.semanticAction,
    input: action.input,
    detailActions: depthRequested ? detailActions : undefined,
    page: action.page?.publicSurface === 'search'
      ? { publicSurface: 'search', renderedCardCount: Math.min(40, action.page.renderedCardCount) }
      : null,
    projection,
    rawPayloadStored: false,
    responseUrlsStored: false,
    debuggerDetached: action.debuggerDetached
  };
  if (observedTabId !== null) await clearXiaohongshuWorkObserver(observedTabId, item.workId).catch(() => undefined);
  return result;
}

async function waitForXiaohongshuExploreReady(
  workTab: ExtensionWorkTabLease,
  expiresAt: string
): Promise<void> {
  const deadline = Math.min(Date.parse(expiresAt), Date.now() + 30_000);
  let prerequisiteRisk: { code: string } | null = null;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(workTab.tabId).catch(() => null);
    if (!tab) throw new Error('work_tab_closed');
    if (tab.status === 'complete' && xiaohongshuCurrentPageNetworkPublicSurface(tab.url ?? '') === 'explore') {
      const frame = await chrome.webNavigation.getFrame({ tabId: workTab.tabId, frameId: 0 }).catch(() => null);
      if (frame?.documentId && xiaohongshuCurrentPageNetworkPublicSurface(frame.url) === 'explore') return;
    }
    if (tab.status === 'complete') {
      prerequisiteRisk = await readXiaohongshuExplorePrerequisiteRisk(workTab.tabId);
      if (prerequisiteRisk) throw new Error(prerequisiteRisk.code);
    }
    await delay(300);
  }
  throw new Error(prerequisiteRisk?.code ?? 'xiaohongshu_explore_navigation_not_ready');
}

/**
 * Read-only prerequisite classification for a managed Explore navigation that
 * finished loading outside the Explore surface. Only public pathname/title are
 * read; a security-verification document body is never captured. This lets the
 * runner stop with the platform's real gate instead of waiting the full
 * readiness budget and reporting a generic not-ready error.
 */
async function readXiaohongshuExplorePrerequisiteRisk(
  tabId: number
): Promise<{ code: string } | null> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      pathname: location.pathname,
      title: document.title.slice(0, 300)
    })
  });
  const probe = results[0]?.result;
  if (!probe || typeof probe.pathname !== 'string' || typeof probe.title !== 'string') return null;
  const risk = classifyXiaohongshuCurrentPageRisk({
    pathname: probe.pathname,
    title: probe.title,
    visibleText: ''
  });
  if (risk.loginRequired) return { code: 'xiaohongshu_login_required' };
  if (risk.verificationRequired) return { code: 'xiaohongshu_verification_required' };
  if (risk.rateLimited) return { code: 'xiaohongshu_rate_limited' };
  if (risk.sourceUnavailable) return { code: 'xiaohongshu_source_unavailable' };
  return null;
}

function createDepthDetailWorkItem(
  item: XiaohongshuPublicNotesSearchWorkItem,
  resultRank: number
): XiaohongshuNotePublicDetailWorkItem {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    workId: crypto.randomUUID(),
    operationId: item.operationId,
    browserBindingId: item.browserBindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.note.public_detail.v1',
    executionTarget: 'existing_public_search_tab',
    issuedAt: new Date().toISOString(),
    expiresAt: item.expiresAt,
    input: { resultRank },
    budget: XIAOHONGSHU_NOTE_PUBLIC_DETAIL_BUDGET,
    gatewaySignature: 'a'.repeat(64)
  };
}

function terminalReason(errorCode: string | null): XiaohongshuPublicNotesSearchTerminalReason {
  switch (errorCode) {
    case 'xiaohongshu_trusted_input_explore_tab_required':
      return 'existing_public_explore_tab_required';
    case 'xiaohongshu_trusted_input_explore_tab_ambiguous':
      return 'existing_public_explore_tab_ambiguous';
    case 'xiaohongshu_trusted_input_document_changed':
    case 'xiaohongshu_trusted_input_explore_document_unavailable':
    case 'xiaohongshu_current_page_network_selection_active':
      return 'document_context_changed';
    case 'xiaohongshu_trusted_input_search_target_unavailable':
      return 'search_target_unavailable';
    case 'xiaohongshu_trusted_input_query_not_echoed':
      return 'query_not_echoed';
    case 'xiaohongshu_current_page_network_permission_required':
      return 'permission_required';
    case 'xiaohongshu_login_required':
      return 'login_required';
    case 'xiaohongshu_verification_required':
      return 'verification_required';
    case 'xiaohongshu_rate_limited':
      return 'rate_limited';
    case 'xiaohongshu_source_unavailable':
      return 'source_unavailable';
    case 'xiaohongshu_trusted_input_debugger_detach_failed':
      return 'debugger_detach_failed';
    case 'debugger_attach_failed':
      return 'debugger_attach_failed';
    case 'debugger_input_failed':
      return 'debugger_input_failed';
    case 'xiaohongshu_trusted_input_action_already_claimed':
      return 'action_already_claimed';
    case 'xiaohongshu_trusted_input_action_in_progress':
      return 'action_in_progress';
    case 'xiaohongshu_trusted_input_action_expired':
      return 'action_expired';
    case 'xiaohongshu_trusted_input_query_echo_unavailable':
      return 'query_echo_unavailable';
    case 'xiaohongshu_trusted_input_postcondition_unavailable':
      return 'postcondition_unavailable';
    case 'xiaohongshu_trusted_input_postcondition_unmet':
      return 'postcondition_unmet';
    case 'work_tab_foreground_unavailable':
      return 'work_tab_foreground_unavailable';
    case 'xiaohongshu_public_search_document_changed':
      return 'document_context_changed';
    case 'xiaohongshu_explore_navigation_not_ready':
      return 'explore_navigation_not_ready';
    default:
      return 'postcondition_unmet';
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function safeErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'xiaohongshu_search_execution_failed';
}

async function waitForSearchDocumentStability(tabId: number, expiresAt: string): Promise<void> {
  let previousDocumentId = '';
  let stableSamples = 0;
  const deadline = Math.min(Date.parse(expiresAt), Date.now() + 5_000);
  while (Date.now() < deadline) {
    const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 }).catch(() => null);
    const surface = frame?.url ? xiaohongshuCurrentPageNetworkPublicSurface(frame.url) : null;
    if (frame?.documentId && surface === 'search') {
      stableSamples = frame.documentId === previousDocumentId ? stableSamples + 1 : 1;
      previousDocumentId = frame.documentId;
      if (stableSamples >= 2) return;
    } else {
      stableSamples = 0;
      previousDocumentId = '';
    }
    await delay(250);
  }
  throw new Error('xiaohongshu_public_search_document_changed');
}
