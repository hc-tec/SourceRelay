import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserContext, Locator, Page, Request, Response } from 'playwright';
import {
  captionMenuReadyFromLabels,
  canonicalBilibiliVideoUrl,
  interactionObjectiveAssessment,
  interactionOutcomeWasAttempted,
  type BilibiliInteractionReconnaissanceInput,
  type BilibiliInteractionReconnaissanceRecord,
  type InteractionActionObservation,
  type InteractionNetworkObservation,
  type InteractionPhase,
  type InteractionResponseBodyMapping
} from './interaction-reconnaissance-contract';
import {
  networkOwnership as ownership,
  queryKeyNames,
  responseBodyRouteAllowed,
  responseSchema,
  safeInteractionErrorCode as safeErrorCode,
  safeMimeType,
  serialiseInteractionRoutes as serialiseRoutes,
  sha256,
  sha256Bytes
} from './interaction-response-projector';

export * from './interaction-reconnaissance-contract';

const MAX_NETWORK_OBSERVATIONS = 500;
const ACTION_TAIL_MS = 3_000;
const MAX_MAPPED_RESPONSE_BYTES = 512 * 1024;
const MAX_TOTAL_MAPPED_RESPONSE_BYTES = 1024 * 1024;
const MAX_RUN_MS = 60_000;
const MAX_FAILED_XHR_FETCH_PER_PHASE = 3;
const CAPTION_MENU_READY_TIMEOUT_MS = 2_500;
const CAPTION_MENU_POLL_INTERVAL_MS = 100;

async function firstVisible(locators: readonly Locator[]): Promise<Locator | null> {
  for (const locator of locators) {
    const count = Math.min(await locator.count(), 20);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
  }
  return null;
}

async function relevantVisibleLabels(page: Page, pattern: RegExp, maximum = 30): Promise<string[]> {
  return page.evaluate(({ source, flags, maximumLabels }) => {
    const matcher = new RegExp(source, flags);
    const roots: (Document | ShadowRoot)[] = [document];
    const seen = new Set<Document | ShadowRoot>();
    const labels = new Set<string>();
    while (roots.length > 0 && labels.size < maximumLabels) {
      const root = roots.pop();
      if (!root || seen.has(root)) continue;
      seen.add(root);
      for (const element of Array.from(root.querySelectorAll('*'))) {
        if (element.shadowRoot) roots.push(element.shadowRoot);
        if (!(element instanceof HTMLElement) || element.children.length > 4) continue;
        const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text || text.length > 80 || !matcher.test(text)) continue;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || element.getClientRects().length === 0) continue;
        labels.add(text);
        if (labels.size >= maximumLabels) break;
      }
    }
    return [...labels];
  }, { source: pattern.source, flags: pattern.flags, maximumLabels: maximum });
}

async function waitForCaptionMenuReadiness(page: Page): Promise<{
  ready: boolean;
  labels: string[];
}> {
  const deadline = Date.now() + CAPTION_MENU_READY_TIMEOUT_MS;
  let labels: string[] = [];
  do {
    labels = await relevantVisibleLabels(
      page,
      /^(?:字幕样式测试|字幕|关闭|中文|汉语|字幕设置|字幕大小(?: .*)?|字幕颜色(?: .*)?|(?:中文|汉语).*(?:自动生成|AI).*)$/
    );
    if (captionMenuReadyFromLabels(labels)) return { ready: true, labels };
    await delay(CAPTION_MENU_POLL_INTERVAL_MS);
  } while (Date.now() < deadline);
  return { ready: false, labels };
}

export class BilibiliInteractionReconnaissanceRunner {
  readonly #context: BrowserContext;
  readonly #runId: string;
  readonly #profileId: string;
  readonly #collectorVersion: string;
  readonly #canonicalUrl: string;
  readonly #actionScope: BilibiliInteractionReconnaissanceInput['actionScope'];
  readonly #responseBodyMapping: BilibiliInteractionReconnaissanceInput['responseBodyMapping'];
  readonly #startedAt = new Date();
  readonly #startedEpoch = Date.now();
  readonly #network: InteractionNetworkObservation[] = [];
  readonly #bodyMappings: InteractionResponseBodyMapping[] = [];
  readonly #mappedRouteKeys = new Set<string>();
  readonly #pending = new Set<Promise<void>>();
  readonly #attemptedActionIds = new Set<string>();
  readonly #failedRequestsByPhase = new Map<Exclude<InteractionPhase, 'idle'>, number>();
  readonly #beforeAction: (actionId: string) => Promise<void>;
  #phase: InteractionPhase = 'idle';
  #networkDropped = 0;
  #mappedResponseBytes = 0;
  #terminalAction: InteractionActionObservation | null = null;

