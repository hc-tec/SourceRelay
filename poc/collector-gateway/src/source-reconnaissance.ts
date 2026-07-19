import { randomUUID } from 'node:crypto';
import type { BrowserContext, Page, Request, Response } from 'playwright';
import type {
  DetailCapabilityValidationRunSnapshot,
  VisiblePageState
} from '../../collector-extension/src/shared/protocol';
import { sanitiseVisibleCollectionResult } from './evidence';
import {
  canonicalBilibiliVideoUrl,
  type BilibiliDetailSourceReconnaissanceRecord,
  type SourceDomObservation,
  type SourceDomTrigger as DomTrigger,
  type SourceExtensionEvent,
  type SourceLifecycleEvent,
  type SourceNetworkObservation,
  type SourceNetworkPhase as NetworkPhase
} from './source-reconnaissance-contract';
import {
  isBilibiliOwnedHostname,
  safePageUrl,
  safeSourceMethod as safeMethod,
  safeSourceMimeType as safeMimeType,
  serialiseSourceRouteSummary as serialiseRouteSummary,
  sourceSha256 as sha256
} from './source-reconnaissance-projector';

export * from './source-reconnaissance-contract';
export { sourceReconnaissanceErrorCode } from './source-reconnaissance-projector';
export { SourceReconnaissanceRegistry } from './source-reconnaissance-registry';

const MAX_DOM_OBSERVATIONS = 120;
const MAX_LIFECYCLE_EVENTS = 120;
const MAX_NETWORK_OBSERVATIONS = 300;
const MAX_EXTENSION_EVENTS = 120;
const DOM_SAMPLE_INTERVAL_MS = 500;

interface ObservedPageState {
  page: Page;
  documentSequence: number;
  targetSeen: boolean;
  targetMatch: boolean;
  pageUrlDigest: string;
  phase: NetworkPhase;
  interval: ReturnType<typeof setInterval> | null;
  sampling: boolean;
}

interface RawDomObservation {
  safePageUrl: string;
  readyState: string;
  visibleTextLength: number;
  pageStateSignal: VisiblePageState;
  contentScriptMarkerPresent: boolean;
  fieldSignals: SourceDomObservation['fieldSignals'];
}

export class BilibiliDetailSourceObserver {
  readonly #context: BrowserContext;
  readonly #runId: string;
  readonly #profileId: string;
  readonly #collectorVersion: string;
  readonly #targetUrl: string;
  readonly #targetUrlDigest: string;
  readonly #startedAt = new Date();
  readonly #startedEpoch = Date.now();
  readonly #pages = new Map<Page, ObservedPageState>();
  readonly #requestObservations = new Map<Request, SourceNetworkObservation>();
  readonly #pending = new Set<Promise<unknown>>();
  readonly #lifecycle: SourceLifecycleEvent[] = [];
  readonly #domObservations: SourceDomObservation[] = [];
  readonly #networkObservations: SourceNetworkObservation[] = [];
  readonly #extensionTimeline: SourceExtensionEvent[] = [];
  #started = false;
  #stopped = false;
  #networkDropped = 0;
  #externalExcluded = 0;
  #targetDocuments = 0;

  constructor(input: {
    context: BrowserContext;
    runId: string;
    profileId: string;
    collectorVersion: string;
    canonicalUrl: string;
  }) {
    const canonicalUrl = canonicalBilibiliVideoUrl(input.canonicalUrl);
    if (!canonicalUrl) throw new Error('source_reconnaissance_url_invalid');
    this.#context = input.context;
    this.#runId = input.runId;
    this.#profileId = input.profileId;
    this.#collectorVersion = input.collectorVersion;
    this.#targetUrl = canonicalUrl;
    this.#targetUrlDigest = sha256(canonicalUrl);
  }

