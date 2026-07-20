import { createHash } from 'node:crypto';
import type { BrowserContext, Page } from 'playwright';
import {
  bilibiliArticleInventoryUrl,
  projectBilibiliArticleDetailDom,
  resolvedBilibiliArticleDetailInput,
  safeBilibiliArticleErrorCode,
  type BilibiliArticleDetailInput,
  type BilibiliArticleDetailRunRecord,
  type BilibiliArticleDetailTerminalReason
} from './bilibili-article-contract';
import { captureBilibiliArticleDetailDom, waitForBilibiliArticleDetailDom } from './bilibili-article-detail-dom';

export * from './bilibili-article-contract';

const RUN_DEADLINE_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 20_000;
const DOM_TIMEOUT_MS = 15_000;

interface RunnerOptions extends BilibiliArticleDetailInput {
  context: BrowserContext;
  runId: string;
  collectorVersion: string;
  onActionAttempt: (actionId: string) => Promise<void>;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function remainingRunTimeout(deadline: number, maximumMs: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('bilibili_article_detail_run_deadline_exceeded');
  return Math.max(1, Math.min(maximumMs, remaining));
}

function exactPage(context: BrowserContext, targetUrl: string): Page | null {
  return [...context.pages()].reverse().find((page) => !page.isClosed() && page.url() === targetUrl) ?? null;
}

function relatedInventoryPage(context: BrowserContext, inventoryUrl: string): Page | null {
  return [...context.pages()].reverse().find((page) => {
    if (page.isClosed()) return false;
    try {
      const expected = new URL(inventoryUrl);
      const actual = new URL(page.url());
      return expected.origin === actual.origin && expected.pathname === actual.pathname;
    } catch {
      return false;
    }
  }) ?? null;
}

function contextMatches(page: Page, targetUrl: string): boolean {
  try {
    const expected = new URL(targetUrl);
    const actual = new URL(page.url());
    return expected.origin === actual.origin && expected.pathname === actual.pathname;
  } catch {
    return false;
  }
}

function riskTerminal(risk: {
  verificationRequired: boolean;
  rateLimited: boolean;
  sourceUnavailable: boolean;
}): BilibiliArticleDetailTerminalReason | null {
  if (risk.verificationRequired) return 'verification_required';
  if (risk.rateLimited) return 'rate_limited';
  if (risk.sourceUnavailable) return 'source_unavailable';
  return null;
}

export class BilibiliArticleDetailRunner {
  readonly #options: RunnerOptions;

  constructor(options: RunnerOptions) {
    this.#options = { ...options, ...resolvedBilibiliArticleDetailInput(options) };
  }

