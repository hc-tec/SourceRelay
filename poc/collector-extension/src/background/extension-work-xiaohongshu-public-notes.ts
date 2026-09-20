import {
  XIAOHONGSHU_NOTE_PUBLIC_DETAIL_BUDGET,
  classifyXiaohongshuCurrentPageRisk,
  xiaohongshuCurrentPageNetworkPublicSurface,
  type XiaohongshuManagedSearchProjectionResult,
  type XiaohongshuNotePublicDetailWorkItem,
  type XiaohongshuPublicNotesSearchTerminalReason,
  type XiaohongshuPublicNotesSearchWorkItem,
  type XiaohongshuPublicNotesSearchWorkResult,
  type XiaohongshuPublicSearchItemProjection
} from '@intelligence/collector-contracts';
import {
  armXiaohongshuExistingExploreWorkObserver,
  clearXiaohongshuWorkObserver,
  readXiaohongshuExistingExploreWorkProjection
} from './xiaohongshu-current-page-network';
import { executeXiaohongshuTrustedInputSearch } from './xiaohongshu-trusted-input';
import {
  executeXiaohongshuNotePublicDetailExtensionWork,
  XIAOHONGSHU_DEPTH_GATE_ERROR_CODES
} from './extension-work-xiaohongshu-note-public-detail';
import {
  abandonExtensionWorkTab,
  acquireExtensionWorkTab,
  activateManagedWorkTabIfInactive,
  navigateXiaohongshuExploreOnce,
  releaseExtensionWorkTab,
  type ExtensionWorkTabLease,
  type WorkTabAcquisition,
  type WorkTabDisposition
} from './extension-work-tabs';
import { sendDebuggerCommandBounded } from './bounded-debugger';

export interface XiaohongshuPublicNotesSearchExtensionLifecycle {
  onWorkTabAcquired?(acquisition: WorkTabAcquisition): Promise<void>;
  onNavigationIntent?(): Promise<void>;
  /** Metadata-only per-rank probe diagnostics sink (runner forwards to the
   * gateway operational log). */
  onDiagnostic?(errorCode: string, details: Record<string, unknown>): void;
}

