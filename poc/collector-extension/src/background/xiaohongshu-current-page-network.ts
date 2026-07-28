import {
  XIAOHONGSHU_CURRENT_PAGE_NETWORK_BUDGET,
  XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION,
  XIAOHONGSHU_CURRENT_PAGE_NETWORK_SELECTION_TTL_MS,
  classifyXiaohongshuCurrentPageRisk,
  xiaohongshuCurrentPageNetworkPublicSurface as baseXiaohongshuCurrentPageNetworkPublicSurface,
  isXiaohongshuManagedSearchProjectionResult,
  isXiaohongshuManagedProfileNotesProjectionResult,
  type XiaohongshuManagedPageNetworkObservationResult,
  type XiaohongshuManagedPageNetworkObserverArmResult,
  type XiaohongshuManagedPageNetworkObserverRequest,
  type XiaohongshuManagedSearchProjectionResult,
  type XiaohongshuManagedProfileNotesProjectionResult,
  type XiaohongshuCurrentPageNetworkObservationResult,
  type XiaohongshuCurrentPageNetworkPermissionState,
  type XiaohongshuCurrentPageNetworkSelectionSummary
} from '@intelligence/collector-contracts';
import {
  classifyExcludedRouteCategory,
  emptyExcludedRouteCounts,
  emptyRisk,
  isXiaohongshuRiskSignal,
  noSelectionSummary,
  observationFor,
  parseXiaohongshuCurrentPageNetworkRecord,
  recordMatchesManagedPageRun,
  selectionSummary,
  type XiaohongshuCurrentPageNetworkRecord
} from './xiaohongshu-current-page-network-state';

function xiaohongshuCurrentPageNetworkPublicSurface(value: string) {
  const base = baseXiaohongshuCurrentPageNetworkPublicSurface(value);
  if (base) return base;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.xiaohongshu.com' && !url.port && !url.username &&
      !url.password && !url.hash && /^\/explore\/[^/]+\/?$/.test(url.pathname)
      ? 'public_note_detail' as const : null;
  } catch { return null; }
}

const XIAOHONGSHU_ORIGIN = 'https://www.xiaohongshu.com/*';
const XIAOHONGSHU_CURRENT_PAGE_NETWORK_STORAGE_KEY =
  'collector.xiaohongshu.current-page-network.v1';

let initialised = false;
let networkMetadataListenerRegistered = false;
const networkMetadataListener = (details: chrome.webRequest.OnCompletedDetails): void => {
  void recordNetworkMetadata(details.tabId, details.url, details.type);
};

/**
 * Called only from an extension-popup user gesture. It requests the optional
 * metadata-only permission, verifies that the selected tab is already a
 * recognised public Xiaohongshu surface, then waits for the person's next
 * top-level navigation in that same tab. It never performs that navigation.
 */
export async function armNextXiaohongshuCurrentPageNetworkDocument(): Promise<
  XiaohongshuCurrentPageNetworkSelectionSummary
> {
  const permitted = await chrome.permissions.request({
    permissions: ['webRequest'],
    origins: [XIAOHONGSHU_ORIGIN]
  });
  if (!permitted) throw new Error('xiaohongshu_current_page_network_permission_required');

  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs.length === 1 ? tabs[0] : null;
  const tabId = tab?.id;
  if (!tab || typeof tabId !== 'number' || !Number.isSafeInteger(tabId)) {
    throw new Error('xiaohongshu_current_page_network_current_tab_unavailable');
  }
  const record = await armSpecificXiaohongshuTab(tabId, null);
  return selectionSummary(record);
}

/**
 * Internal managed-validation binding. Browser Host derives tabId from an
 * exact PageLease. This path never requests permission and never opens or
 * drives extension UI.
 */
export async function armXiaohongshuManagedPageNetworkObserver(
  tabId: number,
  request: XiaohongshuManagedPageNetworkObserverRequest
): Promise<XiaohongshuManagedPageNetworkObserverArmResult> {
  const permissionState = await xiaohongshuCurrentPageNetworkPermissionState();
  if (permissionState === 'permission_required') {
    return {
      schemaVersion: XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION,
      type: 'xiaohongshu_managed_page_network_observer_armed',
      pageAlias: request.pageAlias,
      runId: request.runId,
      permissionState,
      selection: noSelectionSummary()
    };
  }
  const current = await loadActiveRecord();
  const record = recordMatchesManagedPageRun(current, tabId, request.runId)
    ? current
    : await armManagedXiaohongshuCurrentDocument(tabId, request.runId, current);
  return {
    schemaVersion: XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION,
    type: 'xiaohongshu_managed_page_network_observer_armed',
    pageAlias: request.pageAlias,
    runId: request.runId,
    permissionState,
    selection: selectionSummary(record)
  };
}

