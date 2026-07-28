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
  if (!current) await armManagedXiaohongshuCurrentDocument(tabId, workId, null, 'public_profile');
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
  if (!current) await armManagedXiaohongshuCurrentDocument(tabId, workId, null, 'search');
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
  const comments = (Array.isArray(candidate?.comments) ? candidate.comments : []).slice(0, 80).map((value) => {
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
  const pagination = candidate?.commentPagination && typeof candidate.commentPagination === 'object'
    ? candidate.commentPagination as Record<string, unknown> : {};
  return {
    matchedPayloadCount: Number.isSafeInteger(candidate?.matchedPayloadCount)
      ? Math.min(8, Math.max(0, Number(candidate?.matchedPayloadCount))) : 0,
    bodyBytesRead: Number.isSafeInteger(candidate?.bodyBytesRead)
      ? Math.min(16 * 1024 * 1024, Math.max(0, Number(candidate?.bodyBytesRead))) : 0,
    hasMore: typeof pagination.hasMore === 'boolean' ? pagination.hasMore : null,
    cursorObserved: pagination.cursorObserved === true,
    comments
  };
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
  const rawDetail = Array.isArray(candidate?.details) && candidate.details.length > 0 &&
    candidate.details[0] && typeof candidate.details[0] === 'object'
    ? candidate.details[0] as Record<string, unknown> : null;
  const text = (value: unknown, maximum: number): string => (typeof value === 'string' ? value : '')
    .replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, maximum);
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
  workId: string
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
  expectedSurface: 'explore' | 'search' | 'public_profile' | 'public_note_detail' = 'explore'
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
  await chrome.scripting.executeScript({
    target: { tabId, documentIds: [frame.documentId] },
    world: 'MAIN',
    files: ['xiaohongshu-search-main-world-observer.js'],
    injectImmediately: true
  });
  return record;
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
