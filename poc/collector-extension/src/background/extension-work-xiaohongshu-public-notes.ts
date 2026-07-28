import {
  type XiaohongshuManagedSearchProjectionResult,
  type XiaohongshuPublicNotesSearchTerminalReason,
  type XiaohongshuPublicNotesSearchWorkItem,
  type XiaohongshuPublicNotesSearchWorkResult
} from '@intelligence/collector-contracts';
import {
  armXiaohongshuExistingExploreWorkObserver,
  readXiaohongshuExistingExploreWorkProjection
} from './xiaohongshu-current-page-network';
import { executeXiaohongshuTrustedInputSearch } from './xiaohongshu-trusted-input';

export async function executeXiaohongshuPublicNotesSearchExtensionWork(
  item: XiaohongshuPublicNotesSearchWorkItem
): Promise<XiaohongshuPublicNotesSearchWorkResult> {
  const projectionBox: { value: XiaohongshuManagedSearchProjectionResult | null } = { value: null };
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
      await armXiaohongshuExistingExploreWorkObserver(document.tabId, item.workId);
    },
    onSearchPostcondition: async (document) => {
      projectionBox.value = await readXiaohongshuExistingExploreWorkProjection(document.tabId, item.workId);
      if (projectionBox.value.items.length < 1) throw new Error('xiaohongshu_trusted_input_postcondition_unmet');
    }
  });
  const projection = projectionBox.value;
  const completed = action.state === 'completed' && projection !== null && projection.items.length > 0;
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    workId: item.workId,
    operationId: item.operationId,
    browserBindingId: item.browserBindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.search.public_notes.v1',
    executionTarget: 'existing_public_explore_tab',
    state: completed ? 'completed' : 'stopped',
    errorCode: completed ? null : action.errorCode ?? 'xiaohongshu_trusted_input_postcondition_unmet',
    terminalReason: completed ? 'search_ready' : terminalReason(action.errorCode),
    completedAt: new Date().toISOString(),
    navigation: { attempted: false, attemptCount: 0 },
    semanticAction: action.semanticAction,
    input: action.input,
    page: action.page?.publicSurface === 'search'
      ? { publicSurface: 'search', renderedCardCount: Math.min(40, action.page.renderedCardCount) }
      : null,
    projection,
    rawPayloadStored: false,
    responseUrlsStored: false,
    debuggerDetached: action.debuggerDetached
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
