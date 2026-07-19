import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserContext, Locator, Page, Request, Response } from 'playwright';

const MAX_NETWORK_OBSERVATIONS = 500;
const ACTION_TAIL_MS = 3_000;
const MAX_MAPPED_RESPONSE_BYTES = 512 * 1024;
const MAX_TOTAL_MAPPED_RESPONSE_BYTES = 1024 * 1024;
const MAX_SCHEMA_PATHS = 240;
const MAX_RUN_MS = 60_000;
const MAX_FAILED_XHR_FETCH_PER_PHASE = 3;
const CAPTION_MENU_READY_TIMEOUT_MS = 2_500;
const CAPTION_MENU_POLL_INTERVAL_MS = 100;

type InteractionPhase =
  | 'navigation_baseline'
  | 'open_caption_menu'
  | 'select_caption_language'
  | 'scroll_to_comments'
  | 'select_latest_comments'
  | 'expand_first_thread'
  | 'idle';

type NetworkOwnership = 'platform_api' | 'platform_cdn' | 'third_party_or_unknown';

interface InteractionNetworkObservation {
  phase: Exclude<InteractionPhase, 'idle'>;
  atMs: number;
  resourceType: 'xhr' | 'fetch' | 'texttrack';
  method: string;
  ownership: NetworkOwnership;
  origin: string;
  pathname: string;
  queryKeyNames: string[];
  httpStatus: number;
  mimeType: string;
  declaredResponseBodyBytes: number | null;
}

interface ResponseSchemaPath {
  path: string;
  type: 'null' | 'boolean' | 'number' | 'string' | 'object' | 'array';
  arrayLength?: number;
}

export interface InteractionResponseBodyMapping {
  phase: Exclude<InteractionPhase, 'idle'>;
  origin: string;
  pathname: string;
  httpStatus: number;
  mimeType: string;
  bodyBytes: number | null;
  bodySha256: string | null;
  contentKind: 'json' | 'utf8_text' | 'binary' | 'too_large' | 'unavailable';
  schemaPaths: ResponseSchemaPath[];
  sensitiveFieldPathsOmitted: number;
}

export interface InteractionRouteSummary {
  resourceType: InteractionNetworkObservation['resourceType'];
  method: string;
  ownership: NetworkOwnership;
  origin: string;
  pathname: string;
  queryKeyNames: string[];
  count: number;
  statusCodes: number[];
  mimeTypes: string[];
  minimumDeclaredResponseBodyBytes: number | null;
  maximumDeclaredResponseBodyBytes: number | null;
}

export type InteractionActionName =
  | 'open_caption_menu'
  | 'select_caption_language'
  | 'scroll_to_comments'
  | 'select_latest_comments'
  | 'expand_first_thread';

export type InteractionActionOutcome =
  | 'completed'
  | 'control_missing'
  | 'option_unavailable'
  | 'prerequisite_unmet'
  | 'postcondition_unmet'
  | 'failed';

export interface InteractionActionObservation {
  action: InteractionActionName;
  attempted: boolean;
  outcome: InteractionActionOutcome;
  errorCode: string | null;
  dom: Record<string, unknown>;
  network: InteractionRouteSummary[];
}

