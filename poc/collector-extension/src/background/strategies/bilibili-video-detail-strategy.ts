import {
  BILIBILI_VIDEO_DETAIL_STRATEGY_ID,
  STRATEGY_OBSERVATION_SCHEMA_VERSION,
  type BridgeJsonValue,
  type CollectorBindStrategyObserverCommand,
  type CollectorReadStrategyObservationCommand,
  type StrategyObservationResult,
  type StrategyObserverBindingRequest,
  type StrategyObserverBindingResult
} from '@intelligence/collector-contracts';
import { canonicalBilibiliVideoUrl } from '../../shared/bilibili-video-url';
import {
  BILIBILI_VIDEO_DETAIL_DOCUMENT_READY_MESSAGE,
  isBilibiliVideoDetailDocumentReadyMessage
} from '../../shared/bilibili-video-detail-document-bridge';
import {
  clearStrategyBindingsForTab,
  VIDEO_DETAIL_OBSERVER_BINDING_STORAGE_PREFIX
} from '../strategy-binding-state';

type VideoDetailBinding = Extract<StrategyObserverBindingRequest, {
  strategyId: typeof BILIBILI_VIDEO_DETAIL_STRATEGY_ID;
}>;

interface StoredVideoDetailBinding {
  schemaVersion: 1;
  tabId: number;
  nextDocumentGeneration: number;
  contentScriptId: string;
  documentId: string | null;
  binding: VideoDetailBinding;
}

interface VideoDetailDomSnapshot {
  bvid: string | null;
  title: string | null;
  metadataVisibleText: string | null;
  description: string | null;
  creator: {
    displayName: string | null;
    publicAccountId: string | null;
  } | null;
  tagTexts: string[];
  episodeSummaryText: string | null;
  titleVisible: boolean;
  playerVisible: boolean;
  loginOverlayVisible: boolean;
  risk: {
    verificationRequired: boolean;
    rateLimited: boolean;
    sourceUnavailable: boolean;
  };
}

let documentBridgeInitialised = false;

/**
 * Listens only for the fixed document-start bridge from this source-specific
 * content script. No DOM or page values cross this message boundary.
 */
export function initialiseBilibiliVideoDetailDocumentBridge(): void {
  if (documentBridgeInitialised) return;
  documentBridgeInitialised = true;
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isBilibiliVideoDetailDocumentReadyMessage(message)) return false;
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number' || sender.frameId !== 0 || !sender.documentId) {
      sendResponse({ ok: true, bound: false });
      return false;
    }
    void bindDocumentToVideoDetailObserver(tabId, sender.url, sender.documentId).then(
      (bound) => sendResponse({ ok: true, bound }),
      () => sendResponse({ ok: true, bound: false })
    );
    return true;
  });
}