export async function readXiaohongshuManagedSearchProjection(
  tabId: number,
  request: XiaohongshuManagedPageNetworkObserverRequest
): Promise<XiaohongshuManagedSearchProjectionResult> {
  const record = await loadActiveRecord();
  if (!recordMatchesManagedPageRun(record, tabId, request.runId) || !record.documentId) {
    throw new Error('xiaohongshu_managed_search_projection_binding_mismatch');
  }
  const results = await chrome.scripting.executeScript({
    target: { tabId, documentIds: [record.documentId] },
    world: 'MAIN',
    func: () => {
      const key = '__personalIntelligenceXiaohongshuPublicNotesObserverV2';
      return (window as typeof window & { [key]?: unknown })[key] ?? null;
    }
  });
  const candidate = results[0]?.result as Record<string, unknown> | null | undefined;
  const rawItems = Array.isArray(candidate?.items) ? candidate.items.slice(0, 40) : [];
  const items = rawItems.map((value, index) => {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const text = (field: string, maximum: number): string =>
      (typeof item[field] === 'string' ? item[field] as string : '').replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ').trim().slice(0, maximum);
    return {
      rank: index + 1,
      noteId: text('noteId', 80),
      title: text('title', 500),
      contentType: text('contentType', 40),
      authorId: text('authorId', 80),
      authorNickname: text('authorNickname', 200),
      likedCountText: text('likedCountText', 40)
    };
  }).filter((item) => item.noteId && item.title);
  const result: XiaohongshuManagedSearchProjectionResult = {
    schemaVersion: XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION,
    type: 'xiaohongshu_managed_search_projection',
    pageAlias: request.pageAlias,
    runId: request.runId,
    matchedPayloadCount: Number.isSafeInteger(candidate?.matchedPayloadCount)
      ? Math.min(8, Math.max(0, Number(candidate?.matchedPayloadCount))) : 0,
    bodyBytesRead: Number.isSafeInteger(candidate?.bodyBytesRead)
      ? Math.min(16 * 1024 * 1024, Math.max(0, Number(candidate?.bodyBytesRead))) : 0,
    rawPayloadStored: false,
    responseUrlsStored: false,
    items
  };
  if (!isXiaohongshuManagedSearchProjectionResult(result)) {
    throw new Error('xiaohongshu_managed_search_projection_invalid');
  }
  return result;
}

/**
 * User-browser work binds the same bounded MAIN-world observer to the exact
 * internally selected Explore document. No tab/document identity crosses the
 * Gateway contract, and this function never requests a permission prompt.
 */
export async function armXiaohongshuExistingExploreWorkObserver(
  tabId: number,
  workId: string
): Promise<void> {
  const permissionState = await xiaohongshuCurrentPageNetworkPermissionState();
  if (permissionState !== 'permission_granted') {
    throw new Error('xiaohongshu_current_page_network_permission_required');
  }
  const current = await loadActiveRecord();
  if (current && !recordMatchesManagedPageRun(current, tabId, workId)) {
    throw new Error('xiaohongshu_current_page_network_selection_active');
  }
  if (!current) await armManagedXiaohongshuCurrentDocument(tabId, workId, null, 'explore');
  await mutateMainWorldCommentContinuity(tabId, workId, 'reset');
}

export async function armXiaohongshuExistingPublicProfileWorkObserver(
  tabId: number,
  workId: string
): Promise<void> {
  const permissionState = await xiaohongshuCurrentPageNetworkPermissionState();
  if (permissionState !== 'permission_granted') {
    throw new Error('xiaohongshu_current_page_network_permission_required');
  }
  const current = await loadActiveRecord();
  if (current && !recordMatchesManagedPageRun(current, tabId, workId)) {
    throw new Error('xiaohongshu_current_page_network_selection_active');
  }
  if (!current) {
    await armManagedXiaohongshuCurrentDocument(tabId, workId, null, 'public_profile', false, true);
  }
}

export async function armXiaohongshuExistingSearchWorkObserver(
  tabId: number,
  workId: string
): Promise<void> {
  const permissionState = await xiaohongshuCurrentPageNetworkPermissionState();
  if (permissionState !== 'permission_granted') {
    throw new Error('xiaohongshu_current_page_network_permission_required');
  }
  const current = await loadActiveRecord();
  if (current && !recordMatchesManagedPageRun(current, tabId, workId)) {
    throw new Error('xiaohongshu_current_page_network_selection_active');
  }
  if (!current) await armManagedXiaohongshuCurrentDocument(tabId, workId, null, 'search', true);
}

export async function bindXiaohongshuObserverSelectedNote(
  tabId: number,
  workId: string,
  noteId: string
): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(noteId)) throw new Error('xiaohongshu_selected_note_identity_invalid');
  await mutateMainWorldCommentContinuity(tabId, workId, 'select', noteId);
}

export async function armXiaohongshuExistingNoteOverlayWorkObserver(
  tabId: number,
  workId: string
): Promise<void> {
  const permissionState = await xiaohongshuCurrentPageNetworkPermissionState();
  if (permissionState !== 'permission_granted') {
    throw new Error('xiaohongshu_current_page_network_permission_required');
  }
  const current = await loadActiveRecord();
  if (current && !recordMatchesManagedPageRun(current, tabId, workId)) {
    throw new Error('xiaohongshu_current_page_network_selection_active');
  }
  if (!current) await armManagedXiaohongshuCurrentDocument(tabId, workId, null, 'public_note_detail');
}

