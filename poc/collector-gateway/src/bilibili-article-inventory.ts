import { createHash } from 'node:crypto';
import type { BrowserContext, Page, Response } from 'playwright';
import {
  bilibiliArticleInventoryUrl,
  projectBilibiliArticleFeedResponse,
  safeBilibiliArticleErrorCode,
  stableArticleAccountId,
  type BilibiliArticleInventoryAction,
  type BilibiliArticleInventoryInput,
  type BilibiliArticleInventoryItem,
  type BilibiliArticleInventoryRunRecord,
  type BilibiliArticleInventoryTerminalReason
} from './bilibili-article-contract';
import {
  captureBilibiliArticleInventoryDom,
  visibleArticleFacet,
  waitForBilibiliArticleInventoryDomIds
} from './bilibili-article-inventory-dom';
import {
  articleFeedResponseEvidence,
  boundedBilibiliArticleFeedResponse,
  isBilibiliArticleFeedResponse,
  projectBilibiliArticleFeedPageWithDom
} from './bilibili-article-inventory-response';

export * from './bilibili-article-contract';

const RESPONSE_TIMEOUT_MS = 20_000;
const DOM_TIMEOUT_MS = 12_000;
const ACTION_TIMEOUT_MS = 10_000;
const RUN_DEADLINE_MS = 60_000;

interface RunnerOptions extends BilibiliArticleInventoryInput {
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
  if (remaining <= 0) throw new Error('bilibili_article_inventory_run_deadline_exceeded');
  return Math.max(1, Math.min(maximumMs, remaining));
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

function matchingManagedTargetPage(context: BrowserContext, targetUrl: string): Page | null {
  return [...context.pages()].reverse().find((page) => !page.isClosed() && contextMatches(page, targetUrl)) ?? null;
}

function terminalFromStatus(status: number): BilibiliArticleInventoryTerminalReason {
  if (status === 412) return 'risk_controlled';
  if (status === 429) return 'rate_limited';
  return 'response_status_unavailable';
}

function riskTerminal(risk: {
  verificationRequired: boolean;
  rateLimited: boolean;
  sourceUnavailable: boolean;
}): BilibiliArticleInventoryTerminalReason | null {
  if (risk.verificationRequired) return 'verification_required';
  if (risk.rateLimited) return 'rate_limited';
  if (risk.sourceUnavailable) return 'source_unavailable';
  return null;
}

function isRiskStopTerminal(reason: BilibiliArticleInventoryTerminalReason): boolean {
  return reason === 'verification_required' || reason === 'rate_limited' || reason === 'risk_controlled';
}

export class BilibiliArticleInventoryRunner {
  readonly #options: RunnerOptions;

  constructor(options: RunnerOptions) {
    this.#options = options;
  }