export interface BilibiliInteractionReconnaissanceRecord {
  schemaVersion: 1;
  recordId: string;
  runId: string;
  collectorVersion: string;
  profileId: string;
  platform: 'bilibili';
  accountCategory: 'user_managed';
  pageRole: 'video_detail';
  targetUrlDigest: string;
  actionScope: BilibiliInteractionReconnaissanceInput['actionScope'];
  objective: InteractionObjectiveAssessment;
  state: 'completed' | 'inconclusive' | 'failed';
  errorCode: string | null;
  startedAt: string;
  completedAt: string;
  baseline: {
    captionControlVisible: boolean;
    commentsHostPresent: boolean;
    routeSummary: InteractionRouteSummary[];
  };
  actions: InteractionActionObservation[];
  responseBodyMappings: InteractionResponseBodyMapping[];
  counters: {
    networkObservations: number;
    networkObservationsDroppedByLimit: number;
    failedXhrFetchRequests: number;
  };
  safeguards: {
    environment: 'local_user_controlled_collection_profile';
    browser: 'visible_playwright_chromium';
    observationMode: 'authenticated_bounded_interaction_network_metadata';
    productionResponseRoutes: 'unchanged_empty';
    requestHeaders: 'not_read';
    requestBody: 'not_read';
    responseHeaders: 'mime_and_content_length_only';
    responseBody: 'not_read' | 'schema_only_explicit_research_allowlist';
    cookiesAndTokens: 'not_read';
    queryAndFragmentValues: 'discarded';
    actionTailMs: 3_000;
    maximumSemanticActions: 5;
    runDeadlineMs: 60_000;
    semanticActionDelivery: 'at_most_once';
    captchaAndRiskControl: 'stop_and_persist_lock';
    networkFailure: 'stop_without_action_retry';
    observedTargetPages: 'closed_after_reconnaissance';
    captionMenuReadyTimeoutMs: 2_500;
    admissionEligible: false;
  };
}

export interface BilibiliInteractionReconnaissanceInput {
  canonicalUrl: string;
  actionScope: 'subtitle' | 'discussion' | 'all';
  responseBodyMapping: 'disabled' | 'schema_only';
}

const REQUIRED_ACTIONS_BY_SCOPE: Record<
  BilibiliInteractionReconnaissanceInput['actionScope'],
  readonly InteractionActionName[]
> = {
  subtitle: ['open_caption_menu', 'select_caption_language'],
  discussion: ['scroll_to_comments', 'select_latest_comments', 'expand_first_thread'],
  all: [
    'open_caption_menu',
    'select_caption_language',
    'scroll_to_comments',
    'select_latest_comments',
    'expand_first_thread'
  ]
};

export interface InteractionObjectiveAssessment {
  scope: BilibiliInteractionReconnaissanceInput['actionScope'];
  status: 'satisfied' | 'partial' | 'not_satisfied';
  requiredActions: InteractionActionName[];
  completedActions: InteractionActionName[];
}

export function captionMenuReadyFromLabels(labels: readonly string[]): boolean {
  return labels.some((label) =>
    /^(?:关闭|字幕设置|字幕大小(?: .*)?|字幕颜色(?: .*)?|(?:中文|汉语)(?:[（(].{1,30}[）)])?|(?:中文|汉语).*(?:自动生成|AI).*)$/.test(label)
  );
}

export function interactionOutcomeWasAttempted(outcome: InteractionActionOutcome): boolean {
  return outcome !== 'control_missing' && outcome !== 'option_unavailable' && outcome !== 'prerequisite_unmet';
}

export function interactionObjectiveAssessment(
  scope: BilibiliInteractionReconnaissanceInput['actionScope'],
  actions: readonly Pick<InteractionActionObservation, 'action' | 'outcome'>[]
): InteractionObjectiveAssessment {
  const requiredActions = [...REQUIRED_ACTIONS_BY_SCOPE[scope]];
  const completedActions = requiredActions.filter((required) =>
    actions.some((action) => action.action === required && action.outcome === 'completed')
  );
  return {
    scope,
    status: completedActions.length === requiredActions.length
      ? 'satisfied'
      : completedActions.length > 0
        ? 'partial'
        : 'not_satisfied',
    requiredActions,
    completedActions
  };
}

function canonicalBilibiliVideoUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const match = url.hostname === 'www.bilibili.com' && url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/);
    if (url.protocol !== 'https:' || !match || url.username || url.password || url.search || url.hash) return null;
    return `https://www.bilibili.com/video/${match[1]}`;
  } catch {
    return null;
  }
}