export async function readXiaohongshuExistingNoteCommentsNetworkProjection(
  tabId: number,
  workId: string
): Promise<{
  matchedPayloadCount: number;
  bodyBytesRead: number;
  hasMore: boolean | null;
  cursorObserved: boolean;
  comments: Array<{
    commentId: string;
    publicText: string;
    authorNickname: string;
    likedCountText: string;
    subCommentCountText: string;
    createdAtText: string;
    locationText: string;
  }>;
}> {
  const record = await loadActiveRecord();
  if (!recordMatchesManagedPageRun(record, tabId, workId) || !record.documentId ||
    record.publicSurface !== 'public_note_detail') {
    throw new Error('xiaohongshu_note_comments_network_projection_binding_mismatch');
  }
  const results = await chrome.scripting.executeScript({
    target: { tabId, documentIds: [record.documentId] },
    world: 'MAIN',
    func: () => {
      const key = '__personalIntelligenceXiaohongshuPublicNotesObserverV2';
      return (window as typeof window & { [key]?: unknown })[key] ?? null;
    }
  });
  const candidate = results[0]?.result as Record<string, unknown> | null | undefined;
  const clean = (value: unknown, maximum: number): string =>
    (typeof value === 'string' || typeof value === 'number' ? String(value) : '')
      .replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, maximum);
  const selectedNoteId = typeof candidate?.selectedNoteId === 'string' ? candidate.selectedNoteId : '';
  const currentComments = Array.isArray(candidate?.comments) ? candidate.comments : [];
  const archivedComments = Date.now() < Number(candidate?.commentArchiveExpiresAt) && selectedNoteId &&
    Array.isArray(candidate?.commentArchive)
    ? candidate.commentArchive.filter((value) => value && typeof value === 'object' &&
      (value as Record<string, unknown>).parentNoteId === selectedNoteId) : [];
  const rawComments = [...archivedComments, ...currentComments];
  const comments = rawComments.slice(0, 80).map((value) => {
    const comment = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return {
      commentId: clean(comment.commentId, 100),
      publicText: clean(comment.publicText, 2_000),
      authorNickname: clean(comment.authorNickname, 200),
      likedCountText: clean(comment.likedCountText, 40),
      subCommentCountText: clean(comment.subCommentCountText, 40),
      createdAtText: clean(comment.createdAtText, 100),
      locationText: clean(comment.locationText, 100)
    };
  }).filter((comment) => comment.commentId && comment.publicText);
  const paginationSource = archivedComments.length > 0 && candidate?.commentArchivePagination &&
    typeof candidate.commentArchivePagination === 'object'
    ? candidate.commentArchivePagination : candidate?.commentPagination;
  const pagination = paginationSource && typeof paginationSource === 'object'
    ? paginationSource as Record<string, unknown> : {};
  const archiveMatchedPayloadCount = archivedComments.length > 0 && Number.isSafeInteger(candidate?.commentArchiveMatchedPayloadCount)
    ? Number(candidate?.commentArchiveMatchedPayloadCount) : 0;
  const archiveBodyBytesRead = archivedComments.length > 0 && Number.isSafeInteger(candidate?.commentArchiveBodyBytesRead)
    ? Number(candidate?.commentArchiveBodyBytesRead) : 0;
  return {
    matchedPayloadCount: Math.min(8, Math.max(archiveMatchedPayloadCount,
      Number.isSafeInteger(candidate?.matchedPayloadCount) ? Number(candidate?.matchedPayloadCount) : 0)),
    bodyBytesRead: Math.min(16 * 1024 * 1024, Math.max(archiveBodyBytesRead,
      Number.isSafeInteger(candidate?.bodyBytesRead) ? Number(candidate?.bodyBytesRead) : 0)),
    hasMore: typeof pagination.hasMore === 'boolean' ? pagination.hasMore : null,
    cursorObserved: pagination.cursorObserved === true,
    comments
  };
}

export async function readXiaohongshuExistingNoteReplyNetworkProjection(
  tabId: number,
  workId: string
): Promise<{
  matchedPayloadCount: number; bodyBytesRead: number; cursorObserved: boolean;
  comments: Array<{ commentId: string; parentCommentId: string; publicText: string; authorNickname: string;
    likedCountText: string; createdAtText: string; locationText: string }>;
}> {
  const record = await loadActiveRecord();
  if (!recordMatchesManagedPageRun(record, tabId, workId) || !record.documentId ||
    record.publicSurface !== 'public_note_detail') {
    throw new Error('xiaohongshu_note_replies_network_projection_binding_mismatch');
  }
  const results = await chrome.scripting.executeScript({ target: { tabId, documentIds: [record.documentId] },
    world: 'MAIN', func: () => { const key='__personalIntelligenceXiaohongshuPublicNotesObserverV2';
      return (window as typeof window & { [key]?: unknown })[key] ?? null; } });
  const candidate = results[0]?.result as Record<string, unknown> | null | undefined;
  const clean=(value:unknown,max:number)=>(typeof value==='string'||typeof value==='number'?String(value):'')
    .replace(/[\u0000-\u001f\u007f]/g,'').replace(/\s+/g,' ').trim().slice(0,max);
  const selected=clean(candidate?.selectedNoteId,80);
  const archive=Date.now()<Number(candidate?.commentArchiveExpiresAt)&&selected&&Array.isArray(candidate?.commentArchive)
    ? candidate.commentArchive.filter((value)=>value&&typeof value==='object'&&
      (value as Record<string,unknown>).parentNoteId===selected) : [];
  return { matchedPayloadCount: archive.length>0&&Number.isSafeInteger(candidate?.commentArchiveMatchedPayloadCount)
      ? Math.min(8,Number(candidate?.commentArchiveMatchedPayloadCount)):0,
    bodyBytesRead: archive.length>0&&Number.isSafeInteger(candidate?.commentArchiveBodyBytesRead)
      ? Math.min(16*1024*1024,Number(candidate?.commentArchiveBodyBytesRead)):0,
    cursorObserved: Boolean(archive.length>0&&candidate?.commentArchivePagination&&
      typeof candidate.commentArchivePagination==='object'&&
      (candidate.commentArchivePagination as Record<string,unknown>).cursorObserved===true),
    comments: archive.slice(0,40).map((value)=>{const comment=value as Record<string,unknown>;return {
      commentId:clean(comment.commentId,100),parentCommentId:clean(comment.parentCommentId,100),
      publicText:clean(comment.publicText,2000),authorNickname:clean(comment.authorNickname,200),
      likedCountText:clean(comment.likedCountText,40),createdAtText:clean(comment.createdAtText,100),
      locationText:clean(comment.locationText,100)};}).filter((comment)=>comment.commentId&&comment.publicText) };
}