export async function bindBilibiliVideoDetailObserver(
  command: CollectorBindStrategyObserverCommand
): Promise<StrategyObserverBindingResult> {
  const binding = command.binding;
  if (binding.strategyId !== BILIBILI_VIDEO_DETAIL_STRATEGY_ID) {
    throw new Error('video_detail_strategy_id_rejected');
  }
  if (binding.maximumResponseObservations !== 0) {
    throw new Error('video_detail_strategy_response_budget_rejected');
  }
  await cleanupExpiredBilibiliVideoDetailObserverBindings();
  const permissionsReady = await chrome.permissions.contains({ origins: ['https://www.bilibili.com/*'] });
  if (!permissionsReady) throw new Error('video_detail_strategy_permission_missing');
  const tab = await chrome.tabs.get(command.tabId);
  if (tab.url && tab.url !== 'about:blank' && canonicalBilibiliVideoUrl(tab.url, 'observed_document') !== binding.target.canonicalUrl) {
    throw new Error('video_detail_strategy_tab_context_rejected');
  }
  await clearStrategyBindingsForTab(command.tabId);
  const contentScriptId = `collector-video-detail-${binding.observerBindingId.replace(/-/g, '')}`;
  await chrome.scripting.unregisterContentScripts({ ids: [contentScriptId] }).catch(() => undefined);
  await chrome.scripting.registerContentScripts([{
    id: contentScriptId,
    matches: ['https://www.bilibili.com/video/*'],
    js: ['bilibili-video-detail-document-bridge.js'],
    runAt: 'document_start',
    allFrames: false,
    persistAcrossSessions: false,
    world: 'ISOLATED'
  }]);
  const stored: StoredVideoDetailBinding = {
    schemaVersion: 1,
    tabId: command.tabId,
    nextDocumentGeneration: command.nextDocumentGeneration,
    contentScriptId,
    documentId: null,
    binding: structuredClone(binding)
  };
  await chrome.storage.session.set({ [bindingStorageKey(binding.observerBindingId)]: stored });

  // An exact retained target page does not re-run a newly registered
  // document_start script. Trigger the same fixed handshake in that document;
  // sender.documentId still supplies the identity to the listener above.
  if (tab.url && canonicalBilibiliVideoUrl(tab.url, 'observed_document') === binding.target.canonicalUrl) {
    await chrome.scripting.executeScript({
      target: { tabId: command.tabId },
      world: 'ISOLATED',
      func: (messageType: string) => void chrome.runtime.sendMessage({ type: messageType }).catch(() => undefined),
      args: [BILIBILI_VIDEO_DETAIL_DOCUMENT_READY_MESSAGE],
      injectImmediately: true
    });
  }
  return {
    schemaVersion: STRATEGY_OBSERVATION_SCHEMA_VERSION,
    type: 'collector_strategy_observer_binding',
    strategyId: binding.strategyId,
    observerBindingId: binding.observerBindingId,
    pageAlias: binding.pageAlias,
    state: 'ready',
    nextDocumentGeneration: command.nextDocumentGeneration,
    expiresAt: binding.expiresAt
  };
}

export async function readBilibiliVideoDetailObservation(
  command: CollectorReadStrategyObservationCommand
): Promise<StrategyObservationResult> {
  if (command.request.strategyId !== BILIBILI_VIDEO_DETAIL_STRATEGY_ID) {
    throw new Error('video_detail_strategy_id_rejected');
  }
  const deadline = Date.now() + command.request.deadlineMs;
  let stored = await storedBinding(command.request.observerBindingId);
  if (!matchesReadContext(stored, command)) throw new Error('video_detail_strategy_binding_context_rejected');
  let dom: VideoDetailDomSnapshot | null = null;
  do {
    stored = await storedBinding(command.request.observerBindingId);
    if (!matchesReadContext(stored, command)) throw new Error('video_detail_strategy_binding_context_rejected');
    if (!stored.documentId) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    const tab = await chrome.tabs.get(command.tabId);
    if (!tab.url || canonicalBilibiliVideoUrl(tab.url, 'observed_document') !== stored.binding.target.canonicalUrl) {
      throw new Error('video_detail_strategy_document_context_changed');
    }
    dom = await captureVideoDetailDom(command.tabId, stored.documentId);
    if (
      dom.risk.verificationRequired ||
      dom.risk.rateLimited ||
      dom.risk.sourceUnavailable ||
      (dom.bvid === stored.binding.target.bvid && dom.titleVisible && dom.playerVisible && Boolean(dom.title))
    ) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  if (!stored?.documentId) throw new Error('video_detail_strategy_document_not_bound');
  if (!dom) throw new Error('video_detail_strategy_dom_unavailable');
  const payload = {
    schemaVersion: 1,
    strategyId: BILIBILI_VIDEO_DETAIL_STRATEGY_ID,
    bvid: stored.binding.target.bvid,
    documentId: stored.documentId,
    dom
  } as unknown as BridgeJsonValue;
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  if (payloadBytes > stored.binding.maximumPayloadBytes) {
    throw new Error('video_detail_strategy_observation_payload_too_large');
  }
  return {
    schemaVersion: STRATEGY_OBSERVATION_SCHEMA_VERSION,
    type: 'collector_strategy_observation',
    strategyId: BILIBILI_VIDEO_DETAIL_STRATEGY_ID,
    observerBindingId: stored.binding.observerBindingId,
    pageAlias: stored.binding.pageAlias,
    documentGeneration: command.documentGeneration,
    routeGeneration: command.routeGeneration,
    capturedAt: new Date().toISOString(),
    payloadBytes,
    payload
  };
}

export async function cleanupExpiredBilibiliVideoDetailObserverBindings(): Promise<void> {
  const values = await chrome.storage.session.get(null);
  const expiredKeys: string[] = [];
  const expiredScriptIds: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith(VIDEO_DETAIL_OBSERVER_BINDING_STORAGE_PREFIX)) continue;
    const candidate = value as Partial<StoredVideoDetailBinding>;
    if (typeof candidate.binding?.expiresAt === 'string' && Date.parse(candidate.binding.expiresAt) > Date.now()) continue;
    expiredKeys.push(key);
    if (typeof candidate.contentScriptId === 'string') expiredScriptIds.push(candidate.contentScriptId);
  }
  if (expiredScriptIds.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: expiredScriptIds }).catch(() => undefined);
  }
  if (expiredKeys.length > 0) await chrome.storage.session.remove(expiredKeys);
}