export async function executeXiaohongshuPublicNotesSearchExtensionWork(
  item: XiaohongshuPublicNotesSearchWorkItem,
  internalBinding: { expectedTabId?: number } = {},
  lifecycle: XiaohongshuPublicNotesSearchExtensionLifecycle = {}
): Promise<XiaohongshuPublicNotesSearchWorkResult> {
  const projectionBox: { value: XiaohongshuManagedSearchProjectionResult | null } = { value: null };
  type DepthRankEntry = NonNullable<
    NonNullable<XiaohongshuPublicNotesSearchWorkResult['detailActions']>['ranks']
  >[number];
  const detailActions = {
    requestedCount: 0,
    attemptedCount: 0,
    completedCount: 0,
    skippedCount: 0,
    stoppedReason: null as string | null,
    ranks: [] as DepthRankEntry[],
    abortReason: undefined as 'overlay_persisting' | 'platform_gate' | 'internal_error' | undefined
  };
  const commentsPlan = item.input.comments;
  // Cross-operation deduplication: ranks whose noteId is already collected
  // skip the overlay work entirely (cheap) and are reported as skipped.
  const skipKnown = new Set(item.input.dedupe?.skipKnown ?? []);
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
        // Mark already-collected cards so callers see exactly what was skipped.
        if (skipKnown.size > 0) {
          projectionBox.value = {
            ...projectionBox.value,
            items: projectionBox.value.items.map((entry) => ({
              ...entry,
              ...(skipKnown.has(entry.noteId) ? { known: true } : {})
            }))
          };
        }
        // The requested total is the caller's intent, not the first page's
        // card count: when the projected items run out, the feed is scrolled
        // for further cards (see growSearchFeed) until the intent is met or
        // the feed stops yielding new notes.
        const requestedCount = Math.max(0, Math.floor(item.input.maximumDetails ?? 0));
        detailActions.requestedCount = requestedCount;
        if (requestedCount === 0) return;
        await waitForSearchDocumentStability(document.tabId, item.expiresAt);

        // The search observer owns the initial Explore lease. Detail work uses
        // the same managed tab and same document; it never opens a new tab.
        await clearXiaohongshuWorkObserver(document.tabId, item.workId);
        const details = [...(projectionBox.value.details ?? [])];
        // Depth is resilient per rank: one note's detail/comments failure
        // (a platform flake, a zero-comment oddity, an overlay hiccup) must
        // not discard the successful notes around it. The first failure is
        // surfaced in detailActions.stoppedReason and the operation converges
        // to `search_depth_stopped` with the captured partial depth intact;
        // only a run that captures zero details stops as a total failure.
        // Two failures are NOT per-rank noise and abort the remaining ranks
        // immediately (detailActions.abortReason): an overlay left open
        // (every further card hit-test would hit the mask) and platform /
        // document gates (every further rank would fail identically).
        let firstDetailFailure: string | null = null;
        let completedUnits = 0;
        // Soft deadline: converge gracefully BEFORE the work item expires.
        // A hard kill would discard the whole depth loop's captured notes;
        // stopping two minutes early keeps every completed note in the
        // artifact and reports the remainder truthfully.
        const softDeadline = Date.parse(item.expiresAt) - 120_000;
        for (let rank = 1; rank <= requestedCount; rank += 1) {
          detailActions.attemptedCount = rank;
          if (Date.now() >= softDeadline) {
            detailActions.ranks.push({ rank, noteId: projectionBox.value.items[rank - 1]?.noteId ?? null, outcome: 'skipped', errorCode: null });
            continue;
          }
          if (rank > projectionBox.value.items.length) {
            const grew = await growSearchFeed(document, { tabId: document.tabId }, projectionBox);
            if (!grew) {
              // The feed stopped yielding new notes: this is the honest end
              // of the result set, not a per-rank failure. Converge with the
              // captured partial depth intact.
              firstDetailFailure ??= 'xiaohongshu_search_result_feed_exhausted';
              break;
            }
          }
          const noteId = projectionBox.value.items[rank - 1]?.noteId ?? null;
          if (noteId && skipKnown.has(noteId)) {
            // Already collected by this caller: skip the overlay work entirely.
            detailActions.skippedCount += 1;
            detailActions.ranks.push({ rank, noteId, outcome: 'skipped', errorCode: null });
            if (rank < requestedCount) await delay(1_500);
            continue;
          }
          const detailItem = createDepthDetailWorkItem(item, rank);
          // A delegated depth run often outlives the operator's attention:
          // one activation of the leased work tab per rank keeps lazy card
          // covers rendering (background documents never finish them), which
          // previously stranded every rank with `rank_unavailable`.
          await activateManagedWorkTabIfInactive(document.tabId);
          try {
            const detailResult = await executeXiaohongshuNotePublicDetailExtensionWork(detailItem, {
              closeOverlayAfterCapture: true,
              collectComments: commentsPlan ? { maximumScrolls: commentsPlan.maximumScrolls } : undefined,
              collectReplies: commentsPlan?.replies,
              debuggee: { tabId: document.tabId },
              expectedTabId: document.tabId,
              skipForeground: true,
              expectedTitle: projectionBox.value.items[rank - 1]?.title,
              expectedNoteId: projectionBox.value.items[rank - 1]?.noteId,
              onDiagnostic: (errorCode, probeDetails) => {
                void lifecycle.onDiagnostic?.(errorCode, { rank, ...probeDetails });
              }
            });
            if (detailResult.state !== 'completed' || !detailResult.projection) {
              const failureCode = detailResult.errorCode ?? 'xiaohongshu_note_detail_postcondition_unmet';
              firstDetailFailure ??= failureCode;
              detailActions.ranks.push({ rank, noteId, outcome: 'failed', errorCode: failureCode });
              if (detailResult.overlayCleanup === 'unclosed') {
                detailActions.abortReason = 'overlay_persisting';
              } else if (failureCode === 'extension_work_expired' ||
                XIAOHONGSHU_DEPTH_GATE_ERROR_CODES.has(failureCode)) {
                detailActions.abortReason = 'platform_gate';
              }
            } else {
              const enriched = {
                noteId,
                publicText: detailResult.projection.publicText,
                authorNickname: detailResult.projection.authorNickname,
                interactionText: detailResult.projection.interactionText
              } as (typeof details)[number];
              if (detailResult.projection.comments) enriched.comments = detailResult.projection.comments;
              if (detailResult.projection.replyThread) enriched.replyThread = detailResult.projection.replyThread;
              if (detailResult.projection.replyThreads) enriched.replyThreads = detailResult.projection.replyThreads;
              if (detailResult.projection.commentsCapture) enriched.commentsCapture = detailResult.projection.commentsCapture;
              if (detailResult.projection.repliesCapture) enriched.repliesCapture = detailResult.projection.repliesCapture;
              const existingIndex = details.findIndex((detail) => detail.noteId === noteId);
              if (existingIndex >= 0) details[existingIndex] = { ...details[existingIndex], ...enriched };
              else details.push(enriched);
              completedUnits += 1;
              detailActions.ranks.push({ rank, noteId, outcome: 'completed', errorCode: null });
            }
          } catch (error) {
            // executeXiaohongshuNotePublicDetailExtensionWork catches its own
            // failures; a throw here means the composed run itself is broken.
            const code = safeErrorCode(error);
            firstDetailFailure ??= code;
            detailActions.ranks.push({ rank, noteId, outcome: 'failed', errorCode: code });
            detailActions.abortReason = 'internal_error';
          }
          detailActions.stoppedReason = firstDetailFailure;
          if (detailActions.abortReason) break;
          if (rank < requestedCount) await delay(1_500);
        }
        detailActions.completedCount = completedUnits;
        projectionBox.value = { ...projectionBox.value, details: details.slice(0, 40) };
        if (completedUnits === 0 && firstDetailFailure !== null) {
          throw new Error(firstDetailFailure);
        }
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
  const depthCompleted = !depthRequested ||
    detailActions.completedCount + detailActions.skippedCount === detailActions.requestedCount;
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
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(workTab.tabId).catch(() => null);
    if (!tab) throw new Error('work_tab_closed');
    if (tab.status === 'complete' && xiaohongshuCurrentPageNetworkPublicSurface(tab.url ?? '') === 'explore') {
      const frame = await chrome.webNavigation.getFrame({ tabId: workTab.tabId, frameId: 0 }).catch(() => null);
      if (frame?.documentId && xiaohongshuCurrentPageNetworkPublicSurface(frame.url) === 'explore') return;
    }
    if (tab.status === 'complete') {
      const prerequisiteRisk = await readXiaohongshuExplorePrerequisiteRisk(workTab.tabId);
      if (prerequisiteRisk) throw new Error(prerequisiteRisk.code);
    }
    await delay(300);
  }
  throw new Error('xiaohongshu_explore_navigation_not_ready');
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
  let results: chrome.scripting.InjectionResult<{
    pathname: string;
    title: string;
  }>[];
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        pathname: location.pathname,
        title: document.title.slice(0, 300)
      })
    });
  } catch {
    throw new Error('xiaohongshu_explore_prerequisite_probe_unavailable');
  }
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
    case 'xiaohongshu_host_permission_required':
      return 'permission_required';
    case 'xiaohongshu_explore_prerequisite_probe_unavailable':
      return 'postcondition_unmet';
    default:
      return 'postcondition_unmet';
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