async function mutateMainWorldCommentContinuity(
  tabId: number,
  workId: string,
  mode: 'reset' | 'select',
  noteId = ''
): Promise<void> {
  const record = await loadActiveRecord();
  if (!recordMatchesManagedPageRun(record, tabId, workId) || !record.documentId) {
    throw new Error('xiaohongshu_comment_continuity_binding_mismatch');
  }
  await chrome.scripting.executeScript({
    target: { tabId, documentIds: [record.documentId] },
    world: 'MAIN',
    args: [mode, noteId],
    func: (requestedMode, selectedNoteId) => {
      const key = '__personalIntelligenceXiaohongshuPublicNotesObserverV2';
      const controller = (window as typeof window & { [key]?: Record<string, unknown> })[key];
      if (!controller) return;
      if (requestedMode === 'reset') {
        controller.selectedNoteId = '';
        controller.commentArchiveExpiresAt = 0;
        controller.commentArchiveMatchedPayloadCount = 0;
        controller.commentArchiveBodyBytesRead = 0;
        controller.commentArchive = [];
        controller.commentArchivePagination = { hasMore: null, cursorObserved: false };
        return;
      }
      controller.selectedNoteId = selectedNoteId;
    }
  });
}

export async function readXiaohongshuExistingSearchNoteDetailNetworkProjection(
  tabId: number,
  workId: string
): Promise<{
  matchedPayloadCount: number;
  bodyBytesRead: number;
  detail: { publicText: string; authorNickname: string; interactionText: string } | null;
}> {
  const record = await loadActiveRecord();
  if (!recordMatchesManagedPageRun(record, tabId, workId) || !record.documentId || record.publicSurface !== 'search') {
    throw new Error('xiaohongshu_note_detail_network_projection_binding_mismatch');
  }
  const results = await chrome.scripting.executeScript({
    target: { tabId, documentIds: [record.documentId] },
    world: 'MAIN',
    func: () => {
      const key = '__personalIntelligenceXiaohongshuPublicNotesObserverV2';
      return (window as typeof window & { [key]?: unknown })[key] ?? null;
    }
  });
  const candidate = results[0]?.result as Record<string, unknown> | null | undefined;
  const text = (value: unknown, maximum: number): string => (typeof value === 'string' ? value : '')
    .replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, maximum);
  const selectedNoteId = text(candidate?.selectedNoteId, 80);
  const rawDetail = Array.isArray(candidate?.details)
    ? candidate.details.find((value) => value && typeof value === 'object' &&
      text((value as Record<string, unknown>).noteId, 80) === selectedNoteId) as Record<string, unknown> | undefined
    : undefined;
  const publicText = text(rawDetail?.publicText, 12_000);
  return {
    matchedPayloadCount: Number.isSafeInteger(candidate?.matchedPayloadCount)
      ? Math.min(4, Math.max(0, Number(candidate?.matchedPayloadCount))) : 0,
    bodyBytesRead: Number.isSafeInteger(candidate?.bodyBytesRead)
      ? Math.min(8 * 1024 * 1024, Math.max(0, Number(candidate?.bodyBytesRead))) : 0,
    detail: publicText ? {
      publicText,
      authorNickname: text(rawDetail?.authorNickname, 200),
      interactionText: text(rawDetail?.interactionText, 1_000)
    } : null
  };
}

