import {
  classifyXiaohongshuCurrentPageRisk,
  canonicalXiaohongshuPublicProfileUrl,
  xiaohongshuCurrentPageNetworkPublicSurface,
  type XiaohongshuAccountPublicNotesTerminalReason,
  type XiaohongshuAccountPublicNotesWorkItem,
  type XiaohongshuAccountPublicNotesWorkResult,
  type XiaohongshuManagedProfileNotesProjectionResult,
  type XiaohongshuProfileScrollCompletedCount,
  type XiaohongshuProfileScrollCount,
  type XiaohongshuPublicSearchItemProjection
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

type PublicProfileItem = XiaohongshuPublicSearchItemProjection;

interface ProfileDomProbe {
  renderedCardCount: number;
  viewportWidth: number;
  viewportHeight: number;
  items: PublicProfileItem[];
  risk: ReturnType<typeof classifyXiaohongshuCurrentPageRisk>;
}

export async function executeXiaohongshuAccountPublicNotesExtensionWork(
  item: XiaohongshuAccountPublicNotesWorkItem
): Promise<XiaohongshuAccountPublicNotesWorkResult> {
  let document: ProfileDocument | null = null;
  let attached = false;
  let debuggerDetached = true;
  let attemptedCount: XiaohongshuProfileScrollCompletedCount = 0;
  let completedCount: XiaohongshuProfileScrollCompletedCount = 0;
  let projection: XiaohongshuManagedProfileNotesProjectionResult | null = null;
  let networkProjection: XiaohongshuManagedProfileNotesProjectionResult | null = null;
  let renderedCardCount = 0;
  let navigationAttempted = false;
  let errorCode: string | null = null;
  let completionReason: 'profile_notes_ready' | 'profile_notes_budget_exhausted' | null = null;
  try {
    if (item.executionTarget === 'ephemeral_public_profile_url') {
      const profileUrl = item.input.profileUrl;
      if (!profileUrl || !canonicalXiaohongshuPublicProfileUrl(profileUrl)) {
        throw new Error('xiaohongshu_profile_url_invalid');
      }
      navigationAttempted = true;
      await navigateToEphemeralProfileUrl(profileUrl);
    }
    document = await findUniquePublicProfileDocument();
    await foreground(document);
    await requireSameDocument(document);
    const maximumItems = item.executionTarget === 'ephemeral_public_profile_url' ? 200 : 40;
    const baseline = await readPageProbe(document, maximumItems);
    assertRisk(baseline.risk);
    await armXiaohongshuExistingPublicProfileWorkObserver(document.tabId, item.workId);
    await prepareXiaohongshuProfileScroll(item.workId);
    await delay(1_200);
    networkProjection = await readXiaohongshuExistingPublicProfileWorkProjection(document.tabId, item.workId, maximumItems);
    projection = mergeProfileNotesProjection(networkProjection, baseline.items, maximumItems);
    const ephemeralProfileLink = item.executionTarget === 'ephemeral_public_profile_url';
    if (!ephemeralProfileLink) completionReason = 'profile_notes_ready';
    if (ephemeralProfileLink && projection.items.length >= maximumItems) {
      completionReason = 'profile_notes_budget_exhausted';
    }
    // A temporary profile link is supplied precisely so the caller can drain
    // the public profile in this short-lived window.  Do not stop after the
    // first payload (the old existing-tab path intentionally did that to keep
    // its three-action canary bounded).  The link path keeps scrolling until
    // the projection reaches its item cap or two consecutive scrolls produce
    // no new visible/network item.
    if ((ephemeralProfileLink || projection.items.length === 0) && projection.items.length < maximumItems) {
      const debuggee: chrome.debugger.Debuggee = { tabId: document.tabId };
      await chrome.debugger.attach(debuggee, '1.3').catch(() => {
        throw new Error('debugger_attach_failed');
      });
      attached = true;
      debuggerDetached = false;
      let previousItemCount = projection.items.length;
      let previousRenderedCardCount = baseline.renderedCardCount;
      let noProgressRounds = 0;
      for (let index = 1; index <= item.input.maximumScrolls; index += 1) {
        await requireSameDocument(document);
        await recordXiaohongshuProfileScrollIntent(item.workId, index as XiaohongshuProfileScrollCount);
        attemptedCount = index as XiaohongshuProfileScrollCount;
        const viewport = await readPageProbe(document, maximumItems);
        await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: Math.floor(viewport.viewportWidth / 2),
          y: Math.floor(viewport.viewportHeight * 0.8),
          deltaX: 0,
          deltaY: Math.max(320, Math.floor(viewport.viewportHeight * 0.75))
        }).catch(() => {
          throw new Error('debugger_input_failed');
        });
        await delay(1_400);
        await requireSameDocument(document);
        const afterScroll = await readPageProbe(document, maximumItems);
        assertRisk(afterScroll.risk);
        networkProjection = await readXiaohongshuExistingPublicProfileWorkProjection(document.tabId, item.workId, maximumItems);
        projection = mergeProfileNotesProjection(networkProjection, afterScroll.items, maximumItems);
        completedCount = index as XiaohongshuProfileScrollCount;
        if (!ephemeralProfileLink && projection.items.length > 0) break;
        if (projection.items.length >= maximumItems) {
          completionReason = 'profile_notes_budget_exhausted';
          break;
        }
        const madeProgress = projection.items.length > previousItemCount ||
          afterScroll.renderedCardCount > previousRenderedCardCount;
        if (ephemeralProfileLink) {
          noProgressRounds = madeProgress ? 0 : noProgressRounds + 1;
          if (noProgressRounds >= 2) {
            completionReason = 'profile_notes_ready';
            break;
          }
        }
        previousItemCount = projection.items.length;
        previousRenderedCardCount = afterScroll.renderedCardCount;
      }
      if (ephemeralProfileLink && completionReason === null && projection.items.length > 0) {
        completionReason = 'profile_notes_budget_exhausted';
      }
    }
    await completeXiaohongshuProfileScroll(item.workId);
    const page = await readPageProbe(document, maximumItems);
    renderedCardCount = page.renderedCardCount;
    assertRisk(page.risk);
    if (networkProjection) projection = mergeProfileNotesProjection(networkProjection, page.items, maximumItems);
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
  const projectionReady = errorCode === null && projection !== null && projection.items.length > 0 &&
    attemptedCount === completedCount && debuggerDetached;
  const completed = projectionReady && completionReason === 'profile_notes_ready';
  const budgetExhausted = projectionReady && completionReason === 'profile_notes_budget_exhausted';
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    workId: item.workId,
    operationId: item.operationId,
    browserBindingId: item.browserBindingId,
    platform: 'xiaohongshu',
    capability: 'xiaohongshu.account.public_notes.v1',
    executionTarget: item.executionTarget,
    state: completed ? 'completed' : 'stopped',
    errorCode: completed ? null : budgetExhausted
      ? 'xiaohongshu_profile_notes_budget_exhausted'
      : errorCode ?? 'xiaohongshu_profile_notes_postcondition_unmet',
    terminalReason: completed || budgetExhausted
      ? completionReason!
      : terminalReason(errorCode),
    completedAt: new Date().toISOString(),
    navigation: { attempted: navigationAttempted, attemptCount: navigationAttempted ? 1 : 0 },
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

async function navigateToEphemeralProfileUrl(profileUrl: string): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const eligible = tabs.filter((tab) => Number.isSafeInteger(tab.id) && !tab.incognito && tab.status === 'complete' &&
    isXiaohongshuPublicEntryTab(tab.url ?? ''));
  if (eligible.length === 0) throw new Error('xiaohongshu_profile_entry_tab_required');
  if (eligible.length !== 1) throw new Error('xiaohongshu_profile_entry_tab_ambiguous');
  const tab = eligible[0]!;
  const baselinePageCount = tabs.length;
  await chrome.windows.update(tab.windowId!, { focused: true }).catch(() => undefined);
  await chrome.tabs.update(tab.id!, { url: profileUrl });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const currentTabs = await chrome.tabs.query({});
    if (currentTabs.length !== baselinePageCount) throw new Error('xiaohongshu_profile_url_new_tab_detected');
    const current = await chrome.tabs.get(tab.id!).catch(() => null);
    const frame = await chrome.webNavigation.getFrame({ tabId: tab.id!, frameId: 0 }).catch(() => null);
    if (current?.status === 'complete' && frame?.documentId) {
      const surface = xiaohongshuCurrentPageNetworkPublicSurface(frame.url);
      if (surface === 'public_profile') return;
      if (surface !== null) throw new Error('xiaohongshu_profile_url_expired');
    }
    await delay(250);
  }
  throw new Error('xiaohongshu_profile_url_navigation_failed');
}