/**
 * Grow the projected item list by scrolling the search feed for further
 * cards. The initial network projection covers roughly the first result
 * page; a caller-requested depth beyond that must scroll the feed (the
 * platform then serves further notes and the DOM gains more cards). Cards
 * are identified semantically — the same unique-note rule as the rank
 * locator — and appended in discovery order. Returns whether any new note
 * was found; a feed that stops growing is the honest end of the result set.
 */
async function growSearchFeed(
  document: { tabId: number; documentId: string },
  debuggee: { tabId: number },
  box: { value: XiaohongshuManagedSearchProjectionResult | null }
): Promise<boolean> {
  if (!box.value) return false;
  const seen = new Set(box.value.items.map((entry) => entry.noteId));
  for (let round = 0; round < 4; round += 1) {
    await scrollSearchFeed(debuggee);
    const cards = await readSearchFeedCards(document.tabId, document.documentId);
    let added = false;
    for (const card of cards) {
      if (seen.has(card.noteId)) continue;
      seen.add(card.noteId);
      const items: XiaohongshuPublicSearchItemProjection[] = box.value.items;
      const extended: XiaohongshuPublicSearchItemProjection = {
        rank: items.length + 1,
        noteId: card.noteId,
        title: card.title,
        contentType: '',
        authorId: '',
        authorNickname: '',
        likedCountText: ''
      };
      box.value = { ...box.value, items: [...items, extended] };
      added = true;
    }
    if (added) return true;
  }
  return false;
}