  constructor(input: {
    context: BrowserContext;
    runId: string;
    profileId: string;
    collectorVersion: string;
    canonicalUrl: string;
    actionScope: BilibiliInteractionReconnaissanceInput['actionScope'];
    responseBodyMapping: BilibiliInteractionReconnaissanceInput['responseBodyMapping'];
    beforeAction: (actionId: string) => Promise<void>;
  }) {
    const canonicalUrl = canonicalBilibiliVideoUrl(input.canonicalUrl);
    if (!canonicalUrl) throw new Error('interaction_reconnaissance_url_invalid');
    if (!/^[0-9a-f-]{36}$/i.test(input.runId)) throw new Error('interaction_reconnaissance_run_invalid');
    this.#context = input.context;
    this.#runId = input.runId;
    this.#profileId = input.profileId;
    this.#collectorVersion = input.collectorVersion;
    this.#canonicalUrl = canonicalUrl;
    this.#actionScope = input.actionScope;
    this.#responseBodyMapping = input.responseBodyMapping;
    this.#beforeAction = input.beforeAction;
  }

  async run(): Promise<BilibiliInteractionReconnaissanceRecord> {
    const page = await this.#context.newPage();
    page.on('response', this.#onResponse);
    page.on('requestfailed', this.#onRequestFailed);
    let baselineCaptionVisible = false;
    let baselineCommentsPresent = false;
    let state: BilibiliInteractionReconnaissanceRecord['state'] = 'completed';
    let failureCode: string | null = null;
    const actions: InteractionActionObservation[] = [];
    try {
      this.#phase = 'navigation_baseline';
      try {
        await page.goto(this.#canonicalUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      } catch {
        throw new Error('interaction_risk_navigation_failed');
      }
      await delay(5_000);
      await this.#assertPageSafe(page);
      const player = page.locator('.bpx-player-container').first();
      if (await player.isVisible().catch(() => false)) await player.hover().catch(() => undefined);
      baselineCaptionVisible = Boolean(await firstVisible([
        page.locator('.bpx-player-ctrl-subtitle'),
        page.locator('[aria-label*="字幕"]'),
        page.locator('[title*="字幕"]'),
        page.getByText('字幕', { exact: true })
      ]));
      baselineCommentsPresent = await page.locator('#commentapp').count() > 0;

      if (this.#actionScope === 'subtitle' || this.#actionScope === 'all') {
        const openCaptionMenu = await this.#runAction(page, 'open_caption_menu', async () => {
          const control = await firstVisible([
            page.locator('.bpx-player-ctrl-subtitle'),
            page.locator('[aria-label*="字幕"]'),
            page.locator('[title*="字幕"]'),
            page.getByText('字幕', { exact: true })
          ]);
          if (!control) return { outcome: 'control_missing' as const, dom: { captionControlVisible: false } };
          await control.hover({ timeout: 10_000 });
          const menu = await waitForCaptionMenuReadiness(page);
          return {
            outcome: menu.ready ? 'completed' as const : 'postcondition_unmet' as const,
            dom: {
              captionControlVisible: true,
              captionMenuReady: menu.ready,
              visibleCaptionLabels: menu.labels
            }
          };
        });
        actions.push(openCaptionMenu);

        if (openCaptionMenu.outcome === 'completed') {
          actions.push(await this.#runAction(page, 'select_caption_language', async () => {
            const labels = await relevantVisibleLabels(page, /^(?:中文|汉语)(?:[（(].{1,30}[）)])?$/);
            const selectedLabel = labels
              .filter((label) => /^(?:中文|汉语)(?:[（(].{1,30}[）)])?$/.test(label))
              .sort((left, right) => left.length - right.length)[0] ?? null;
            if (!selectedLabel) {
              return { outcome: 'option_unavailable' as const, dom: { visibleCaptionLabels: labels } };
            }
            const verifiedOption = page.locator(
              '.bpx-player-ctrl-subtitle-language-item[data-lan="ai-zh"]'
            ).first();
            const option = await verifiedOption.isVisible().catch(() => false)
              ? verifiedOption
              : await firstVisible([
                  player.locator('.bpx-player-ctrl-subtitle-language-item').filter({ hasText: selectedLabel }),
                  page.locator('.bpx-player-ctrl-subtitle-language-item').filter({ hasText: selectedLabel })
                ]);
            if (!option) {
              return { outcome: 'option_unavailable' as const, dom: { selectedLabel, optionVisible: false } };
            }
            const selectedStateBeforeClick = await option.evaluate((element) => {
              const className = typeof element.className === 'string' ? element.className : '';
              return element.getAttribute('aria-selected') === 'true' ||
                element.getAttribute('aria-checked') === 'true' ||
                /(?:^|[-_\s])(?:active|selected|checked|current|on)(?:$|[-_\s])/i.test(className);
            }).catch(() => false);
            if (!selectedStateBeforeClick) {
              await option.click({ timeout: 10_000 });
              await delay(200);
            }
            const optionVisibleAfterClick = await option.isVisible().catch(() => false);
            const selectedState = await option.evaluate((element) => {
              const className = typeof element.className === 'string' ? element.className : '';
              return element.getAttribute('aria-selected') === 'true' ||
                element.getAttribute('aria-checked') === 'true' ||
                /(?:^|[-_\s])(?:active|selected|checked|current|on)(?:$|[-_\s])/i.test(className);
            }).catch(() => false);
            const visibleSubtitle = await page.locator('.bili-subtitle-x-subtitle-panel')
              .filter({ hasText: /\S/ })
              .isVisible()
              .catch(() => false);
            const selectionAcknowledged = selectedState || visibleSubtitle;
            return {
              outcome: selectionAcknowledged ? 'completed' as const : 'postcondition_unmet' as const,
              dom: {
                selectedLabel,
                optionVisibleBeforeClick: true,
                optionVisibleAfterClick,
                selectionAcknowledged,
                visibleSubtitle
              }
            };
          }));
        } else {
          actions.push({
            action: 'select_caption_language',
            attempted: false,
            outcome: 'prerequisite_unmet',
            errorCode: null,
            dom: { prerequisite: 'caption_menu_ready', captionMenuReady: false },
            network: []
          });
        }
      }

      if (this.#actionScope === 'discussion' || this.#actionScope === 'all') {
        await page.keyboard.press('Escape').catch(() => undefined);
        actions.push(await this.#runAction(page, 'scroll_to_comments', async () => {
          const comments = page.locator('#commentapp').first();
          if (!await comments.count()) {
            return { outcome: 'control_missing' as const, dom: { commentsHostPresent: false } };
          }
          await comments.scrollIntoViewIfNeeded({ timeout: 10_000 });
          await delay(700);
          const labels = await relevantVisibleLabels(
            page,
            /^(?:最热|最新|评论 \d+ 最热 最新|最热 最新|登录后查看.*|没有更多评论|共\d+条回复(?:，点击查看|，)?)$/
          );
          return {
            outcome: 'completed' as const,
            dom: { commentsHostPresent: true, visibleDiscussionLabels: labels }
          };
        }));