  async run(): Promise<BilibiliArticleInventoryRunRecord> {
    const startedAt = new Date();
    const deadline = Date.now() + RUN_DEADLINE_MS;
    const accountId = stableArticleAccountId(this.#options.canonicalProfileUrl);
    const targetUrl = bilibiliArticleInventoryUrl(this.#options.canonicalProfileUrl);
    const actions: BilibiliArticleInventoryAction[] = [];
    const pages: BilibiliArticleInventoryRunRecord['pages'] = [];
    const acceptedItems: BilibiliArticleInventoryItem[] = [];
    let failedResponseEvidence: BilibiliArticleInventoryRunRecord['failedResponseEvidence'] = null;
    let terminalReason: BilibiliArticleInventoryTerminalReason = 'source_unavailable';
    let errorCode: string | null = null;
    let page: Page | null = null;
    let targetTabSelection: BilibiliArticleInventoryRunRecord['safeguards']['targetTabSelection'] =
      'created_new_managed_tab';

    const recordAction = async (
      actionId: string,
      intent: string,
      expectedPageNumber: number
    ): Promise<BilibiliArticleInventoryAction> => {
      await this.#options.onActionAttempt(actionId);
      const action: BilibiliArticleInventoryAction = {
        actionId,
        intent,
        expectedPageNumber,
        attempted: true,
        attemptCount: 1,
        outcome: 'failed',
        errorCode: null
      };
      actions.push(action);
      return action;
    };

    const projectPage = async (
      rawResponse: Response,
      pageNumber: number
    ): Promise<{ nextOffset: string; hasMore: boolean } | null> => {
      if (rawResponse.status() < 200 || rawResponse.status() >= 300) {
        terminalReason = terminalFromStatus(rawResponse.status());
        errorCode = `bilibili_article_inventory_response_status_${rawResponse.status()}`;
        return null;
      }
      const bounded = await boundedBilibiliArticleFeedResponse(rawResponse);
      const candidate = projectBilibiliArticleFeedResponse(bounded.value, pageNumber);
      if (!candidate) {
        failedResponseEvidence = articleFeedResponseEvidence(bounded, pageNumber);
        terminalReason = 'response_projection_failed';
        errorCode = 'bilibili_article_inventory_response_projection_failed';
        return null;
      }
      const expectedIds = [...acceptedItems, ...candidate.items].map((item) => item.stableOpusId);
      await waitForBilibiliArticleInventoryDomIds(
        page!,
        expectedIds,
        remainingRunTimeout(deadline, DOM_TIMEOUT_MS)
      ).catch(() => undefined);
      if (Date.now() >= deadline) throw new Error('bilibili_article_inventory_run_deadline_exceeded');
      const dom = await captureBilibiliArticleInventoryDom(page!);
      const stopped = riskTerminal(dom.risk);
      if (stopped) {
        terminalReason = stopped;
        errorCode = `bilibili_article_inventory_${stopped}`;
        return null;
      }
      const projected = projectBilibiliArticleFeedPageWithDom(
        bounded,
        pageNumber,
        acceptedItems,
        dom,
        new Date().toISOString()
      );
      if (!projected) {
        failedResponseEvidence = articleFeedResponseEvidence(bounded, pageNumber);
        terminalReason = 'response_projection_failed';
        errorCode = 'bilibili_article_inventory_response_projection_failed';
        return null;
      }
      pages.push(projected.projection);
      const pageIsValid = dom.stableAccountId === accountId &&
        dom.visibleFacetLabels.includes('专栏') &&
        projected.projection.domCrossCheck.exactCumulativeIdentityMatch &&
        projected.projection.domCrossCheck.pageTitleMatches === projected.candidate.items.length;
      if (!pageIsValid) {
        terminalReason = 'dom_response_mismatch';
        errorCode = 'bilibili_article_inventory_dom_response_mismatch';
        return null;
      }
      acceptedItems.push(...projected.candidate.items);
      return { nextOffset: projected.candidate.nextOffset, hasMore: projected.candidate.hasMore };
    };

    try {
      page = matchingManagedTargetPage(this.#options.context, targetUrl);
      if (page) targetTabSelection = 'reused_matching_managed_tab';
      else page = await this.#options.context.newPage();

      const baselineResponsePromise = page.waitForResponse(
        (response) => isBilibiliArticleFeedResponse(response, accountId, 1, '', 'all'),
        { timeout: remainingRunTimeout(deadline, RESPONSE_TIMEOUT_MS) }
      );
      const openAction = await recordAction(
        'open_article_inventory',
        'Open the canonical account opus inventory.',
        1
      );
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: remainingRunTimeout(deadline, RESPONSE_TIMEOUT_MS)
      });
      const baselineResponse = await baselineResponsePromise;
      if (baselineResponse.status() < 200 || baselineResponse.status() >= 300) {
        terminalReason = terminalFromStatus(baselineResponse.status());
        errorCode = `bilibili_article_inventory_baseline_status_${baselineResponse.status()}`;
        openAction.outcome = 'risk_stopped';
        openAction.errorCode = errorCode;
      } else {
        const boundedBaseline = await boundedBilibiliArticleFeedResponse(baselineResponse);
        const baselineCandidate = projectBilibiliArticleFeedResponse(boundedBaseline.value, 1);
        if (!baselineCandidate) {
          terminalReason = 'response_projection_failed';
          errorCode = 'bilibili_article_inventory_baseline_projection_failed';
          openAction.outcome = 'postcondition_unmet';
          openAction.errorCode = errorCode;
        } else {
          await waitForBilibiliArticleInventoryDomIds(
            page,
            baselineCandidate.items.map((item) => item.stableOpusId),
            remainingRunTimeout(deadline, DOM_TIMEOUT_MS)
          ).catch(() => undefined);
          const baselineDom = await captureBilibiliArticleInventoryDom(page);
          const baselineRisk = riskTerminal(baselineDom.risk);
          const expectedBaselineIds = new Set(baselineCandidate.items.map((item) => item.stableOpusId));
          const actualBaselineIds = new Set(baselineDom.stableOpusIds);
          if (baselineRisk) {
            terminalReason = baselineRisk;
            errorCode = `bilibili_article_inventory_${baselineRisk}`;
            openAction.outcome = isRiskStopTerminal(baselineRisk) ? 'risk_stopped' : 'postcondition_unmet';
            openAction.errorCode = errorCode;
          } else if (
            baselineDom.stableAccountId !== accountId ||
            expectedBaselineIds.size !== actualBaselineIds.size ||
            [...expectedBaselineIds].some((id) => !actualBaselineIds.has(id))
          ) {
            terminalReason = 'dom_response_mismatch';
            errorCode = 'bilibili_article_inventory_baseline_dom_response_mismatch';
            openAction.outcome = 'postcondition_unmet';
            openAction.errorCode = errorCode;
          }
        }
        const facet = errorCode === null ? await visibleArticleFacet(page) : null;
        if (!facet) {
          if (errorCode === null) {
            terminalReason = 'article_facet_missing';
            errorCode = 'bilibili_article_inventory_facet_missing';
          }
          openAction.outcome = 'postcondition_unmet';
          openAction.errorCode = errorCode;
          actions.push({
            actionId: 'select_article_facet',
            intent: 'Select the public article facet.',
            expectedPageNumber: 1,
            attempted: false,
            attemptCount: 0,
            outcome: 'prerequisite_unmet',
            errorCode
          });
        } else {
          openAction.outcome = 'completed';
          const firstResponsePromise = page.waitForResponse(
            (response) => isBilibiliArticleFeedResponse(response, accountId, 1, '', 'article'),
            { timeout: remainingRunTimeout(deadline, RESPONSE_TIMEOUT_MS) }
          );
          const facetAction = await recordAction(
            'select_article_facet',
            'Select the public article facet.',
            1
          );
          await facet.click({ timeout: remainingRunTimeout(deadline, ACTION_TIMEOUT_MS) });
          const firstResponse = await firstResponsePromise;
          let pageState = await projectPage(firstResponse, 1);
          if (!pageState) {
            facetAction.outcome = isRiskStopTerminal(terminalReason) ? 'risk_stopped' : 'postcondition_unmet';
            facetAction.errorCode = errorCode;
          } else {
            facetAction.outcome = 'completed';
            let currentPageNumber = 1;
            while (pageState.hasMore && currentPageNumber < this.#options.maxPages) {
              const nextPageNumber = currentPageNumber + 1;
              if (!contextMatches(page, targetUrl)) {
                terminalReason = 'context_changed';
                errorCode = 'bilibili_article_inventory_context_changed';
                break;
              }
              const expectedOffset = pageState.nextOffset;
              const responsePromise = page.waitForResponse(
                (response) => isBilibiliArticleFeedResponse(
                  response,
                  accountId,
                  nextPageNumber,
                  expectedOffset,
                  'article'
                ),
                { timeout: remainingRunTimeout(deadline, RESPONSE_TIMEOUT_MS) }
              );
              const action = await recordAction(
                `load_article_inventory_page_${nextPageNumber}`,
                `Load article inventory page ${nextPageNumber} by one trusted scroll-to-end action.`,
                nextPageNumber
              );
              const scrollDistance = await page.evaluate(() => Math.max(
                document.documentElement.scrollHeight,
                document.body?.scrollHeight ?? 0,
                innerHeight
              ));
              await page.mouse.wheel(0, scrollDistance);
              const nextResponse = await responsePromise;
              pageState = await projectPage(nextResponse, nextPageNumber);
              if (!pageState) {
                action.outcome = isRiskStopTerminal(terminalReason) ? 'risk_stopped' : 'postcondition_unmet';
                action.errorCode = errorCode;
                break;
              }
              action.outcome = 'completed';
              currentPageNumber = nextPageNumber;
            }
            if (errorCode === null && pageState) {
              terminalReason = pageState.hasMore ? 'budget_exhausted' : 'feed_terminal_reached';
            }
          }
        }
      }
      if (errorCode === null && !contextMatches(page, targetUrl)) {
        terminalReason = 'context_changed';
        errorCode = 'bilibili_article_inventory_context_changed';
      }
    } catch (error) {
      if (Date.now() >= deadline) {
        terminalReason = 'run_deadline_exceeded';
        errorCode = 'bilibili_article_inventory_run_deadline_exceeded';
      } else {
        errorCode = safeBilibiliArticleErrorCode(error);
      }
      const action = actions.at(-1);
      if (action && action.outcome === 'failed') action.errorCode = errorCode;
    }

    const allIds = pages.flatMap((capturedPage) => capturedPage.items.map((item) => item.stableOpusId));
    const uniqueIds = new Set(allIds);
    const completeWithinArticleFacet = terminalReason === 'feed_terminal_reached' &&
      allIds.length === uniqueIds.size;
    const state: BilibiliArticleInventoryRunRecord['state'] = completeWithinArticleFacet
      ? 'completed'
      : pages.length > 0 || failedResponseEvidence
        ? 'partial'
        : 'failed';
    return {
      schemaVersion: 1,
      runId: this.#options.runId,
      collectorVersion: this.#options.collectorVersion,
      platform: 'bilibili',
      accountCategory: 'user_managed',
      pageRole: 'article_inventory',
      targetUrlDigest: sha256(targetUrl),
      strategyCandidate: {
        strategyId: 'bilibili.article.inventory.opus-feed.v1',
        version: '1.0.0',
        admissionEligible: false
      },
      state,
      errorCode,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      stableAccountId: accountId,
      failedResponseEvidence,
      pages,
      actions,
      coverage: {
        plannedMaximumPages: this.#options.maxPages,
        capturedPages: pages.length,
        capturedItems: allIds.length,
        uniqueItems: uniqueIds.size,
        duplicateItems: allIds.length - uniqueIds.size,
        completeWithinArticleFacet,
        terminalReason
      },
      safeguards: {
        environment: 'local_user_controlled_collection_profile',
        browser: 'visible_playwright_chromium',
        acquisition: 'trusted_navigation_facet_selection_and_scroll_plus_dom_response_projection',
        requestHeaders: 'not_read',
        requestBody: 'not_read',
        cookiesAndTokens: 'not_read',
        networkQueryAndFragmentValues: 'discarded',
        cursorValue: 'used_in_memory_not_persisted',
        responseProjection: 'public_article_inventory_fields_allowlist',
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