export async function readXiaohongshuExistingPublicProfileWorkProjection(
  tabId: number,
  workId: string,
  maximumItems = 40
): Promise<XiaohongshuManagedProfileNotesProjectionResult> {
  const record = await loadActiveRecord();
  if (!recordMatchesManagedPageRun(record, tabId, workId) || !record.documentId ||
    record.publicSurface !== 'public_profile') {
    throw new Error('xiaohongshu_managed_profile_projection_binding_mismatch');
  }
  const results = await chrome.scripting.executeScript({
    target: { tabId, documentIds: [record.documentId] },
    world: 'MAIN',
    func: () => {
      const key = '__personalIntelligenceXiaohongshuPublicNotesObserverV2';
      return (window as typeof window & { [key]?: unknown })[key] ?? null;
    }
  });
  const candidate = results[0]?.result as Record<string, unknown> | null | undefined;
  const boundedMaximumItems = Math.min(200, Math.max(1, Math.floor(maximumItems)));
  const rawItems = Array.isArray(candidate?.items) ? candidate.items.slice(0, boundedMaximumItems) : [];
  const items = rawItems.map((value, index) => {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const text = (field: string, maximum: number): string =>
      (typeof item[field] === 'string' ? item[field] as string : '').replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ').trim().slice(0, maximum);
    return {
      rank: index + 1,
      noteId: text('noteId', 80),
      title: text('title', 500),
      contentType: text('contentType', 40),
      authorId: text('authorId', 80),
      authorNickname: text('authorNickname', 200),
      likedCountText: text('likedCountText', 40)
    };
  }).filter((item) => item.noteId && item.title);
  const result: XiaohongshuManagedProfileNotesProjectionResult = {
    schemaVersion: XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION,
    type: 'xiaohongshu_managed_profile_notes_projection',
    pageAlias: workId,
    runId: workId,
    matchedPayloadCount: Number.isSafeInteger(candidate?.matchedPayloadCount)
      ? Math.min(8, Math.max(0, Number(candidate?.matchedPayloadCount))) : 0,
    bodyBytesRead: Number.isSafeInteger(candidate?.bodyBytesRead)
      ? Math.min(16 * 1024 * 1024, Math.max(0, Number(candidate?.bodyBytesRead))) : 0,
    rawPayloadStored: false,
    responseUrlsStored: false,
    items
  };
  if (!isXiaohongshuManagedProfileNotesProjectionResult(result)) {
    throw new Error('xiaohongshu_managed_profile_projection_invalid');
  }
  return result;
}

export async function clearXiaohongshuWorkObserver(tabId: number, workId: string): Promise<void> {
  const record = await loadActiveRecord();
  if (!recordMatchesManagedPageRun(record, tabId, workId)) return;
  await chrome.storage.session.remove(XIAOHONGSHU_CURRENT_PAGE_NETWORK_STORAGE_KEY);
  unregisterNetworkMetadataListener();
}

export async function readXiaohongshuExistingExploreWorkProjection(
  tabId: number,
  workId: string
): Promise<XiaohongshuManagedSearchProjectionResult> {
  return await readXiaohongshuManagedSearchProjection(tabId, {
    schemaVersion: XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION,
    profileId: 'user-browser',
    pageAlias: workId,
    pageLeaseId: workId,
    expectedRecordVersion: 1,
    runId: workId
  });
}

async function armManagedXiaohongshuCurrentDocument(
  tabId: number,
  managedRunId: string,
  activeRecord: XiaohongshuCurrentPageNetworkRecord | null,
  expectedSurface: 'explore' | 'search' | 'public_profile' | 'public_note_detail' = 'explore',
  preserveExistingSearchProjection = false,
  preserveExistingProfileProjection = false
): Promise<XiaohongshuCurrentPageNetworkRecord> {
  if (activeRecord) throw new Error('xiaohongshu_current_page_network_selection_active');
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const windowId = tab?.windowId;
  const surface = tab?.url ? xiaohongshuCurrentPageNetworkPublicSurface(tab.url) : null;
  if (!tab || typeof windowId !== 'number' || !Number.isSafeInteger(windowId) || tab.incognito ||
    surface !== expectedSurface) {
    throw new Error('xiaohongshu_current_page_network_public_surface_required');
  }
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 }).catch(() => null);
  if (!frame?.documentId || xiaohongshuCurrentPageNetworkPublicSurface(frame.url) !== expectedSurface) {
    throw new Error('xiaohongshu_current_page_network_document_unavailable');
  }
  const now = Date.now();
  const record: XiaohongshuCurrentPageNetworkRecord = {
    schemaVersion: 1,
    tabId,
    windowId,
    managedRunId,
    initialDocumentId: frame.documentId,
    documentId: frame.documentId,
    state: 'observing',
    publicSurface: expectedSurface,
    selectedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + XIAOHONGSHU_CURRENT_PAGE_NETWORK_SELECTION_TTL_MS).toISOString(),
    navigationStarted: false,
    stopReason: null,
    observedRouteCount: 0,
    excludedRouteCounts: emptyExcludedRouteCounts(),
    risk: emptyRisk()
  };
  await store(record);
  const preserved = expectedSurface === 'search' && preserveExistingSearchProjection &&
    await activateExistingSearchObserver(tabId, frame.documentId);
  const preservedProfile = expectedSurface === 'public_profile' && preserveExistingProfileProjection &&
    await activateExistingProfileObserver(tabId, frame.documentId);
  if (!preserved && !preservedProfile) {
    await chrome.scripting.executeScript({
      target: { tabId, documentIds: [frame.documentId] },
      world: 'MAIN',
      files: ['xiaohongshu-search-main-world-observer.js'],
      injectImmediately: true
    });
  }
  return record;
}