function isXiaohongshuPublicEntryTab(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'www.xiaohongshu.com' || url.username || url.password ||
      url.hash || url.port) return false;
    return url.pathname === '/explore' || url.pathname === '/explore/' ||
      /^\/explore\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) ||
      url.pathname === '/search_result' || url.pathname === '/search_result/' ||
      url.pathname === '/search_result_ai' || url.pathname === '/search_result_ai/' ||
      /^\/user\/profile\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
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

async function readPageProbe(profileDocument: ProfileDocument, maximumItems = 40): Promise<ProfileDomProbe> {
  const results = await chrome.scripting.executeScript({
    target: { tabId: profileDocument.tabId, documentIds: [profileDocument.documentId] },
    args: [Math.min(200, Math.max(1, maximumItems))],
    func: (requestedMaximumItems) => {
      const clean = (value: unknown, maximum: number): string =>
        (typeof value === 'string' ? value : '').replace(/[\u0000-\u001f\u007f]/g, '')
          .replace(/\s+/g, ' ').trim().slice(0, maximum);
      const visible = (element: Element): boolean => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
          style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0.01;
      };
      const cards = Array.from(document.querySelectorAll('section.note-item')).filter(visible);
      const items = cards.slice(0, requestedMaximumItems).map((section, index) => {
        const noteAnchor = Array.from(section.querySelectorAll('a[href]')).find((element) => {
          if (!(element instanceof HTMLAnchorElement)) return false;
          try {
            return /^\/explore\/[A-Za-z0-9_-]+\/?$/.test(new URL(element.href).pathname);
          } catch {
            return false;
          }
        }) as HTMLAnchorElement | undefined;
        let noteId = '';
        if (noteAnchor) {
          try {
            noteId = new URL(noteAnchor.href).pathname.match(/^\/explore\/([A-Za-z0-9_-]+)\/?$/)?.[1] ?? '';
          } catch {
            noteId = '';
          }
        }
        const titleCandidate = Array.from(section.querySelectorAll(
          '[class*="title"], [data-title], [class*="desc"]'
        )).find(visible);
        const title = clean(titleCandidate?.textContent ?? noteAnchor?.textContent ?? '', 500) ||
          clean((section.textContent ?? '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '', 500);
        const author = Array.from(section.querySelectorAll('a[href*="/user/profile/"]')).find(visible);
        const countCandidate = Array.from(section.querySelectorAll(
          '[class*="like"], [class*="interact"], [class*="count"]'
        )).map((element) => clean(element.textContent, 80)).find((value) => /\d/.test(value)) ?? '';
        const className = typeof section.className === 'string' ? section.className : '';
        const contentType = section.querySelector('video') || /video/i.test(className) ? 'video' : 'image';
        return {
          rank: index + 1,
          noteId,
          title,
          contentType,
          authorId: '',
          authorNickname: clean(author?.textContent, 200),
          likedCountText: countCandidate
        };
      }).filter((item) => item.noteId && item.title);
      return {
        pathname: location.pathname,
        title: document.title.slice(0, 300),
        visibleText: (document.body?.innerText ?? '').slice(0, 12_000),
        renderedCardCount: document.querySelectorAll('section.note-item').length,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        items
      };
    }
  });
  const value = results[0]?.result as {
    pathname?: unknown;
    title?: unknown;
    visibleText?: unknown;
    renderedCardCount?: unknown;
    viewportWidth?: unknown;
    viewportHeight?: unknown;
    items?: unknown;
  } | undefined;
  if (!value || typeof value.pathname !== 'string' || typeof value.title !== 'string' ||
    typeof value.visibleText !== 'string' || typeof value.renderedCardCount !== 'number' ||
    !Number.isSafeInteger(value.renderedCardCount) || typeof value.viewportWidth !== 'number' ||
    typeof value.viewportHeight !== 'number' || !Number.isFinite(value.viewportWidth) ||
    !Number.isFinite(value.viewportHeight) ||
    value.viewportWidth < 320 || value.viewportHeight < 240) {
    throw new Error('xiaohongshu_public_profile_probe_unavailable');
  }
  const renderedCardCount = Number(value.renderedCardCount);
  const viewportWidth = Number(value.viewportWidth);
  const viewportHeight = Number(value.viewportHeight);
  return {
    renderedCardCount: Math.min(80, Math.max(0, renderedCardCount)),
    viewportWidth,
    viewportHeight,
    items: normaliseProfileDomItems(value.items, maximumItems),
    risk: classifyXiaohongshuCurrentPageRisk({
      pathname: value.pathname,
      title: value.title,
      visibleText: value.visibleText
    })
  };
}

function normaliseProfileDomItems(value: unknown, maximumItems = 40): PublicProfileItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, Math.min(200, Math.max(1, Math.floor(maximumItems)))).map((entry) => {
    const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    const text = (field: string, maximum: number): string =>
      (typeof item[field] === 'string' ? item[field] : '').replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ').trim().slice(0, maximum);
    return {
      rank: Number.isSafeInteger(item.rank) ? Number(item.rank) : 0,
      noteId: text('noteId', 80),
      title: text('title', 500),
      contentType: text('contentType', 40),
      authorId: text('authorId', 80),
      authorNickname: text('authorNickname', 200),
      likedCountText: text('likedCountText', 40)
    };
  }).filter((item) => item.noteId && item.title).map((item, index) => ({ ...item, rank: index + 1 }));
}