async function scrollSearchFeed(debuggee: { tabId: number }): Promise<void> {
  let center = { x: 400, y: 400 };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: debuggee.tabId },
      func: () => ({ x: Math.floor(window.innerWidth / 2), y: Math.floor(window.innerHeight / 2) })
    });
    const value = results[0]?.result;
    if (value && Number.isFinite(value.x) && Number.isFinite(value.y)) center = value;
  } catch {
    // Fixed fallback coordinates are fine for wheel delivery.
  }
  for (let wheel = 0; wheel < 3; wheel += 1) {
    await sendDebuggerCommandBounded(debuggee, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: center.x, y: center.y, deltaX: 0, deltaY: 1600
    }).catch(() => undefined);
    await delay(200);
  }
  // The platform fetches the next waterfall page asynchronously; give the
  // network a beat before the next DOM scan.
  await delay(1_200);
}

/**
 * Semantic scan of the current search feed: unique note cards in document
 * order with a bounded title hint. Identifies cards by note links only
 * (/explore/<id>, /discovery/item/<id>, /search_result/<id>) — no classes,
 * hashes, or framework attributes.
 */
async function readSearchFeedCards(
  tabId: number,
  documentId: string
): Promise<Array<{ noteId: string; title: string }>> {
  const results = await chrome.scripting.executeScript({
    target: { tabId, documentIds: [documentId] },
    func: () => {
      const visible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
          style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.01;
      };
      const noteIdOf = (href: string): string => {
        try {
          return new URL(href).pathname
            .match(/^\/(?:explore|discovery\/item|search_result)\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1] ?? '';
        } catch { return ''; }
      };
      const seen = new Set<string>();
      const cards: Array<{ noteId: string; title: string }> = [];
      for (const link of Array.from(document.querySelectorAll('a[href]'))) {
        if (!(link instanceof HTMLAnchorElement)) continue;
        const noteId = noteIdOf(link.href);
        if (noteId === '' || seen.has(noteId)) continue;
        let holder: Element = link;
        let pointer: Element | null = link.parentElement;
        for (let depth = 0; pointer && depth < 8; depth += 1, pointer = pointer.parentElement) {
          const rect = pointer.getBoundingClientRect();
          if (rect.width >= 160 && rect.height >= 120) {
            holder = pointer;
            break;
          }
        }
        if (!visible(holder)) continue;
        seen.add(noteId);
        cards.push({
          noteId,
          title: (holder.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
        });
      }
      return cards;
    }
  }).catch(() => [] as chrome.scripting.InjectionResult<Array<{ noteId: string; title: string }>>[]);
  const value = results[0]?.result;
  return Array.isArray(value)
    ? value.filter((card) => card && typeof card.noteId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(card.noteId))
    : [];
}

function safeErrorCode(error: unknown): string {
  const code = errorMessage(error);
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'xiaohongshu_search_execution_failed';
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' &&
    typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return '';
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
