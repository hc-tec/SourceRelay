import {
  BILIBILI_DYNAMIC_STRATEGY_ID,
  STRATEGY_OBSERVATION_SCHEMA_VERSION,
  type BridgeJsonValue,
  type CollectorBindStrategyObserverCommand,
  type CollectorReadStrategyObservationCommand,
  type StrategyObservationResult,
  type StrategyObserverBindingResult
} from '@intelligence/collector-contracts';
import {
  bilibiliDynamicResearchRouteIds,
  type NetworkCaptureObservation
} from '../../shared/network-capture';
import {
  armNetworkCapture,
  clearNetworkCaptureState,
  getActiveNetworkCaptureArm,
  readNetworkCaptures
} from '../network-capture-runtime';

interface StoredDynamicBinding {
  schemaVersion: 1;
  tabId: number;
  nextDocumentGeneration: number;
  contentScriptId: string;
  binding: CollectorBindStrategyObserverCommand['binding'];
}

export async function bindBilibiliDynamicObserver(
  command: CollectorBindStrategyObserverCommand
): Promise<StrategyObserverBindingResult> {
  await cleanupExpiredBilibiliDynamicObserverBindings();
  const { binding, tabId } = command;
  if (binding.strategyId !== BILIBILI_DYNAMIC_STRATEGY_ID) throw new Error('dynamic_strategy_id_rejected');
  if (binding.maximumResponseObservations !== 1) {
    throw new Error('dynamic_strategy_response_budget_rejected');
  }
  const permissionsReady = await chrome.permissions.contains({
    origins: ['https://space.bilibili.com/*', 'https://api.bilibili.com/*']
  });
  if (!permissionsReady) throw new Error('dynamic_strategy_permission_missing');
  const tab = await chrome.tabs.get(tabId);
  if (tab.url && tab.url !== 'about:blank' && canonicalDynamicUrl(tab.url) !== binding.target.canonicalUrl) {
    throw new Error('dynamic_strategy_tab_context_rejected');
  }
  await removeBindingsForTab(tabId);
  const contentScriptId = `collector-dynamic-${binding.observerBindingId.replace(/-/g, '')}`;
  await chrome.scripting.unregisterContentScripts({ ids: [contentScriptId] }).catch(() => undefined);
  await chrome.scripting.registerContentScripts([{
    id: contentScriptId,
    matches: ['https://space.bilibili.com/*'],
    js: ['network-capture-bridge.js'],
    runAt: 'document_start',
    allFrames: false,
    persistAcrossSessions: false,
    world: 'ISOLATED'
  }]);
  await armNetworkCapture({
    tabId,
    platform: 'bilibili',
    purpose: 'dynamic_strategy',
    runId: binding.runId,
    navigationUrl: binding.target.canonicalUrl,
    routeIds: bilibiliDynamicResearchRouteIds(),
    maximumObservations: binding.maximumResponseObservations,
    expiresAt: Date.parse(binding.expiresAt),
    observerBindingId: binding.observerBindingId,
    contentScriptId
  });
  const stored: StoredDynamicBinding = {
    schemaVersion: 1,
    tabId,
    nextDocumentGeneration: command.nextDocumentGeneration,
    contentScriptId,
    binding: structuredClone(binding)
  };
  await chrome.storage.session.set({ [bindingStorageKey(binding.observerBindingId)]: stored });
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

export async function readBilibiliDynamicObservation(
  command: CollectorReadStrategyObservationCommand
): Promise<StrategyObservationResult> {
  const stored = await storedBinding(command.request.observerBindingId);
  if (!stored || stored.tabId !== command.tabId ||
    stored.binding.pageLeaseId !== command.request.pageLeaseId ||
    stored.binding.runId !== command.request.runId ||
    stored.binding.pageAlias !== command.request.pageAlias ||
    stored.binding.strategyId !== command.request.strategyId ||
    command.documentGeneration < stored.nextDocumentGeneration) {
    throw new Error('dynamic_strategy_binding_context_rejected');
  }
  const arm = await getActiveNetworkCaptureArm(command.tabId);
  if (!arm || arm.observerBindingId !== command.request.observerBindingId || !arm.documentId) {
    throw new Error('dynamic_strategy_observer_not_bound');
  }
  const deadline = Date.now() + command.request.deadlineMs;
  let dom: DynamicDomSnapshot | null = null;
  let responses: NetworkCaptureObservation[] = [];
  do {
    const tab = await chrome.tabs.get(command.tabId);
    if (!tab.url || canonicalDynamicUrl(tab.url) !== stored.binding.target.canonicalUrl) {
      throw new Error('dynamic_strategy_document_context_changed');
    }
    responses = await readNetworkCaptures(command.tabId, arm);
    dom = await captureDynamicDom(command.tabId, arm.documentId);
    if (dom.risk.verificationRequired || dom.risk.rateLimited || dom.risk.sourceUnavailable ||
      (dom.cards.length > 0 && responses.some((response) => response.status === 'captured'))) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  if (!dom) throw new Error('dynamic_strategy_dom_unavailable');
  const payload = {
    schemaVersion: 1,
    strategyId: BILIBILI_DYNAMIC_STRATEGY_ID,
    stableAccountId: stored.binding.target.stableAccountId,
    documentId: arm.documentId,
    dom,
    responses
  } as unknown as BridgeJsonValue;
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  if (payloadBytes > stored.binding.maximumPayloadBytes) {
    throw new Error('dynamic_strategy_observation_payload_too_large');
  }
  return {
    schemaVersion: STRATEGY_OBSERVATION_SCHEMA_VERSION,
    type: 'collector_strategy_observation',
    strategyId: BILIBILI_DYNAMIC_STRATEGY_ID,
    observerBindingId: stored.binding.observerBindingId,
    pageAlias: stored.binding.pageAlias,
    documentGeneration: command.documentGeneration,
    routeGeneration: command.routeGeneration,
    capturedAt: new Date().toISOString(),
    payloadBytes,
    payload
  };
}

function bindingStorageKey(observerBindingId: string): string {
  return `collector.strategy-observer.${observerBindingId}`;
}

async function storedBinding(observerBindingId: string): Promise<StoredDynamicBinding | null> {
  const key = bindingStorageKey(observerBindingId);
  const value = (await chrome.storage.session.get(key))[key] as StoredDynamicBinding | undefined;
  return value?.schemaVersion === 1 && value.binding?.observerBindingId === observerBindingId &&
    Date.parse(value.binding.expiresAt) > Date.now()
    ? value
    : null;
}

export async function cleanupExpiredBilibiliDynamicObserverBindings(): Promise<void> {
  const values = await chrome.storage.session.get(null);
  const expiredKeys: string[] = [];
  const expiredScriptIds: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith('collector.strategy-observer.')) continue;
    const candidate = value as Partial<StoredDynamicBinding>;
    if (typeof candidate.binding?.expiresAt === 'string' && Date.parse(candidate.binding.expiresAt) > Date.now()) continue;
    expiredKeys.push(key);
    if (typeof candidate.contentScriptId === 'string') expiredScriptIds.push(candidate.contentScriptId);
  }
  if (expiredScriptIds.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: expiredScriptIds }).catch(() => undefined);
  }
  if (expiredKeys.length > 0) await chrome.storage.session.remove(expiredKeys);
}