export function mergeProfileNotesProjection(
  network: XiaohongshuManagedProfileNotesProjectionResult,
  domItems: PublicProfileItem[],
  maximumItems = 40
): XiaohongshuManagedProfileNotesProjectionResult {
  const merged = new Map<string, PublicProfileItem>();
  for (const item of network.items) merged.set(item.noteId, { ...item });
  for (const item of domItems) {
    const existing = merged.get(item.noteId);
    if (!existing) {
      merged.set(item.noteId, { ...item });
      continue;
    }
    merged.set(item.noteId, {
      ...existing,
      title: existing.title || item.title,
      contentType: existing.contentType || item.contentType,
      authorId: existing.authorId || item.authorId,
      authorNickname: existing.authorNickname || item.authorNickname,
      likedCountText: existing.likedCountText || item.likedCountText
    });
  }
  return {
    ...network,
    items: [...merged.values()].slice(0, Math.min(200, Math.max(1, maximumItems)))
      .map((item, index) => ({ ...item, rank: index + 1 }))
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
    case 'xiaohongshu_profile_url_invalid': return 'profile_url_invalid';
    case 'xiaohongshu_profile_entry_tab_required': return 'profile_url_navigation_failed';
    case 'xiaohongshu_profile_entry_tab_ambiguous': return 'profile_url_navigation_failed';
    case 'xiaohongshu_profile_url_expired': return 'profile_url_expired';
    case 'xiaohongshu_profile_url_navigation_failed': return 'profile_url_navigation_failed';
    case 'xiaohongshu_profile_url_new_tab_detected': return 'profile_url_context_changed';
    case 'xiaohongshu_profile_notes_budget_exhausted': return 'profile_notes_budget_exhausted';
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