function matchesReadContext(
  stored: StoredVideoDetailBinding | null,
  command: CollectorReadStrategyObservationCommand
): stored is StoredVideoDetailBinding {
  return Boolean(
    stored &&
    stored.tabId === command.tabId &&
    stored.binding.pageLeaseId === command.request.pageLeaseId &&
    stored.binding.runId === command.request.runId &&
    stored.binding.pageAlias === command.request.pageAlias &&
    stored.binding.strategyId === command.request.strategyId &&
    command.documentGeneration >= stored.nextDocumentGeneration
  );
}

async function bindDocumentToVideoDetailObserver(
  tabId: number,
  senderUrl: string | undefined,
  documentId: string
): Promise<boolean> {
  const stored = await storedBindingForTab(tabId);
  if (!stored || stored.documentId !== null ||
    canonicalBilibiliVideoUrl(senderUrl ?? '', 'observed_document') !== stored.binding.target.canonicalUrl) {
    return false;
  }
  const updated: StoredVideoDetailBinding = { ...stored, documentId };
  await chrome.storage.session.set({ [bindingStorageKey(updated.binding.observerBindingId)]: updated });
  await chrome.scripting.unregisterContentScripts({ ids: [updated.contentScriptId] }).catch(() => undefined);
  return true;
}

function bindingStorageKey(observerBindingId: string): string {
  return `${VIDEO_DETAIL_OBSERVER_BINDING_STORAGE_PREFIX}${observerBindingId}`;
}

async function storedBinding(observerBindingId: string): Promise<StoredVideoDetailBinding | null> {
  const key = bindingStorageKey(observerBindingId);
  const value = (await chrome.storage.session.get(key))[key] as StoredVideoDetailBinding | undefined;
  return value?.schemaVersion === 1 && value.binding?.observerBindingId === observerBindingId &&
    value.binding.strategyId === BILIBILI_VIDEO_DETAIL_STRATEGY_ID &&
    Date.parse(value.binding.expiresAt) > Date.now()
    ? value
    : null;
}

async function storedBindingForTab(tabId: number): Promise<StoredVideoDetailBinding | null> {
  const values = await chrome.storage.session.get(null);
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith(VIDEO_DETAIL_OBSERVER_BINDING_STORAGE_PREFIX)) continue;
    const candidate = value as StoredVideoDetailBinding;
    if (candidate.tabId === tabId && candidate.documentId === null && Date.parse(candidate.binding?.expiresAt) > Date.now()) {
      return candidate;
    }
  }
  return null;
}

