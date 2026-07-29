import {
  XIAOHONGSHU_NOTE_PUBLIC_DETAIL_BUDGET,
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

export async function executeXiaohongshuPublicNotesSearchExtensionWork(
  item: XiaohongshuPublicNotesSearchWorkItem,
  internalBinding: { expectedTabId?: number } = {}
): Promise<XiaohongshuPublicNotesSearchWorkResult> {
  const projectionBox: { value: XiaohongshuManagedSearchProjectionResult | null } = { value: null };
  const detailActions = { requestedCount: 0, attemptedCount: 0, completedCount: 0, stoppedReason: null as string | null };
  const commentsPlan = item.input.comments;
  let observedTabId: number | null = null;
  const action = await executeXiaohongshuTrustedInputSearch({
    schemaVersion: 1,
    actionId: item.workId,
    workId: item.workId,
    runId: item.operationId,
    browserBindingId: item.browserBindingId,
    query: item.input.query,
    expiresAt: item.expiresAt
  }, {
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
      // its own short-lived same-document lease so each ranked click is
      // independently at-most-once and can be stopped without replaying the
      // search action.
      await clearXiaohongshuWorkObserver(document.tabId, item.workId);
      const details = [...(projectionBox.value.details ?? [])];
      for (let rank = 1; rank <= requestedCount; rank += 1) {
        detailActions.attemptedCount = rank;
        const detailItem = createDepthDetailWorkItem(item, rank);
        const detailResult = await executeXiaohongshuNotePublicDetailExtensionWork(detailItem, {
          closeOverlayAfterCapture: true,
          collectComments: commentsPlan ? { maximumScrolls: commentsPlan.maximumScrolls } : undefined,
          collectReplies: commentsPlan?.replies,
          debuggee: { tabId: document.tabId }
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
          const existingIndex = details.findIndex((detail) => detail.noteId === noteId);
          if (existingIndex >= 0) details[existingIndex] = { ...details[existingIndex], ...enriched };
          else {
            details.push(enriched);
          }
        }
        detailActions.completedCount = rank;
        if (rank < requestedCount) await delay(1_500);
      }
      projectionBox.value = { ...projectionBox.value, details: details.slice(0, 40) };
    }
  });
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
    navigation: { attempted: false, attemptCount: 0 },
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
    default:
      return 'postcondition_unmet';
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
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