export function bilibiliInteractionReconnaissanceInput(value: unknown): BilibiliInteractionReconnaissanceInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('interaction_reconnaissance_input_invalid');
  }
  const candidate = value as Partial<BilibiliInteractionReconnaissanceInput>;
  if (Object.keys(candidate).some((key) =>
    key !== 'canonicalUrl' && key !== 'actionScope' && key !== 'responseBodyMapping'
  )) {
    throw new Error('interaction_reconnaissance_input_invalid');
  }
  const canonicalUrl = typeof candidate.canonicalUrl === 'string'
    ? canonicalBilibiliVideoUrl(candidate.canonicalUrl)
    : null;
  if (!canonicalUrl) throw new Error('interaction_reconnaissance_url_invalid');
  const actionScope = candidate.actionScope ?? 'all';
  if (actionScope !== 'subtitle' && actionScope !== 'discussion' && actionScope !== 'all') {
    throw new Error('interaction_reconnaissance_scope_invalid');
  }
  const responseBodyMapping = candidate.responseBodyMapping ?? 'disabled';
  if (responseBodyMapping !== 'disabled' && responseBodyMapping !== 'schema_only') {
    throw new Error('interaction_reconnaissance_response_mapping_invalid');
  }
  return { canonicalUrl, actionScope, responseBodyMapping };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Bytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeErrorCode(value: unknown): string {
  const code = value instanceof Error ? value.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'interaction_reconnaissance_action_failed';
}

function safeMimeType(value: string | null): string {
  const mime = (value ?? '').split(';', 1)[0].trim().toLowerCase();
  return mime && mime.length <= 120 && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime)
    ? mime
    : 'unknown';
}