async function captureVideoDetailDom(tabId: number, documentId: string): Promise<VideoDetailDomSnapshot> {
  let results: chrome.scripting.InjectionResult<VideoDetailDomSnapshot>[];
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId, documentIds: [documentId] },
      world: 'ISOLATED',
      func: () => {
      const clean = (value: string | null | undefined, maximum: number): string | null => {
        const result = (value ?? '').replace(/\s+/g, ' ').trim();
        return result && result.length <= maximum && !/[\u0000-\u001f\u007f]/.test(result) ? result : null;
      };
      const rendered = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' &&
          Number.parseFloat(style.opacity || '1') > 0.01;
      };
      const canonicalBvid = location.protocol === 'https:' && location.hostname === 'www.bilibili.com'
        ? location.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/)?.[1] ?? null
        : null;
      const titleElement = Array.from(document.querySelectorAll<HTMLElement>('h1')).find(rendered) ?? null;
      const player = document.querySelector<HTMLElement>('[aria-label="哔哩哔哩播放器"]');
      const description = document.querySelector<HTMLElement>('#v_desc');
      const upInfo = document.querySelector<HTMLElement>('#v_upinfo');
      const creatorAnchor = upInfo
        ? Array.from(upInfo.querySelectorAll<HTMLAnchorElement>('a[href]')).find(rendered) ?? null
        : null;
      let creator: { displayName: string | null; publicAccountId: string | null } | null = null;
      if (creatorAnchor) {
        try {
          const url = new URL(creatorAnchor.href);
          const accountId = url.hostname === 'space.bilibili.com'
            ? url.pathname.match(/^\/(\d{1,20})\/?$/)?.[1] ?? null
            : null;
          creator = { displayName: clean(creatorAnchor.innerText, 200), publicAccountId: accountId };
        } catch {
          creator = { displayName: clean(creatorAnchor.innerText, 200), publicAccountId: null };
        }
      }
      const tagTexts = [...new Set(Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(rendered)
        .map((anchor) => {
          try {
            const url = new URL(anchor.href);
            return url.hostname === 'search.bilibili.com' && url.pathname === '/all'
              ? clean(anchor.innerText, 100)
              : null;
          } catch {
            return null;
          }
        }).filter((value): value is string => value !== null))].slice(0, 20);
      const episodeHeading = Array.from(document.querySelectorAll<HTMLElement>('*')).find((element) =>
        rendered(element) && element.children.length === 0 && clean(element.textContent, 40) === '视频选集'
      ) ?? null;
      const episodeSummaryText = clean(episodeHeading?.parentElement?.textContent, 500);
      const bodyText = clean(document.body?.innerText, 100_000) ?? '';
      const loginOverlayVisible = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [class*="login" i], [class*="passport" i]'))
        .some((element) => rendered(element) && element.getBoundingClientRect().width >= 160 && element.getBoundingClientRect().height >= 120);
      return {
        bvid: canonicalBvid,
        title: clean(titleElement?.innerText, 500),
        metadataVisibleText: clean(titleElement?.parentElement?.textContent, 1_000),
        description: rendered(description) ? clean(description.innerText, 20_000) : null,
        creator,
        tagTexts,
        episodeSummaryText,
        titleVisible: rendered(titleElement),
        playerVisible: rendered(player),
        loginOverlayVisible,
        risk: {
          verificationRequired: /验证码|安全验证|完成验证|请进行验证|异常访问/.test(bodyText),
          rateLimited: /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(bodyText),
          sourceUnavailable: /页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(bodyText)
        }
      };
      }
    });
  } catch {
    // An exact document ID disappearing means this binding can no longer prove
    // that it is reading the navigated document. The Gateway will quarantine
    // that page rather than falling back to its current tab or URL.
    throw new Error('video_detail_strategy_document_context_changed');
  }
  const result = results[0]?.result;
  if (!result) throw new Error('video_detail_strategy_document_context_changed');
  return result as VideoDetailDomSnapshot;
}