async function removeBindingsForTab(tabId: number): Promise<void> {
  const values = await chrome.storage.session.get(null);
  const keys: string[] = [];
  const scriptIds: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith('collector.strategy-observer.')) continue;
    const candidate = value as Partial<StoredDynamicBinding>;
    if (candidate.tabId !== tabId) continue;
    keys.push(key);
    if (typeof candidate.contentScriptId === 'string') scriptIds.push(candidate.contentScriptId);
  }
  if (scriptIds.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: scriptIds }).catch(() => undefined);
  }
  if (keys.length > 0) await chrome.storage.session.remove(keys);
  await clearNetworkCaptureState(tabId);
}

function canonicalDynamicUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const match = url.protocol === 'https:' && url.hostname === 'space.bilibili.com'
      ? url.pathname.match(/^\/(\d{1,20})\/dynamic\/?$/)
      : null;
    return match?.[1] ? `https://space.bilibili.com/${match[1]}/dynamic` : null;
  } catch {
    return null;
  }
}

interface DynamicDomSnapshot {
  stableAccountId: string | null;
  visibleFilterLabels: string[];
  activeFilterLabel: string | null;
  cards: Array<{
    position: number;
    outerAuthor: string;
    publishedVisibleText: string | null;
    visibleText: string;
    links: Array<{ text: string; url: string }>;
    images: Array<{ alt: string; url: string }>;
    kind: 'video' | 'opus' | 'blocked' | 'other';
    blockedPlaceholder: boolean;
    reservation: boolean;
    forwarded: boolean;
  }>;
  risk: { verificationRequired: boolean; rateLimited: boolean; sourceUnavailable: boolean };
}