function ownership(url: URL): NetworkOwnership {
  if (url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com')) return 'platform_api';
  if (url.hostname === 'hdslb.com' || url.hostname.endsWith('.hdslb.com')) return 'platform_cdn';
  return 'third_party_or_unknown';
}

function queryKeyNames(url: URL): string[] {
  return [...new Set([...url.searchParams.keys()]
    .filter((key) => key.length > 0 && key.length <= 100)
    .map((key) => key.replace(/[^a-zA-Z0-9_.\-\[\]]/g, '_')))].sort();
}

function serialiseRoutes(observations: readonly InteractionNetworkObservation[]): InteractionRouteSummary[] {
  const routes = new Map<string, InteractionRouteSummary>();
  for (const observation of observations) {
    const key = [observation.resourceType, observation.method, observation.origin, observation.pathname].join('\n');
    const existing = routes.get(key);
    if (!existing) {
      routes.set(key, {
        resourceType: observation.resourceType,
        method: observation.method,
        ownership: observation.ownership,
        origin: observation.origin,
        pathname: observation.pathname,
        queryKeyNames: [...observation.queryKeyNames],
        count: 1,
        statusCodes: [observation.httpStatus],
        mimeTypes: observation.mimeType === 'unknown' ? [] : [observation.mimeType],
        minimumDeclaredResponseBodyBytes: observation.declaredResponseBodyBytes,
        maximumDeclaredResponseBodyBytes: observation.declaredResponseBodyBytes
      });
      continue;
    }
    existing.count += 1;
    existing.queryKeyNames = [...new Set([...existing.queryKeyNames, ...observation.queryKeyNames])].sort();
    if (!existing.statusCodes.includes(observation.httpStatus)) existing.statusCodes.push(observation.httpStatus);
    if (observation.mimeType !== 'unknown' && !existing.mimeTypes.includes(observation.mimeType)) {
      existing.mimeTypes.push(observation.mimeType);
    }
    if (observation.declaredResponseBodyBytes !== null) {
      existing.minimumDeclaredResponseBodyBytes = existing.minimumDeclaredResponseBodyBytes === null
        ? observation.declaredResponseBodyBytes
        : Math.min(existing.minimumDeclaredResponseBodyBytes, observation.declaredResponseBodyBytes);
      existing.maximumDeclaredResponseBodyBytes = existing.maximumDeclaredResponseBodyBytes === null
        ? observation.declaredResponseBodyBytes
        : Math.max(existing.maximumDeclaredResponseBodyBytes, observation.declaredResponseBodyBytes);
    }
  }
  return [...routes.values()];
}

function responseBodyRouteAllowed(url: URL): boolean {
  if (url.hostname === 'api.bilibili.com') {
    return [
      '/x/player/wbi/v2',
      '/x/v2/subtitle/web/view',
      '/x/v2/reply/wbi/main',
      '/x/v2/reply/reply'
    ].includes(url.pathname);
  }
  return (url.hostname === 'hdslb.com' || url.hostname.endsWith('.hdslb.com')) &&
    /(?:^|[/_-])(?:ai_)?subtitle(?:[/_.-]|$)/i.test(url.pathname);
}

function responseSchema(value: unknown): {
  schemaPaths: ResponseSchemaPath[];
  sensitiveFieldPathsOmitted: number;
} {
  const schemaPaths: ResponseSchemaPath[] = [];
  let sensitiveFieldPathsOmitted = 0;
  const sensitiveName = /cookie|token|password|secret|csrf|sess|authorization|email|phone|mobile|credential/i;
  const visit = (candidate: unknown, path: string, depth: number): void => {
    if (schemaPaths.length >= MAX_SCHEMA_PATHS || depth > 8) return;
    if (candidate === null) {
      schemaPaths.push({ path, type: 'null' });
      return;
    }
    if (Array.isArray(candidate)) {
      schemaPaths.push({ path, type: 'array', arrayLength: candidate.length });
      if (candidate.length > 0) visit(candidate[0], `${path}[0]`, depth + 1);
      return;
    }
    const primitive = typeof candidate;
    if (primitive === 'boolean' || primitive === 'number' || primitive === 'string') {
      schemaPaths.push({ path, type: primitive });
      return;
    }
    if (primitive !== 'object') return;
    schemaPaths.push({ path, type: 'object' });
    for (const [key, child] of Object.entries(candidate as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right)
    )) {
      if (schemaPaths.length >= MAX_SCHEMA_PATHS) break;
      if (sensitiveName.test(key)) {
        sensitiveFieldPathsOmitted += 1;
        continue;
      }
      const safeKey = key.length <= 100 ? key.replace(/[^a-zA-Z0-9_.-]/g, '_') : 'oversized_field_name';
      visit(child, `${path}.${safeKey}`, depth + 1);
    }
  };
  visit(value, '$', 0);
  return { schemaPaths, sensitiveFieldPathsOmitted };
}

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
          if (await player.isVisible().catch(() => false)) await player.hover().catch(() => undefined);
          const control = await firstVisible([
            page.locator('.bpx-player-ctrl-subtitle'),
            page.locator('[aria-label*="字幕"]'),
            page.locator('[title*="字幕"]'),
            page.getByText('字幕', { exact: true })
          ]);
          if (!control) return { outcome: 'control_missing' as const, dom: { captionControlVisible: false } };
          await control.click({ timeout: 10_000 });
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
            const option = await firstVisible([
              player.getByText(selectedLabel, { exact: true }),
              page.getByText(selectedLabel, { exact: true })
            ]);
            if (!option) {
              return { outcome: 'option_unavailable' as const, dom: { selectedLabel, optionVisible: false } };
            }
            await option.click({ timeout: 10_000 });
            await delay(200);
            const optionVisibleAfterClick = await option.isVisible().catch(() => false);
            const selectedState = await option.evaluate((element) => {
              const className = typeof element.className === 'string' ? element.className : '';
              return element.getAttribute('aria-selected') === 'true' ||
                element.getAttribute('aria-checked') === 'true' ||
                /(?:^|[-_\s])(?:active|selected|checked|current|on)(?:$|[-_\s])/i.test(className);
            }).catch(() => false);
            const selectionAcknowledged = !optionVisibleAfterClick || selectedState;
            return {
              outcome: selectionAcknowledged ? 'completed' as const : 'postcondition_unmet' as const,
              dom: {
                selectedLabel,
                optionVisibleBeforeClick: true,
                optionVisibleAfterClick,
                selectionAcknowledged
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