/**
 * A profile-link work item may have installed the observer at document_start,
 * before the profile's initial JSON response arrived.  Re-bind that existing
 * controller to the signed work lease without clearing the items it already
 * projected.  This keeps the initial response available to the Network-first
 * path while ensuring late callbacks from the previous generation cannot leak
 * into this work item.
 */
async function activateExistingProfileObserver(tabId: number, documentId: string): Promise<boolean> {
  const results = await chrome.scripting.executeScript({
    target: { tabId, documentIds: [documentId] },
    world: 'MAIN',
    func: () => {
      const key = '__personalIntelligenceXiaohongshuPublicNotesObserverV2';
      const controller = (window as typeof window & { [key]?: Record<string, unknown> })[key];
      if (!controller || controller.schemaVersion !== 2 || typeof controller.expiresAt !== 'number' ||
        Date.now() >= controller.expiresAt || !Array.isArray(controller.items)) return false;
      const generation = typeof controller.generation === 'number' && Number.isSafeInteger(controller.generation)
        ? controller.generation : 0;
      controller.generation = generation + 1;
      controller.expiresAt = Date.now() + 60_000;
      return true;
    }
  });
  return results[0]?.result === true;
}

/**
 * Search and detail are intentionally one same-document continuity chain.
 * The search work has already paid for a bounded public response projection;
 * re-injecting the observer here would erase that projection before the
 * detail click can consume it. Keep item/detail identities, but begin a new
 * observation generation so only responses from this detail work are added.
 */
async function activateExistingSearchObserver(tabId: number, documentId: string): Promise<boolean> {
  const results = await chrome.scripting.executeScript({
    target: { tabId, documentIds: [documentId] },
    world: 'MAIN',
    func: () => {
      const key = '__personalIntelligenceXiaohongshuPublicNotesObserverV2';
      const controller = (window as typeof window & { [key]?: Record<string, unknown> })[key];
      if (!controller || controller.schemaVersion !== 2 || typeof controller.expiresAt !== 'number' ||
        Date.now() >= controller.expiresAt || !Array.isArray(controller.items) ||
        !Array.isArray(controller.details)) return false;
      const generation = typeof controller.generation === 'number' && Number.isSafeInteger(controller.generation)
        ? controller.generation : 0;
      controller.generation = generation + 1;
      controller.expiresAt = Date.now() + 60_000;
      controller.selectedNoteId = '';
      controller.comments = [];
      controller.commentPagination = { hasMore: null, cursorObserved: false };
      controller.commentArchiveExpiresAt = 0;
      controller.commentArchiveMatchedPayloadCount = 0;
      controller.commentArchiveBodyBytesRead = 0;
      controller.commentArchive = [];
      controller.commentArchivePagination = { hasMore: null, cursorObserved: false };
      return true;
    }
  });
  return results[0]?.result === true;
}

export async function readXiaohongshuManagedPageNetworkObservation(
  tabId: number,
  request: XiaohongshuManagedPageNetworkObserverRequest
): Promise<XiaohongshuManagedPageNetworkObservationResult> {
  const permissionState = await xiaohongshuCurrentPageNetworkPermissionState();
  let record = await loadActiveRecord();
  if (!recordMatchesManagedPageRun(record, tabId, request.runId)) {
    throw new Error('xiaohongshu_managed_page_network_binding_mismatch');
  }
  if (record.state === 'observing' && record.documentId) {
    await refreshRiskSignals(record).catch(() => undefined);
    record = await loadActiveRecord();
  }
  if (!recordMatchesManagedPageRun(record, tabId, request.runId)) {
    throw new Error('xiaohongshu_managed_page_network_binding_mismatch');
  }
  if (record.state === 'stopped') unregisterNetworkMetadataListener();
  return {
    schemaVersion: XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION,
    type: 'xiaohongshu_managed_page_network_observation',
    pageAlias: request.pageAlias,
    runId: request.runId,
    permissionState,
    selection: selectionSummary(record),
    observation: observationFor(record)
  };
}

async function armSpecificXiaohongshuTab(
  tabId: number,
  managedRunId: string | null,
  activeRecord?: XiaohongshuCurrentPageNetworkRecord | null
): Promise<XiaohongshuCurrentPageNetworkRecord> {
  const existing = activeRecord === undefined ? await loadActiveRecord() : activeRecord;
  if (existing) throw new Error('xiaohongshu_current_page_network_selection_active');
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const windowId = tab?.windowId;
  if (!tab || typeof windowId !== 'number' || !Number.isSafeInteger(windowId) || tab.incognito) {
    throw new Error('xiaohongshu_current_page_network_current_tab_unavailable');
  }
  const tabSurface = xiaohongshuCurrentPageNetworkPublicSurface(tab.url ?? '');
  if (!tabSurface) throw new Error('xiaohongshu_current_page_network_public_surface_required');
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 }).catch(() => null);
  const frameSurface = frame?.url ? xiaohongshuCurrentPageNetworkPublicSurface(frame.url) : null;
  if (!frame?.documentId || frameSurface !== tabSurface) {
    throw new Error('xiaohongshu_current_page_network_document_unavailable');
  }
  const now = Date.now();
  const record: XiaohongshuCurrentPageNetworkRecord = {
    schemaVersion: 1,
    tabId,
    windowId,
    managedRunId,
    initialDocumentId: frame.documentId,
    documentId: null,
    state: 'armed_next_document',
    publicSurface: null,
    selectedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + XIAOHONGSHU_CURRENT_PAGE_NETWORK_SELECTION_TTL_MS).toISOString(),
    navigationStarted: false,
    stopReason: null,
    observedRouteCount: 0,
    excludedRouteCounts: emptyExcludedRouteCounts(),
    risk: emptyRisk()
  };
  await store(record);
  return record;
}

