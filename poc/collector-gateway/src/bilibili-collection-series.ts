import { createHash } from 'node:crypto';
import type { BrowserContext, Page, Response } from 'playwright';
import {
  BILIBILI_COLLECTION_SERIES_OVERVIEW_PATH,
  BILIBILI_COLLECTION_SERIES_RESPONSE_LIMIT,
  collectionSeriesOverviewUrl,
  crossCheckBilibiliCollectionSeriesOverview,
  diagnoseBilibiliCollectionSeriesOverviewResponse,
  projectBilibiliCollectionSeriesOverviewResponse,
  safeBilibiliCollectionSeriesErrorCode,
  type BilibiliCollectionSeriesAction,
  type BilibiliCollectionSeriesInput,
  type BilibiliCollectionSeriesResponseEvidence,
  type BilibiliCollectionSeriesRunRecord,
  type BilibiliCollectionSeriesTerminalReason
} from './bilibili-collection-series-contract';
import { captureBilibiliCollectionSeriesOverviewDom } from './bilibili-collection-series-dom';
import { responseSchema } from './interaction-response-projector';
import { stableAccountIdFromProfileUrl } from './bilibili-account-archive-contract';

export * from './bilibili-collection-series-contract';

const RESPONSE_TIMEOUT_MS = 20_000;
const DOM_TIMEOUT_MS = 12_000;
const RUN_DEADLINE_MS = 60_000;

interface RunnerOptions extends BilibiliCollectionSeriesInput {
  context: BrowserContext;
  runId: string;
  collectorVersion: string;
  onActionAttempt: (actionId: string) => Promise<void>;
}

interface BoundedOverviewResponse {
  value: unknown;
  evidence: BilibiliCollectionSeriesResponseEvidence;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function remainingRunTimeout(deadline: number, maximumMs: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('bilibili_collection_series_run_deadline_exceeded');
  return Math.max(1, Math.min(maximumMs, remaining));
}

function matchingManagedTargetPage(context: BrowserContext, targetUrl: string): Page | null {
  const expected = new URL(targetUrl);
  return [...context.pages()].reverse().find((candidate) => {
    if (candidate.isClosed()) return false;
    try {
      const actual = new URL(candidate.url());
      return actual.origin === expected.origin && actual.pathname === expected.pathname;
    } catch {
      return false;
    }
  }) ?? null;
}

function safeQueryKeyNames(url: URL): string[] {
  return [...new Set([...url.searchParams.keys()]
    .filter((key) => key.length > 0 && key.length <= 100)
    .map((key) => key.replace(/[^a-zA-Z0-9_.\-\[\]]/g, '_')))].sort();
}

function isOverviewResponse(response: Response, expectedAccountId: string): boolean {
  try {
    const url = new URL(response.url());
    return response.request().method() === 'GET' &&
      url.origin === 'https://api.bilibili.com' &&
      url.pathname === BILIBILI_COLLECTION_SERIES_OVERVIEW_PATH &&
      url.searchParams.get('mid') === expectedAccountId;
  } catch {
    return false;
  }
}

async function boundedOverviewResponse(response: Response): Promise<BoundedOverviewResponse> {
  const url = new URL(response.url());
  const body = await response.body();
  if (body.byteLength > BILIBILI_COLLECTION_SERIES_RESPONSE_LIMIT) {
    throw new Error('bilibili_collection_series_response_too_large');
  }
  let value: unknown;
  try {
    value = JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    throw new Error('bilibili_collection_series_response_invalid_json');
  }
  const schema = responseSchema(value);
  return {
    value,
    evidence: {
      pathname: BILIBILI_COLLECTION_SERIES_OVERVIEW_PATH,
      responseStatus: response.status(),
      responseBodyBytes: body.byteLength,
      responseBodySha256: sha256(body),
      queryKeyNames: safeQueryKeyNames(url),
      schemaPaths: schema.schemaPaths,
      sensitiveFieldPathsOmitted: schema.sensitiveFieldPathsOmitted,
      projectionFailureCode: null
    }
  };
}

export class BilibiliCollectionSeriesOverviewRunner {
  readonly #options: RunnerOptions;