  start(): void {
    if (this.#started) throw new Error('source_reconnaissance_observer_already_started');
    this.#started = true;
    this.#context.on('page', this.#onPage);
    for (const page of this.#context.pages()) this.#attachPage(page);
  }

  recordExtensionSnapshot(snapshot: DetailCapabilityValidationRunSnapshot): void {
    if (this.#stopped || this.#extensionTimeline.length >= MAX_EXTENSION_EVENTS) return;
    const event: SourceExtensionEvent = {
      sequence: this.#extensionTimeline.length + 1,
      atMs: this.#atMs(),
      state: snapshot.state,
      documentId: typeof snapshot.documentId === 'string' && snapshot.documentId.length <= 160
        ? snapshot.documentId
        : null,
      navigationUrlDigest: /^[0-9a-f]{64}$/.test(snapshot.navigationUrlDigest)
        ? snapshot.navigationUrlDigest
        : this.#targetUrlDigest,
      terminalStatus: snapshot.terminalStatus,
      errorCode: snapshot.errorCode && /^[a-z0-9_]{1,100}$/.test(snapshot.errorCode)
        ? snapshot.errorCode
        : null
    };
    const previous = this.#extensionTimeline.at(-1);
    if (
      previous && previous.state === event.state && previous.documentId === event.documentId &&
      previous.navigationUrlDigest === event.navigationUrlDigest &&
      previous.terminalStatus === event.terminalStatus && previous.errorCode === event.errorCode
    ) return;
    this.#extensionTimeline.push(event);
  }

  async finish(
    validation: DetailCapabilityValidationRunSnapshot | null,
    failureCode: string | null = null
  ): Promise<BilibiliDetailSourceReconnaissanceRecord> {
    if (this.#stopped) throw new Error('source_reconnaissance_observer_already_stopped');
    this.#stopped = true;
    this.#context.off('page', this.#onPage);
    for (const state of this.#pages.values()) {
      if (state.interval) clearInterval(state.interval);
      if (state.targetSeen && !state.page.isClosed()) this.#track(this.#sampleDom(state, 'final'));
    }
    await Promise.allSettled([...this.#pending]);
    await Promise.all([...this.#pages.values()]
      .filter((state) => state.targetSeen && !state.page.isClosed())
      .map((state) => state.page.close().catch(() => undefined)));

    const sanitisedResult = validation?.result
      ? sanitiseVisibleCollectionResult(validation.result)
      : null;
    const detailResult = sanitisedResult?.operation === 'detail_read'
      ? sanitisedResult
      : null;
    const targetObserved = this.#lifecycle.some((event) => event.event === 'main_frame_navigated' && event.targetMatch);
    const state: BilibiliDetailSourceReconnaissanceRecord['state'] = failureCode
      ? 'failed'
      : targetObserved
        ? 'completed'
        : 'inconclusive';

    return {
      schemaVersion: 1,
      recordId: randomUUID(),
      runId: this.#runId,
      collectorVersion: this.#collectorVersion,
      profileId: this.#profileId,
      platform: 'bilibili',
      pageRole: 'video_detail',
      evidenceObjective: 'detail_read',
      accountCategory: 'anonymous',
      targetUrlDigest: this.#targetUrlDigest,
      state,
      errorCode: failureCode ?? (targetObserved ? null : 'source_reconnaissance_target_not_observed'),
      startedAt: this.#startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      validation: {
        state: validation?.state ?? null,
        terminalStatus: validation?.terminalStatus ?? null,
        errorCode: validation?.errorCode ?? null,
        result: detailResult
      },
      lifecycle: this.#lifecycle,
      domObservations: this.#domObservations,
      extensionTimeline: this.#extensionTimeline,
      networkObservations: this.#networkObservations,
      routeSummary: serialiseRouteSummary(this.#networkObservations),
      counters: {
        attachedPages: this.#pages.size,
        targetDocuments: this.#targetDocuments,
        networkObservationsDroppedByLimit: this.#networkDropped,
        externalNetworkEventsExcluded: this.#externalExcluded
      },
      safeguards: {
        environment: 'local_user_controlled_validation_profile',
        browser: 'visible_playwright_chromium',
        observationMode: 'parallel_dom_and_network_metadata',
        productionResponseRoutes: 'unchanged_empty',
        requestHeaders: 'not_read',
        requestBody: 'not_read',
        responseHeaders: 'mime_and_content_length_only',
        responseBody: 'not_read',
        cookiesAndTokens: 'not_read',
        queryAndFragmentValues: 'discarded',
        postTerminalObservationMs: 5_000,
        observedTargetPages: 'closed_after_reconnaissance',
        admissionEligible: false
      }
    };
  }

  readonly #onPage = (page: Page): void => {
    this.#attachPage(page);
  };

  #attachPage(page: Page): void {
    if (this.#stopped || this.#pages.has(page)) return;
    const state: ObservedPageState = {
      page,
      documentSequence: 0,
      targetSeen: false,
      targetMatch: false,
      pageUrlDigest: sha256('about:blank'),
      phase: 'target_loading',
      interval: null,
      sampling: false
    };
    this.#pages.set(page, state);
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      const route = safePageUrl(frame.url());
      const targetMatch = route !== null && canonicalBilibiliVideoUrl(route) === this.#targetUrl;
      const wasTargetSeen = state.targetSeen;
      state.documentSequence += 1;
      state.targetMatch = targetMatch;
      state.targetSeen ||= targetMatch;
      state.pageUrlDigest = sha256(route ?? 'unsupported-page-url');
      state.phase = targetMatch ? 'target_loading' : 'navigated_away';
      if (targetMatch) this.#targetDocuments += 1;
      if (state.targetSeen || wasTargetSeen) {
        this.#recordLifecycle(state, 'main_frame_navigated');
        this.#track(this.#sampleDom(state, 'main_frame_navigated'));
      }
      if (state.targetSeen && !state.interval) {
        state.interval = setInterval(() => {
          if (this.#stopped || page.isClosed()) return;
          if (state.phase === 'target_load') state.phase = 'target_post_load';
          this.#track(this.#sampleDom(state, 'interval'));
        }, DOM_SAMPLE_INTERVAL_MS);
      }
    });
    page.on('domcontentloaded', () => {
      if (!state.targetSeen) return;
      if (state.targetMatch) state.phase = 'target_domcontentloaded';
      this.#recordLifecycle(state, 'domcontentloaded');
      this.#track(this.#sampleDom(state, 'domcontentloaded'));
    });
    page.on('load', () => {
      if (!state.targetSeen) return;
      if (state.targetMatch) state.phase = 'target_load';
      this.#recordLifecycle(state, 'load');
      this.#track(this.#sampleDom(state, 'load'));
    });
    page.on('response', (response) => this.#track(this.#observeResponse(state, response)));
    page.on('requestfinished', (request) => this.#track(this.#completeRequestSize(request)));
    page.on('requestfailed', (request) => this.#recordFailedRequest(state, request));
    page.on('close', () => {
      if (state.interval) clearInterval(state.interval);
      state.interval = null;
      if (state.targetSeen) this.#recordLifecycle(state, 'page_closed');
    });
  }

  #recordLifecycle(state: ObservedPageState, event: SourceLifecycleEvent['event']): void {
    if (this.#lifecycle.length >= MAX_LIFECYCLE_EVENTS) return;
    this.#lifecycle.push({
      sequence: this.#lifecycle.length + 1,
      atMs: this.#atMs(),
      event,
      documentSequence: state.documentSequence,
      pageUrlDigest: state.pageUrlDigest,
      targetMatch: state.targetMatch
    });
  }

  async #sampleDom(state: ObservedPageState, trigger: DomTrigger): Promise<void> {
    if (
      this.#stopped && trigger !== 'final' || state.sampling || !state.targetSeen || state.page.isClosed() ||
      this.#domObservations.length >= MAX_DOM_OBSERVATIONS
    ) return;
    state.sampling = true;
    try {
      const observation = await state.page.evaluate((): RawDomObservation => {
        const visible = (element: Element | null): element is HTMLElement => {
          if (!(element instanceof HTMLElement)) return false;
          const style = getComputedStyle(element);
          return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
        };
        const anyVisible = (selectors: readonly string[]): boolean => selectors.some((selector) => visible(document.querySelector(selector)));
        const visibleCount = (selectors: readonly string[]): number => selectors.reduce(
          (count, selector) => count + (visible(document.querySelector(selector)) ? 1 : 0),
          0
        );
        const bodyText = document.body?.innerText ?? '';
        const title = anyVisible([
          'h1.video-title[title]', 'h1.video-title', '.video-info-title-inner[title]', '.video-info-title-inner'
        ]);
        const creator = Array.from(document.querySelectorAll(
          '.up-info-container a.up-name[href], .up-info-container a[href*="space.bilibili.com/"]'
        )).some((element) => visible(element));
        const description = anyVisible([
          '.video-desc-container .desc-info-text',
          '.video-desc-container .basic-desc-info',
          '.video-desc-container'
        ]);
        const publishedText = anyVisible([
          '.video-info-meta .pubdate-ip-text',
          '.video-info-detail-list .pubdate-ip-text'
        ]);
        const visibleMetricCount = visibleCount([
          '.video-info-meta .view-text',
          '.video-info-meta .dm-text',
          '.video-toolbar-left .video-like-info',
          '.video-toolbar-left .video-coin-info',
          '.video-toolbar-left .video-fav-info',
          '.video-toolbar-left .video-share-wrap > span'
        ]);
        const visibleTagCount = Array.from(document.querySelectorAll('.tag-link[href]')).filter(visible).length;
        const pageStateSignal: VisiblePageState = title
          ? 'results_visible'
          : /验证码|安全验证|完成验证|请进行验证|异常访问/.test(bodyText)
            ? 'verification_required'
            : /请求过于频繁|访问频繁|操作频繁|稍后再试|风控/.test(bodyText)
              ? 'rate_limited'
              : /登录后查看更多|请先登录|登录后查看|登录后搜索/.test(bodyText)
                ? 'authentication_required'
                : /页面不存在|加载失败|网络错误|服务不可用|系统繁忙/.test(bodyText)
                  ? 'source_unavailable'
                  : 'layout_unrecognized';
        return {
          safePageUrl: `${location.origin}${location.pathname}`,
          readyState: document.readyState,
          visibleTextLength: Math.min(bodyText.length, 1_000_000),
          pageStateSignal,
          contentScriptMarkerPresent: document.documentElement.dataset.collectorExtensionReady === 'true',
          fieldSignals: {
            title,
            creator,
            description,
            publishedText,
            visibleMetricCount,
            visibleTagCount
          }
        };
      });
      const safeUrl = safePageUrl(observation.safePageUrl);
      const pageUrlDigest = sha256(safeUrl ?? 'unsupported-page-url');
      const targetMatch = safeUrl !== null && canonicalBilibiliVideoUrl(safeUrl) === this.#targetUrl;
      const fields = observation.fieldSignals;
      const terminalState = observation.pageStateSignal !== 'results_visible' && observation.pageStateSignal !== 'layout_unrecognized';
      const ready = fields.title && fields.publishedText && fields.visibleMetricCount >= 2 && (fields.description || fields.creator);
      this.#domObservations.push({
        sequence: this.#domObservations.length + 1,
        atMs: this.#atMs(),
        trigger,
        documentSequence: state.documentSequence,
        pageUrlDigest,
        targetMatch,
        readyState: observation.readyState === 'loading' || observation.readyState === 'interactive' || observation.readyState === 'complete'
          ? observation.readyState
          : 'unknown',
        visibleTextLength: observation.visibleTextLength,
        pageStateSignal: observation.pageStateSignal,
        collectorReadiness: terminalState ? 'terminal_state' : ready ? 'ready' : 'partial',
        contentScriptMarkerPresent: observation.contentScriptMarkerPresent,
        fieldSignals: fields
      });
    } catch {
      // A destroyed document is represented by its surrounding lifecycle
      // events. No page error text or potentially sensitive browser detail is
      // retained in the reconnaissance artifact.
    } finally {
      state.sampling = false;
    }
  }

  async #observeResponse(state: ObservedPageState, response: Response): Promise<void> {
    if (this.#stopped || !state.targetSeen) return;
    const request = response.request();
    const resourceType = request.resourceType();
    if (resourceType !== 'xhr' && resourceType !== 'fetch') return;
    let url: URL;
    try {
      url = new URL(response.url());
    } catch {
      return;
    }
    if (!isBilibiliOwnedHostname(url.hostname)) {
      this.#externalExcluded += 1;
      return;
    }
    if (this.#networkObservations.length >= MAX_NETWORK_OBSERVATIONS) {
      this.#networkDropped += 1;
      return;
    }
    const contentType = await response.headerValue('content-type').catch(() => null);
    const contentLength = await response.headerValue('content-length').catch(() => null);
    const declaredBytes = contentLength && /^\d{1,15}$/.test(contentLength)
      ? Number(contentLength)
      : null;
    let frameScope: SourceNetworkObservation['frameScope'] = 'child';
    try {
      frameScope = request.frame() === state.page.mainFrame() ? 'top' : 'child';
    } catch {
      // Requests without an attached frame are conservatively classified as child.
    }
    const observation: SourceNetworkObservation = {
      sequence: this.#networkObservations.length + 1,
      atMs: this.#atMs(),
      phase: state.phase,
      documentSequence: state.documentSequence,
      pageTargetMatch: state.targetMatch,
      frameScope,
      resourceType,
      method: safeMethod(request.method()),
      origin: url.origin,
      pathname: url.pathname,
      httpStatus: response.status(),
      mimeType: safeMimeType(contentType),
      responseBodyBytes: Number.isSafeInteger(declaredBytes) && declaredBytes! >= 0 ? declaredBytes : null,
      outcome: 'response'
    };
    this.#networkObservations.push(observation);
    this.#requestObservations.set(request, observation);
  }

  async #completeRequestSize(request: Request): Promise<void> {
    const observation = this.#requestObservations.get(request);
    if (!observation || observation.responseBodyBytes !== null) return;
    const sizes = await request.sizes().catch(() => null);
    if (sizes && Number.isSafeInteger(sizes.responseBodySize) && sizes.responseBodySize >= 0) {
      observation.responseBodyBytes = sizes.responseBodySize;
    }
  }

  #recordFailedRequest(state: ObservedPageState, request: Request): void {
    if (this.#stopped || !state.targetSeen) return;
    const resourceType = request.resourceType();
    if (resourceType !== 'xhr' && resourceType !== 'fetch') return;
    let url: URL;
    try {
      url = new URL(request.url());
    } catch {
      return;
    }
    if (!isBilibiliOwnedHostname(url.hostname)) {
      this.#externalExcluded += 1;
      return;
    }
    if (this.#networkObservations.length >= MAX_NETWORK_OBSERVATIONS) {
      this.#networkDropped += 1;
      return;
    }
    let frameScope: SourceNetworkObservation['frameScope'] = 'child';
    try {
      frameScope = request.frame() === state.page.mainFrame() ? 'top' : 'child';
    } catch {
      // See #observeResponse.
    }
    this.#networkObservations.push({
      sequence: this.#networkObservations.length + 1,
      atMs: this.#atMs(),
      phase: state.phase,
      documentSequence: state.documentSequence,
      pageTargetMatch: state.targetMatch,
      frameScope,
      resourceType,
      method: safeMethod(request.method()),
      origin: url.origin,
      pathname: url.pathname,
      httpStatus: null,
      mimeType: 'unknown',
      responseBodyBytes: null,
      outcome: 'request_failed'
    });
  }

  #track<T>(operation: Promise<T>): void {
    this.#pending.add(operation);
    void operation.finally(() => this.#pending.delete(operation));
  }

  #atMs(): number {
    return Math.max(0, Date.now() - this.#startedEpoch);
  }
}