  async run(): Promise<BilibiliArticleDetailRunRecord> {
    const startedAt = new Date();
    const deadline = Date.now() + RUN_DEADLINE_MS;
    const targetUrl = this.#options.canonicalOpusUrl;
    const inventoryUrl = bilibiliArticleInventoryUrl(this.#options.canonicalProfileUrl);
    let page = exactPage(this.#options.context, targetUrl);
    let targetTabSelection: BilibiliArticleDetailRunRecord['safeguards']['targetTabSelection'] =
      'reused_matching_managed_tab';
    if (!page) {
      page = relatedInventoryPage(this.#options.context, inventoryUrl);
      if (page) targetTabSelection = 'reused_related_article_inventory_tab';
      else {
        page = await this.#options.context.newPage();
        targetTabSelection = 'created_new_managed_tab';
      }
    }
    const action: BilibiliArticleDetailRunRecord['actions'][number] = {
      actionId: 'open_article_detail',
      intent: 'Open one canonical public opus article detail.',
      attempted: true,
      attemptCount: 1,
      outcome: 'failed',
      errorCode: null
    };
    let snapshot: BilibiliArticleDetailRunRecord['snapshot'] = null;
    let terminalReason: BilibiliArticleDetailTerminalReason = 'source_unavailable';
    let errorCode: string | null = null;
    try {
      await this.#options.onActionAttempt(action.actionId);
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: remainingRunTimeout(deadline, NAVIGATION_TIMEOUT_MS)
      });
      await waitForBilibiliArticleDetailDom(page, remainingRunTimeout(deadline, DOM_TIMEOUT_MS))
        .catch(() => undefined);
      if (Date.now() >= deadline) throw new Error('bilibili_article_detail_run_deadline_exceeded');
      const observation = await captureBilibiliArticleDetailDom(page);
      const stopped = riskTerminal(observation.risk);
      if (stopped) {
        terminalReason = stopped;
        errorCode = `bilibili_article_detail_${stopped}`;
        action.outcome = stopped === 'verification_required' || stopped === 'rate_limited'
          ? 'risk_stopped'
          : 'postcondition_unmet';
        action.errorCode = errorCode;
      } else if (!contextMatches(page, targetUrl)) {
        terminalReason = 'context_changed';
        errorCode = 'bilibili_article_detail_context_changed';
        action.outcome = 'postcondition_unmet';
        action.errorCode = errorCode;
      } else {
        snapshot = projectBilibiliArticleDetailDom(observation, this.#options, new Date().toISOString());
        if (!snapshot) {
          terminalReason = 'dom_projection_failed';
          errorCode = 'bilibili_article_detail_dom_projection_failed';
          action.outcome = 'postcondition_unmet';
          action.errorCode = errorCode;
        } else {
          terminalReason = 'article_captured';
          action.outcome = 'completed';
        }
      }
    } catch (error) {
      if (Date.now() >= deadline) {
        terminalReason = 'run_deadline_exceeded';
        errorCode = 'bilibili_article_detail_run_deadline_exceeded';
      } else {
        errorCode = safeBilibiliArticleErrorCode(error);
      }
      action.errorCode = errorCode;
    }
    const state: BilibiliArticleDetailRunRecord['state'] = snapshot && terminalReason === 'article_captured'
      ? 'completed'
      : snapshot
        ? 'partial'
        : 'failed';
    return {
      schemaVersion: 1,
      runId: this.#options.runId,
      collectorVersion: this.#options.collectorVersion,
      platform: 'bilibili',
      accountCategory: 'user_managed',
      pageRole: 'article_detail',
      targetUrlDigest: sha256(targetUrl),
      strategyCandidate: {
        strategyId: 'bilibili.article.detail.dom-raw.v1',
        version: '1.0.0',
        admissionEligible: false
      },
      state,
      errorCode,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      sourceInventory: {
        artifactId: this.#options.sourceInventoryArtifactId,
        manifestSha256: this.#options.sourceInventoryManifestSha256
      },
      snapshot,
      actions: [action],
      coverage: {
        titleCaptured: Boolean(snapshot?.title),
        authorCaptured: Boolean(snapshot?.stableAccountId && snapshot.displayName),
        publishedTimeCaptured: Boolean(snapshot?.publishedVisibleText),
        contentCharacters: snapshot?.content.visibleText.length ?? 0,
        contentBlocks: snapshot?.content.blocks.length ?? 0,
        mediaRefs: snapshot?.content.mediaRefs.length ?? 0,
        linkRefs: snapshot?.content.linkRefs.length ?? 0,
        publicMetricsCaptured: Boolean(snapshot && Object.values(snapshot.publicMetrics).every(Number.isSafeInteger)),
        terminalReason
      },
      safeguards: {
        environment: 'local_user_controlled_collection_profile',
        browser: 'visible_playwright_chromium',
        acquisition: 'trusted_navigation_plus_bounded_public_article_dom',
        responseBody: 'not_read',
        requestHeaders: 'not_read',
        requestBody: 'not_read',
        cookiesAndTokens: 'not_read',
        currentViewerIdentity: 'excluded',
        discussion: 'excluded_separate_capability',
        authorAccountBinding: 'verified_article_inventory_artifact',
        semanticActionDelivery: 'at_most_once',
        runDeadlineMs: RUN_DEADLINE_MS,
        targetTabSelection,
        targetPage: 'retained_after_run',
        admissionEligible: false
      }
    };
  }
}