  constructor(options: RunnerOptions) {
    this.#options = options;
  }

  async run(): Promise<BilibiliCollectionSeriesRunRecord> {
    const startedAt = new Date();
    const deadline = Date.now() + RUN_DEADLINE_MS;
    const accountId = stableAccountIdFromProfileUrl(this.#options.canonicalProfileUrl);
    const targetUrl = collectionSeriesOverviewUrl(this.#options.canonicalProfileUrl);
    const actions: BilibiliCollectionSeriesAction[] = [];
    let page: Page | null = null;
    let targetTabSelection: BilibiliCollectionSeriesRunRecord['safeguards']['targetTabSelection'] =
      'created_new_managed_tab';
    let overview: BilibiliCollectionSeriesRunRecord['overview'] = null;
    let responseEvidence: BilibiliCollectionSeriesResponseEvidence | null = null;
    let terminalReason: BilibiliCollectionSeriesTerminalReason = 'source_unavailable';
    let errorCode: string | null = null;

    try {
      page = matchingManagedTargetPage(this.#options.context, targetUrl);
      if (page) {
        targetTabSelection = 'reused_matching_managed_tab';
      } else {
        page = await this.#options.context.newPage();
      }
      const responsePromise = page.waitForResponse(
        (response) => isOverviewResponse(response, accountId),
        { timeout: remainingRunTimeout(deadline, RESPONSE_TIMEOUT_MS) }
      );
      await this.#options.onActionAttempt('open_collection_series_overview');
      const action: BilibiliCollectionSeriesAction = {
        actionId: 'open_collection_series_overview',
        intent: 'Open the canonical public collection and series overview.',
        attempted: true,
        attemptCount: 1,
        outcome: 'failed',
        errorCode: null
      };
      actions.push(action);
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: remainingRunTimeout(deadline, RESPONSE_TIMEOUT_MS)
      });
      const response = await responsePromise;
      if (response.status() < 200 || response.status() >= 300) {
        terminalReason = response.status() === 412 ? 'risk_controlled' :
          response.status() === 429 ? 'rate_limited' : 'response_status_unavailable';
        errorCode = `bilibili_collection_series_response_status_${response.status()}`;
        action.outcome = 'risk_stopped';
        action.errorCode = errorCode;
      } else {
        const bounded = await boundedOverviewResponse(response);
        responseEvidence = bounded.evidence;
        const responseProjection = projectBilibiliCollectionSeriesOverviewResponse(
          bounded.value,
          accountId
        );
        responseEvidence.projectionFailureCode = responseProjection
          ? null
          : diagnoseBilibiliCollectionSeriesOverviewResponse(bounded.value, accountId);
        await page.waitForFunction(() => {
          const text = document.body?.innerText ?? '';
          const hasItems = Array.from(document.querySelectorAll<HTMLElement>('*')).some((element) =>
            element.children.length === 0 && /^(?:系列|合集)\s*[·・]\s*\S+/.test(
              (element.textContent ?? '').replace(/\s+/g, ' ').trim()
            ) && element.getClientRects().length > 0
          );
          const stopped = /验证码|安全验证|异常访问|访问频繁|操作频繁|页面不存在|加载失败/.test(text);
          return hasItems || stopped;
        }, undefined, { timeout: remainingRunTimeout(deadline, DOM_TIMEOUT_MS) }).catch(() => undefined);
        if (Date.now() >= deadline) throw new Error('bilibili_collection_series_run_deadline_exceeded');
        const dom = await captureBilibiliCollectionSeriesOverviewDom(page);
        if (dom.risk.verificationRequired) {
          terminalReason = 'verification_required';
          errorCode = 'bilibili_collection_series_verification_required';
          action.outcome = 'risk_stopped';
          action.errorCode = errorCode;
        } else if (dom.risk.rateLimited) {
          terminalReason = 'rate_limited';
          errorCode = 'bilibili_collection_series_rate_limited';
          action.outcome = 'risk_stopped';
          action.errorCode = errorCode;
        } else if (dom.risk.sourceUnavailable) {
          terminalReason = 'source_unavailable';
          errorCode = 'bilibili_collection_series_source_unavailable';
          action.outcome = 'postcondition_unmet';
          action.errorCode = errorCode;
        } else if (!responseProjection) {
          terminalReason = 'response_projection_failed';
          errorCode = 'bilibili_collection_series_response_projection_failed';
          action.outcome = 'postcondition_unmet';
          action.errorCode = errorCode;
        } else {
          overview = crossCheckBilibiliCollectionSeriesOverview(
            responseProjection,
            dom,
            this.#options.canonicalProfileUrl,
            new Date().toISOString()
          );
          if (!overview || !overview.domCrossCheck.exactItemIdentityMatch) {
            terminalReason = 'dom_response_mismatch';
            errorCode = 'bilibili_collection_series_dom_response_mismatch';
            action.outcome = 'postcondition_unmet';
            action.errorCode = errorCode;
          } else {
            terminalReason = 'overview_captured';
            action.outcome = 'completed';
          }
        }
      }
      const actual = new URL(page.url());
      const expected = new URL(targetUrl);
      if (actual.origin !== expected.origin || actual.pathname !== expected.pathname) {
        overview = null;
        terminalReason = 'context_changed';
        errorCode = 'bilibili_collection_series_context_changed';
        actions[0].outcome = 'postcondition_unmet';
        actions[0].errorCode = errorCode;
      }
    } catch (error) {
      if (Date.now() >= deadline) {
        terminalReason = 'run_deadline_exceeded';
        errorCode = 'bilibili_collection_series_run_deadline_exceeded';
      } else {
        errorCode = safeBilibiliCollectionSeriesErrorCode(error);
      }
      const action = actions[0];
      if (action && action.outcome === 'failed') action.errorCode = errorCode;
    }

    const state: BilibiliCollectionSeriesRunRecord['state'] = overview?.domCrossCheck.exactItemIdentityMatch
      ? 'completed'
      : actions.length > 0 || responseEvidence
        ? 'partial'
        : 'failed';
    return {
      schemaVersion: 1,
      runId: this.#options.runId,
      collectorVersion: this.#options.collectorVersion,
      platform: 'bilibili',
      accountCategory: 'user_managed',
      pageRole: 'collection_series_overview',
      targetUrlDigest: sha256(targetUrl),
      strategyCandidate: {
        strategyId: 'bilibili.collection-series.overview.response.v1',
        version: '1.0.0',
        admissionEligible: false
      },
      state,
      errorCode,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      overview,
      responseEvidence,
      actions,
      coverage: {
        declaredListCount: overview?.declaredListCount ?? null,
        capturedLists: overview?.items.length ?? 0,
        seriesCount: overview?.items.filter((item) => item.listType === 'series').length ?? 0,
        seasonCount: overview?.items.filter((item) => item.listType === 'season').length ?? 0,
        previewItems: overview?.items.reduce((total, item) => total + item.previews.length, 0) ?? 0,
        exactDomResponseMatch: overview?.domCrossCheck.exactItemIdentityMatch ?? false,
        terminalReason
      },
      safeguards: {
        environment: 'local_user_controlled_collection_profile',
        browser: 'visible_playwright_chromium',
        acquisition: 'trusted_navigation_plus_visible_dom_plus_current_overview_response_projection',
        requestHeaders: 'not_read',
        requestBody: 'not_read',
        cookiesAndTokens: 'not_read',
        networkQueryAndFragmentValues: 'discarded',
        responseProjection: 'public_collection_series_fields_allowlist',
        unknownResponseValues: 'not_persisted',
        semanticActionDelivery: 'at_most_once',
        runDeadlineMs: RUN_DEADLINE_MS,
        targetTabSelection,
        targetPage: 'retained_after_run',
        admissionEligible: false
      }
    };
  }
}