        actions.push(await this.#runAction(page, 'select_latest_comments', async () => {
          const latest = await firstVisible([
            page.getByRole('button', { name: '最新', exact: true }),
            page.getByText('最新', { exact: true })
          ]);
          if (!latest) return { outcome: 'control_missing' as const, dom: { latestControlVisible: false } };
          await latest.click({ timeout: 10_000 });
          await delay(700);
          const labels = await relevantVisibleLabels(
            page,
            /^(?:最热|最新|评论 \d+ 最热 最新|最热 最新|登录后查看.*|没有更多评论|共\d+条回复(?:，点击查看|，)?)$/
          );
          return {
            outcome: 'completed' as const,
            dom: { latestControlVisible: true, visibleDiscussionLabels: labels }
          };
        }));

        actions.push(await this.#runAction(page, 'expand_first_thread', async () => {
          const expand = await firstVisible([
            page.getByRole('button', { name: '点击查看', exact: true }),
            page.getByText('点击查看', { exact: true })
          ]);
          if (!expand) return { outcome: 'control_missing' as const, dom: { expandControlVisible: false } };
          await expand.click({ timeout: 10_000 });
          await delay(700);
          const labels = await relevantVisibleLabels(
            page,
            /^(?:共\d+条回复(?:，点击查看|，)?|共\d+页.*|查看更多.*|展开|收起|下一页|登录后查看.*|没有更多评论)$/
          );
          return {
            outcome: 'completed' as const,
            dom: { expandControlVisible: true, visibleThreadLabels: labels }
          };
        }));
      }
    } catch (error) {
      state = 'failed';
      failureCode = safeErrorCode(error);
      if (this.#terminalAction) actions.push(this.#terminalAction);
    } finally {
      this.#phase = 'idle';
      page.off('response', this.#onResponse);
      page.off('requestfailed', this.#onRequestFailed);
      await Promise.allSettled([...this.#pending]);
      await page.close().catch(() => undefined);
    }

    const objective = interactionObjectiveAssessment(this.#actionScope, actions);
    if (state !== 'failed' && objective.status !== 'satisfied') state = 'inconclusive';
    return {
      schemaVersion: 1,
      recordId: randomUUID(),
      runId: this.#runId,
      collectorVersion: this.#collectorVersion,
      profileId: this.#profileId,
      platform: 'bilibili',
      accountCategory: 'user_managed',
      pageRole: 'video_detail',
      targetUrlDigest: sha256(this.#canonicalUrl),
      actionScope: this.#actionScope,
      objective,
      state,
      errorCode: failureCode,
      startedAt: this.#startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      baseline: {
        captionControlVisible: baselineCaptionVisible,
        commentsHostPresent: baselineCommentsPresent,
        routeSummary: serialiseRoutes(this.#network.filter((observation) => observation.phase === 'navigation_baseline'))
      },
      actions,
      responseBodyMappings: this.#bodyMappings,
      counters: {
        networkObservations: this.#network.length,
        networkObservationsDroppedByLimit: this.#networkDropped,
        failedXhrFetchRequests: [...this.#failedRequestsByPhase.values()].reduce((sum, count) => sum + count, 0)
      },
      safeguards: {
        environment: 'local_user_controlled_collection_profile',
        browser: 'visible_playwright_chromium',
        observationMode: 'authenticated_bounded_interaction_network_metadata',
        productionResponseRoutes: 'unchanged_empty',
        requestHeaders: 'not_read',
        requestBody: 'not_read',
        responseHeaders: 'mime_and_content_length_only',
        responseBody: this.#responseBodyMapping === 'schema_only'
          ? 'schema_only_explicit_research_allowlist'
          : 'not_read',
        cookiesAndTokens: 'not_read',
        queryAndFragmentValues: 'discarded',
        actionTailMs: ACTION_TAIL_MS,
        maximumSemanticActions: 5,
        runDeadlineMs: MAX_RUN_MS,
        semanticActionDelivery: 'at_most_once',
        captchaAndRiskControl: 'stop_and_persist_lock',
        networkFailure: 'stop_without_action_retry',
        observedTargetPages: 'closed_after_reconnaissance',
        captionMenuReadyTimeoutMs: CAPTION_MENU_READY_TIMEOUT_MS,
        admissionEligible: false
      }
    };
  }

  async #runAction(
    page: Page,
    action: InteractionActionObservation['action'],
    operation: () => Promise<{
      outcome: InteractionActionObservation['outcome'];
      dom: Record<string, unknown>;
    }>
  ): Promise<InteractionActionObservation> {
    const startIndex = this.#network.length;
    this.#phase = action;
    try {
      await this.#assertPageSafe(page);
      if (this.#attemptedActionIds.has(action)) throw new Error('account_safety_action_already_attempted');
      this.#attemptedActionIds.add(action);
      await this.#beforeAction(action);
      await this.#assertPageSafe(page);
      const result = await operation();
      await delay(ACTION_TAIL_MS);
      await this.#assertPageSafe(page);
      return {
        action,
        attempted: interactionOutcomeWasAttempted(result.outcome),
        outcome: result.outcome,
        errorCode: null,
        dom: result.dom,
        network: serialiseRoutes(this.#network.slice(startIndex))
      };
    } catch (error) {
      const errorCode = safeErrorCode(error);
      this.#terminalAction = {
        action,
        attempted: true,
        outcome: 'failed',
        errorCode,
        dom: {},
        network: serialiseRoutes(this.#network.slice(startIndex))
      };
      throw new Error(errorCode);
    } finally {
      this.#phase = 'idle';
    }
  }

  async #assertPageSafe(page: Page): Promise<void> {
    if (Date.now() - this.#startedEpoch >= MAX_RUN_MS) {
      throw new Error('interaction_risk_run_deadline_exceeded');
    }
    if (this.#phase !== 'idle') {
      const failedRequests = this.#failedRequestsByPhase.get(this.#phase) ?? 0;
      if (failedRequests >= MAX_FAILED_XHR_FETCH_PER_PHASE) {
        throw new Error('interaction_risk_network_unstable');
      }
    }
    const signals = await page.evaluate(() => {
      const visible = (element: Element): boolean => {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
      };
      const riskTexts = Array.from(document.querySelectorAll(
        '[role="dialog"], [class*="geetest"], [class*="captcha"], [class*="verify"], [class*="risk"], [class*="error"]'
      )).filter(visible).map((element) =>
        (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)
      );
      const accountEntry = Array.from(document.querySelectorAll<HTMLAnchorElement>(
        'header a[href*="space.bilibili.com/"], .bili-header a[href*="space.bilibili.com/"], .mini-header a[href*="space.bilibili.com/"]'
      )).some((anchor) => visible(anchor) && /^https:\/\/space\.bilibili\.com\/\d+/.test(anchor.href));
      const loginEntry = Array.from(document.querySelectorAll(
        'header .header-login-entry, .bili-header .header-login-entry, .mini-header .header-login-entry, header a[href*="passport.bilibili.com/login"]'
      )).some(visible);
      return {
        online: navigator.onLine,
        verification: riskTexts.some((text) => /验证码|安全验证|完成验证|异常访问|风险验证|请进行验证/.test(text)),
        rateLimited: riskTexts.some((text) => /请求过于频繁|访问频繁|操作频繁|稍后再试|风控|限流/.test(text)),
        sourceUnavailable: riskTexts.some((text) => /网络错误|加载失败|服务不可用|系统繁忙|连接失败/.test(text)),
        authenticationLost: location.hostname === 'passport.bilibili.com' || (loginEntry && !accountEntry)
      };
    });
    if (!signals.online) throw new Error('interaction_risk_network_offline');
    if (signals.verification) throw new Error('interaction_risk_verification_required');
    if (signals.rateLimited) throw new Error('interaction_risk_rate_limited');
    if (signals.authenticationLost) throw new Error('interaction_risk_authentication_lost');
    if (signals.sourceUnavailable) throw new Error('interaction_risk_source_unavailable');
  }

  readonly #onResponse = (response: Response): void => {
    const pending = this.#observeResponse(response);
    this.#pending.add(pending);
    void pending.finally(() => this.#pending.delete(pending));
  };

  readonly #onRequestFailed = (request: Request): void => {
    if (this.#phase === 'idle') return;
    const resourceType = request.resourceType();
    if (resourceType !== 'xhr' && resourceType !== 'fetch') return;
    this.#failedRequestsByPhase.set(
      this.#phase,
      (this.#failedRequestsByPhase.get(this.#phase) ?? 0) + 1
    );
  };

  async #observeResponse(response: Response): Promise<void> {
    if (this.#phase === 'idle') return;
    const resourceType = response.request().resourceType();
    if (resourceType !== 'xhr' && resourceType !== 'fetch' && resourceType !== 'texttrack') return;
    let url: URL;
    try {
      url = new URL(response.url());
    } catch {
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (this.#network.length >= MAX_NETWORK_OBSERVATIONS) {
      this.#networkDropped += 1;
      return;
    }
    const contentType = await response.headerValue('content-type').catch(() => null);
    const contentLength = await response.headerValue('content-length').catch(() => null);
    const declaredBytes = contentLength && /^\d{1,15}$/.test(contentLength) ? Number(contentLength) : null;
    this.#network.push({
      phase: this.#phase,
      atMs: Math.max(0, Date.now() - this.#startedEpoch),
      resourceType,
      method: response.request().method().toUpperCase().slice(0, 12),
      ownership: ownership(url),
      origin: url.origin,
      pathname: url.pathname,
      queryKeyNames: queryKeyNames(url),
      httpStatus: response.status(),
      mimeType: safeMimeType(contentType),
      declaredResponseBodyBytes: Number.isSafeInteger(declaredBytes) && declaredBytes! >= 0 ? declaredBytes : null
    });
    if (this.#responseBodyMapping === 'schema_only' && responseBodyRouteAllowed(url)) {
      await this.#mapResponseBody(response, url, safeMimeType(contentType), declaredBytes);
    }
  }

  async #mapResponseBody(
    response: Response,
    url: URL,
    mimeType: string,
    declaredBytes: number | null
  ): Promise<void> {
    if (this.#phase === 'idle' || this.#bodyMappings.length >= 8) return;
    const routeKey = `${this.#phase}\n${url.origin}\n${url.pathname}`;
    if (this.#mappedRouteKeys.has(routeKey)) return;
    this.#mappedRouteKeys.add(routeKey);
    if (
      declaredBytes !== null &&
      (declaredBytes > MAX_MAPPED_RESPONSE_BYTES || this.#mappedResponseBytes + declaredBytes > MAX_TOTAL_MAPPED_RESPONSE_BYTES)
    ) {
      this.#bodyMappings.push({
        phase: this.#phase,
        origin: url.origin,
        pathname: url.pathname,
        httpStatus: response.status(),
        mimeType,
        bodyBytes: declaredBytes,
        bodySha256: null,
        contentKind: 'too_large',
        schemaPaths: [],
        sensitiveFieldPathsOmitted: 0
      });
      return;
    }
    const body = await response.body().catch(() => null);
    if (!body) {
      this.#bodyMappings.push({
        phase: this.#phase,
        origin: url.origin,
        pathname: url.pathname,
        httpStatus: response.status(),
        mimeType,
        bodyBytes: null,
        bodySha256: null,
        contentKind: 'unavailable',
        schemaPaths: [],
        sensitiveFieldPathsOmitted: 0
      });
      return;
    }
    if (body.length > MAX_MAPPED_RESPONSE_BYTES || this.#mappedResponseBytes + body.length > MAX_TOTAL_MAPPED_RESPONSE_BYTES) {
      this.#bodyMappings.push({
        phase: this.#phase,
        origin: url.origin,
        pathname: url.pathname,
        httpStatus: response.status(),
        mimeType,
        bodyBytes: body.length,
        bodySha256: null,
        contentKind: 'too_large',
        schemaPaths: [],
        sensitiveFieldPathsOmitted: 0
      });
      return;
    }
    this.#mappedResponseBytes += body.length;
    const bodySha256 = sha256Bytes(body);
    const text = body.toString('utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      const binary = text.includes('\u0000') || text.includes('\ufffd');
      this.#bodyMappings.push({
        phase: this.#phase,
        origin: url.origin,
        pathname: url.pathname,
        httpStatus: response.status(),
        mimeType,
        bodyBytes: body.length,
        bodySha256,
        contentKind: binary ? 'binary' : 'utf8_text',
        schemaPaths: [],
        sensitiveFieldPathsOmitted: 0
      });
      return;
    }
    const schema = responseSchema(parsed);
    this.#bodyMappings.push({
      phase: this.#phase,
      origin: url.origin,
      pathname: url.pathname,
      httpStatus: response.status(),
      mimeType,
      bodyBytes: body.length,
      bodySha256,
      contentKind: 'json',
      schemaPaths: schema.schemaPaths,
      sensitiveFieldPathsOmitted: schema.sensitiveFieldPathsOmitted
    });
  }
}