async function captureDynamicDom(tabId: number, documentId: string): Promise<DynamicDomSnapshot> {
  const results = await chrome.scripting.executeScript({
    target: { tabId, documentIds: [documentId] },
    world: 'ISOLATED',
    func: () => {
      const clean = (value: string | null | undefined, maximum: number): string =>
        (value ?? '').replace(/\s+/g, ' ').trim().slice(0, maximum);
      const safeUrl = (value: string): string | null => {
        try {
          const url = new URL(value, location.href);
          if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
          url.username = '';
          url.password = '';
          url.search = '';
          url.hash = '';
          return url.href.slice(0, 2_000);
        } catch {
          return null;
        }
      };
      const rendered = (element: Element | null): element is HTMLElement => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const pathMatch = location.hostname === 'space.bilibili.com'
        ? location.pathname.match(/^\/(\d{1,20})\/dynamic\/?$/)
        : null;
      const filterItems = Array.from(document.querySelectorAll<HTMLElement>('.side-nav__item')).filter(rendered);
      const cards = Array.from(document.querySelectorAll<HTMLElement>('.bili-dyn-list__item')).filter(rendered)
        .slice(0, 24)
        .map((card, index) => ({
          position: index + 1,
          outerAuthor: clean(card.querySelector<HTMLElement>('.bili-dyn-title__text')?.innerText, 200),
          publishedVisibleText: clean(card.querySelector<HTMLElement>('.bili-dyn-item__desc')?.innerText, 200) || null,
          visibleText: clean(card.innerText, 3_000),
          links: Array.from(card.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(rendered).slice(0, 12)
            .map((anchor) => {
              const url = safeUrl(anchor.href);
              return url ? { text: clean(anchor.innerText || anchor.getAttribute('aria-label'), 240), url } : null;
            }).filter((link): link is { text: string; url: string } => link !== null),
          images: Array.from(card.querySelectorAll<HTMLImageElement>('img[src]')).filter(rendered).slice(0, 8)
            .map((image) => {
              const url = safeUrl(image.currentSrc || image.src);
              return url ? { alt: clean(image.alt, 240), url } : null;
            }).filter((image): image is { alt: string; url: string } => image !== null),
          kind: (card.querySelector('.dyn-blocked-mask') ? 'blocked'
            : card.querySelector('a.bili-dyn-card-video[href]') ? 'video'
              : card.querySelector('.dyn-card-opus') ? 'opus' : 'other') as 'video' | 'opus' | 'blocked' | 'other',
          blockedPlaceholder: Boolean(card.querySelector('.dyn-blocked-mask')),
          reservation: Boolean(card.querySelector('.bili-dyn-card-reserve')),
          forwarded: Boolean(card.querySelector('.bili-dyn-content__forw__desc, .bili-dyn-content__orig__author'))
        }));
      const bodyText = clean(document.body?.innerText, 100_000);
      const activeFilter = filterItems.find((item) => /(?:^|\s)active(?:\s|$)/.test(String(item.className)));
      return {
        stableAccountId: pathMatch?.[1] ?? null,
        visibleFilterLabels: [...new Set(filterItems.map((item) => clean(item.textContent, 40)).filter(Boolean))],
        activeFilterLabel: activeFilter ? clean(activeFilter.textContent, 40) || null : null,
        cards,
        risk: {
          verificationRequired: /验证码|安全验证|完成验证|请进行验证|异常访问/.test(bodyText),
          rateLimited: /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(bodyText),
          sourceUnavailable: /页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(bodyText)
        }
      };
    }
  });
  const result = results[0]?.result;
  if (!result) throw new Error('dynamic_strategy_dom_projection_missing');
  return result as DynamicDomSnapshot;
}