/** A local UI read. It has no browser-control or platform side effect. */
export async function getXiaohongshuCurrentPageNetworkSelectionSummary(): Promise<
  XiaohongshuCurrentPageNetworkSelectionSummary
> {
  const record = await loadActiveRecord();
  return record ? selectionSummary(record) : noSelectionSummary();
}

/**
 * The result is reachable only through the authenticated Browser Host native
 * bridge. It contains categorised counts and risk booleans, never a tab ID,
 * document ID, URL, query, response body, header, cookie or page text.
 */
export async function readXiaohongshuCurrentPageNetworkObservation(): Promise<
  XiaohongshuCurrentPageNetworkObservationResult
> {
  const permissionState = await xiaohongshuCurrentPageNetworkPermissionState();
  let record = await loadActiveRecord();
  if (record?.state === 'observing' && record.documentId) {
    await refreshRiskSignals(record).catch(() => undefined);
    record = await loadActiveRecord();
  }
  if (record?.state === 'stopped') unregisterNetworkMetadataListener();
  return {
    schemaVersion: XIAOHONGSHU_CURRENT_PAGE_NETWORK_SCHEMA_VERSION,
    type: 'xiaohongshu_current_page_network_observation',
    permissionState,
    selection: record ? selectionSummary(record) : noSelectionSummary(),
    observation: observationFor(record)
  };
}

/**
 * This can run without a user gesture because it only reads Chrome's existing
 * optional-permission state. It deliberately never calls `request`, so a
 * Host/Gateway status read cannot open a browser prompt or broaden access.
 */
async function xiaohongshuCurrentPageNetworkPermissionState(): Promise<XiaohongshuCurrentPageNetworkPermissionState> {
  const granted = await chrome.permissions.contains({
    permissions: ['webRequest'],
    origins: [XIAOHONGSHU_ORIGIN]
  }).catch(() => false);
  return granted ? 'permission_granted' : 'permission_required';
}

export function initialiseXiaohongshuCurrentPageNetworkObserver(): void {
  if (initialised) return;
  initialised = true;

  chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId !== 0) return;
    void markNextNavigationStarted(details.tabId, details.url);
  });
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) return;
    if (typeof details.documentId !== 'string' || !details.documentId) {
      void stopForSourceUnavailable(details.tabId);
      return;
    }
    void bindSelectedDocument(details.tabId, details.documentId, details.url);
  });
  chrome.webNavigation.onErrorOccurred.addListener((details) => {
    if (details.frameId !== 0) return;
    void stopForSourceUnavailable(details.tabId);
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void stopForClosedTab(tabId);
  });
  void restoreNetworkMetadataListenerForActiveSelection();
}

async function restoreNetworkMetadataListenerForActiveSelection(): Promise<void> {
  const record = await loadActiveRecord();
  if (!record || record.state !== 'observing') return;
  const permitted = await chrome.permissions.contains({
    permissions: ['webRequest'],
    origins: [XIAOHONGSHU_ORIGIN]
  }).catch(() => false);
  if (permitted) registerNetworkMetadataListener();
}

/** Optional API listeners are installed only after the explicit user grant. */
function registerNetworkMetadataListener(): void {
  if (networkMetadataListenerRegistered) return;
  networkMetadataListenerRegistered = true;
  chrome.webRequest.onCompleted.addListener(
    networkMetadataListener,
    { urls: [XIAOHONGSHU_ORIGIN], types: ['xmlhttprequest'] }
  );
}

function unregisterNetworkMetadataListener(): void {
  if (!networkMetadataListenerRegistered) return;
  chrome.webRequest.onCompleted.removeListener(networkMetadataListener);
  networkMetadataListenerRegistered = false;
}

async function markNextNavigationStarted(tabId: number, url: string): Promise<void> {
  const record = await loadActiveRecord();
  if (!record || record.tabId !== tabId) return;
  if (record.state === 'observing') {
    // A single Playwright page.goto on Xiaohongshu can legitimately traverse
    // several public top-level documents before the search application
    // settles. Only a managed PageLease run may follow that bounded chain;
    // popup/user selections remain strict one-document observations.
    if (record.managedRunId !== null && xiaohongshuCurrentPageNetworkPublicSurface(url)) {
      await store({
        ...record,
        state: 'armed_next_document',
        publicSurface: null,
        documentId: null,
        navigationStarted: true
      });
      registerNetworkMetadataListener();
      return;
    }
    await store({ ...record, state: 'stopped', stopReason: 'document_changed' });
    unregisterNetworkMetadataListener();
    return;
  }
  if (record.state !== 'armed_next_document') return;
  if (!xiaohongshuCurrentPageNetworkPublicSurface(url)) {
    await store({ ...record, state: 'stopped', stopReason: 'document_changed' });
    unregisterNetworkMetadataListener();
    return;
  }
  await store({ ...record, navigationStarted: true });
  // Do not subscribe while merely armed on an existing document. The listener
  // begins only after the person has actually initiated the allowed next
  // navigation in the selected tab.
  registerNetworkMetadataListener();
}

async function bindSelectedDocument(tabId: number, documentId: string, url: string): Promise<void> {
  const record = await loadActiveRecord();
  if (!record || record.tabId !== tabId) return;
  if (record.state === 'observing') {
    if (record.documentId !== documentId) {
      await store({ ...record, state: 'stopped', stopReason: 'document_changed' });
      unregisterNetworkMetadataListener();
    }
    return;
  }
  if (record.state !== 'armed_next_document') return;
  const publicSurface = xiaohongshuCurrentPageNetworkPublicSurface(url);
  if (!record.navigationStarted || !publicSurface || documentId === record.initialDocumentId) {
    await store({ ...record, state: 'stopped', stopReason: 'document_changed' });
    unregisterNetworkMetadataListener();
    return;
  }
  const observing: XiaohongshuCurrentPageNetworkRecord = {
    ...record,
    state: 'observing',
    publicSurface,
    documentId
  };
  await store(observing);
  await refreshRiskSignals(observing).catch(() => undefined);
}

async function recordNetworkMetadata(
  tabId: number,
  rawUrl: string,
  resourceType: string
): Promise<void> {
  if (resourceType !== 'xmlhttprequest') return;
  const record = await loadActiveRecord();
  if (!record || record.state !== 'observing' || record.tabId !== tabId ||
    record.observedRouteCount >= XIAOHONGSHU_CURRENT_PAGE_NETWORK_BUDGET.maximumNetworkMetadataObservations) return;
  const category = classifyExcludedRouteCategory(rawUrl);
  const excludedRouteCounts = { ...record.excludedRouteCounts };
  excludedRouteCounts[category] += 1;
  const observedRouteCount = record.observedRouteCount + 1;
  await store({
    ...record,
    observedRouteCount,
    excludedRouteCounts
  });
  if (observedRouteCount >= XIAOHONGSHU_CURRENT_PAGE_NETWORK_BUDGET.maximumNetworkMetadataObservations) {
    unregisterNetworkMetadataListener();
  }
}

async function refreshRiskSignals(record: XiaohongshuCurrentPageNetworkRecord): Promise<void> {
  if (!record.documentId || record.state !== 'observing') return;
  const result = await chrome.scripting.executeScript({
    target: { tabId: record.tabId, documentIds: [record.documentId] },
    func: () => ({
      pathname: location.pathname,
      title: document.title.slice(0, 300),
      visibleText: (document.body?.innerText ?? '').slice(0, 12_000)
    })
  });
  const candidate = result[0]?.result;
  if (!isXiaohongshuRiskSignal(candidate)) return;
  const risk = classifyXiaohongshuCurrentPageRisk(candidate);
  const current = await loadActiveRecord();
  if (!current || current.state !== 'observing' || current.documentId !== record.documentId) return;
  const next = {
    ...current,
    risk,
    ...(risk.verificationRequired || risk.rateLimited || risk.sourceUnavailable
      ? { state: 'stopped' as const, stopReason: risk.sourceUnavailable ? 'source_unavailable' as const : 'risk' as const }
      : {})
  };
  await store(next);
  if (next.state === 'stopped') unregisterNetworkMetadataListener();
}

async function stopForSourceUnavailable(tabId: number): Promise<void> {
  const record = await loadActiveRecord();
  if (!record || record.tabId !== tabId || record.state === 'stopped') return;
  await store({
    ...record,
    state: 'stopped',
    stopReason: 'source_unavailable',
    risk: { ...record.risk, sourceUnavailable: true }
  });
  unregisterNetworkMetadataListener();
}

async function stopForClosedTab(tabId: number): Promise<void> {
  const record = await loadActiveRecord();
  if (!record || record.tabId !== tabId || record.state === 'stopped') return;
  await store({ ...record, state: 'stopped', stopReason: 'tab_closed' });
  unregisterNetworkMetadataListener();
}

async function loadActiveRecord(): Promise<XiaohongshuCurrentPageNetworkRecord | null> {
  const stored = await chrome.storage.session.get(XIAOHONGSHU_CURRENT_PAGE_NETWORK_STORAGE_KEY);
  const record = parseXiaohongshuCurrentPageNetworkRecord(stored[XIAOHONGSHU_CURRENT_PAGE_NETWORK_STORAGE_KEY]);
  if (!record) return null;
  if (Date.parse(record.expiresAt) > Date.now()) return record;
  await chrome.storage.session.remove(XIAOHONGSHU_CURRENT_PAGE_NETWORK_STORAGE_KEY);
  unregisterNetworkMetadataListener();
  return null;
}

async function store(record: XiaohongshuCurrentPageNetworkRecord): Promise<void> {
  await chrome.storage.session.set({
    [XIAOHONGSHU_CURRENT_PAGE_NETWORK_STORAGE_KEY]: record
  });
}
