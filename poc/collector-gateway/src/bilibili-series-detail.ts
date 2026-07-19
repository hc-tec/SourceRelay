import { createHash } from 'node:crypto';
import type { BrowserContext, Page } from 'playwright';
import {
  canonicalBilibiliSeriesDetailUrl,
  projectBilibiliSeriesMetadataResponse,
  projectBilibiliSeriesPageResponse,
  safeBilibiliSeriesDetailErrorCode,
  stableAccountIdForSeries,
  type BilibiliSeriesAction,
  type BilibiliSeriesDetailInput,
  type BilibiliSeriesDetailRunRecord,
  type BilibiliSeriesPageResponseEvidence,
  type BilibiliSeriesTerminalReason
} from './bilibili-series-detail-contract';
import {
  captureBilibiliSeriesDetailDom,
  exactBilibiliSeriesPageButton,
  waitForBilibiliSeriesDomIdentity
} from './bilibili-series-detail-dom';
import {
  boundedBilibiliSeriesResponse,
  isBilibiliSeriesArchivesResponse,
  isBilibiliSeriesMetadataResponse,
  projectBilibiliSeriesPageWithDom,
  seriesMetadataEvidence,
  seriesPageEvidence
} from './bilibili-series-detail-response';

export * from './bilibili-series-detail-contract';

const RESPONSE_TIMEOUT_MS = 20_000;
const DOM_TIMEOUT_MS = 12_000;
const ACTION_TIMEOUT_MS = 10_000;
const RUN_DEADLINE_MS = 60_000;

interface RunnerOptions extends BilibiliSeriesDetailInput {
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
  if (remaining <= 0) throw new Error('bilibili_series_detail_run_deadline_exceeded');
  return Math.max(1, Math.min(maximumMs, remaining));
}

function matchingManagedTargetPage(context: BrowserContext, targetUrl: string): Page | null {
  const expected = new URL(targetUrl);
  return [...context.pages()].reverse().find((candidate) => {
    if (candidate.isClosed()) return false;
    try {
      const actual = new URL(candidate.url());
      return actual.origin === expected.origin && actual.pathname === expected.pathname &&
        actual.searchParams.get('type') === 'series';
    } catch {
      return false;
    }
  }) ?? null;
}

function contextMatches(page: Page, targetUrl: string): boolean {
  try {
    const expected = new URL(targetUrl);
    const actual = new URL(page.url());
    return actual.origin === expected.origin && actual.pathname === expected.pathname &&
      actual.searchParams.get('type') === 'series';
  } catch {
    return false;
  }
}

function terminalFromStatus(status: number): BilibiliSeriesTerminalReason {
  if (status === 412) return 'risk_controlled';
  if (status === 429) return 'rate_limited';
  return 'response_status_unavailable';
}

function domRiskTerminal(
  risk: { verificationRequired: boolean; rateLimited: boolean; sourceUnavailable: boolean }
): BilibiliSeriesTerminalReason | null {
  if (risk.verificationRequired) return 'verification_required';
  if (risk.rateLimited) return 'rate_limited';
  if (risk.sourceUnavailable) return 'source_unavailable';
  return null;
}

function expectedItemsOnPage(
  declaredTotal: number,
  pageSize: number,
  declaredPages: number,
  pageNumber: number
): number {
  if (declaredTotal === 0) return 0;
  return pageNumber < declaredPages
    ? pageSize
    : declaredTotal - pageSize * (declaredPages - 1);
}

export class BilibiliSeriesDetailRunner {
  readonly #options: RunnerOptions;

  constructor(options: RunnerOptions) {
    this.#options = options;
  }

  async run(): Promise<BilibiliSeriesDetailRunRecord> {
    const startedAt = new Date();
    const deadline = Date.now() + RUN_DEADLINE_MS;
    const accountId = stableAccountIdForSeries(this.#options.canonicalProfileUrl);
    const targetUrl = canonicalBilibiliSeriesDetailUrl(
      this.#options.canonicalProfileUrl,
      this.#options.stableSeriesId
    );
    const actions: BilibiliSeriesAction[] = [];
    const pages: BilibiliSeriesDetailRunRecord['pages'] = [];
    let metadata: BilibiliSeriesDetailRunRecord['metadata'] = null;
    let metadataResponseEvidence: BilibiliSeriesDetailRunRecord['metadataResponseEvidence'] = null;
    let failedPageResponseEvidence: BilibiliSeriesPageResponseEvidence | null = null;
    let page: Page | null = null;
    let targetTabSelection: BilibiliSeriesDetailRunRecord['safeguards']['targetTabSelection'] =
      'created_new_managed_tab';
    let terminalReason: BilibiliSeriesTerminalReason = 'source_unavailable';
    let errorCode: string | null = null;

    const recordAction = async (
      actionId: string,
      intent: string,
      expectedPageNumber: number
    ): Promise<BilibiliSeriesAction> => {
      await this.#options.onActionAttempt(actionId);
      const action: BilibiliSeriesAction = {
        actionId,
        intent,
        expectedPageNumber,
        attempted: true,
        attemptCount: 1,
        outcome: 'failed',
        errorCode: null,
        observedPageNumber: null
      };
      actions.push(action);
      return action;
    };

    try {
      page = matchingManagedTargetPage(this.#options.context, targetUrl);
      if (page) {
        targetTabSelection = 'reused_matching_managed_tab';
      } else {
        page = await this.#options.context.newPage();
      }
      const metadataPromise = page.waitForResponse(
        (response) => isBilibiliSeriesMetadataResponse(response, this.#options.stableSeriesId),
        { timeout: remainingRunTimeout(deadline, RESPONSE_TIMEOUT_MS) }
      );
      const firstPagePromise = page.waitForResponse(
        (response) => isBilibiliSeriesArchivesResponse(response, this.#options.stableSeriesId, 1),
        { timeout: remainingRunTimeout(deadline, RESPONSE_TIMEOUT_MS) }
      );
      const openAction = await recordAction(
        'open_series_detail',
        'Open the canonical series detail in platform-default order.',
        1
      );
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: remainingRunTimeout(deadline, RESPONSE_TIMEOUT_MS)
      });
      const [rawMetadataResponse, rawFirstPageResponse] = await Promise.all([
        metadataPromise,
        firstPagePromise
      ]);
      const failedStatus = [rawMetadataResponse, rawFirstPageResponse].find((response) =>
        response.status() < 200 || response.status() >= 300
      );
      if (failedStatus) {
        terminalReason = terminalFromStatus(failedStatus.status());
        errorCode = `bilibili_series_detail_response_status_${failedStatus.status()}`;
        openAction.outcome = 'risk_stopped';
        openAction.errorCode = errorCode;
      } else {
        const [boundedMetadata, boundedFirstPage] = await Promise.all([
          boundedBilibiliSeriesResponse(rawMetadataResponse),
          boundedBilibiliSeriesResponse(rawFirstPageResponse)
        ]);
        metadataResponseEvidence = seriesMetadataEvidence(boundedMetadata);
        metadata = projectBilibiliSeriesMetadataResponse(
          boundedMetadata.value,
          accountId,
          this.#options.stableSeriesId
        );
        if (!metadata) {
          terminalReason = 'metadata_projection_failed';
          errorCode = 'bilibili_series_detail_metadata_projection_failed';
          openAction.outcome = 'postcondition_unmet';
          openAction.errorCode = errorCode;
        } else {
          const firstPageCandidate = projectBilibiliSeriesPageResponse(
            boundedFirstPage.value,
            accountId,
            1
          );
          if (!firstPageCandidate) {
            failedPageResponseEvidence = seriesPageEvidence(boundedFirstPage, 1);
            terminalReason = 'page_projection_failed';
            errorCode = 'bilibili_series_detail_page_projection_failed';
            openAction.outcome = 'postcondition_unmet';
            openAction.errorCode = errorCode;
          } else {
            await waitForBilibiliSeriesDomIdentity(
              page,
              1,
              firstPageCandidate.items.map((item) => item.bvid),
              remainingRunTimeout(deadline, DOM_TIMEOUT_MS)
            ).catch(() => undefined);
            if (Date.now() >= deadline) throw new Error('bilibili_series_detail_run_deadline_exceeded');
            const dom = await captureBilibiliSeriesDetailDom(page);
            const riskTerminal = domRiskTerminal(dom.risk);
            if (riskTerminal) {
              terminalReason = riskTerminal;
              errorCode = `bilibili_series_detail_${riskTerminal}`;
              openAction.outcome = riskTerminal === 'verification_required' || riskTerminal === 'rate_limited'
                ? 'risk_stopped'
                : 'postcondition_unmet';
              openAction.errorCode = errorCode;
            } else {
              const firstPage = projectBilibiliSeriesPageWithDom(
                boundedFirstPage,
                accountId,
                1,
                dom,
                new Date().toISOString()
              );
              if (!firstPage) {
                failedPageResponseEvidence = seriesPageEvidence(boundedFirstPage, 1);
                terminalReason = 'page_projection_failed';
                errorCode = 'bilibili_series_detail_page_projection_failed';
                openAction.outcome = 'postcondition_unmet';
                openAction.errorCode = errorCode;
              } else {
                pages.push(firstPage);
                openAction.observedPageNumber = dom.activePageNumber;
                const declaredPages = Math.max(1, Math.ceil(metadata.declaredItemCount / firstPage.pageSize));
                const expectedFirstPageItems = expectedItemsOnPage(
                  metadata.declaredItemCount,
                  firstPage.pageSize,
                  declaredPages,
                  1
                );
                const activePageMatches = metadata.declaredItemCount === 0
                  ? dom.activePageNumber === null || dom.activePageNumber === 1
                  : dom.activePageNumber === 1;
                const metadataMatchesDom = dom.stableAccountId === accountId &&
                  dom.stableSeriesId === this.#options.stableSeriesId &&
                  dom.visibleTitle === metadata.title &&
                  dom.declaredItemCount === metadata.declaredItemCount &&
                  dom.sortLabels.includes('默认排序');
                if (
                  !metadataMatchesDom ||
                  !activePageMatches ||
                  firstPage.declaredTotal !== metadata.declaredItemCount ||
                  firstPage.items.length !== expectedFirstPageItems ||
                  !firstPage.domCrossCheck.exactIdentityMatch ||
                  firstPage.domCrossCheck.titleMatches !== firstPage.domCrossCheck.responseVideoIds
                ) {
                  terminalReason = 'dom_response_mismatch';
                  errorCode = 'bilibili_series_detail_dom_response_mismatch';
                  openAction.outcome = 'postcondition_unmet';
                  openAction.errorCode = errorCode;
                } else {
                  openAction.outcome = 'completed';
                }
              }
            }
          }
        }
      }

      if (pages.length > 0 && errorCode === null && metadata) {
        const declaredPages = Math.max(1, Math.ceil(metadata.declaredItemCount / pages[0].pageSize));
        const plannedPages = Math.min(this.#options.maxPages, declaredPages);
        for (let nextPage = 2; nextPage <= plannedPages; nextPage += 1) {
          if (Date.now() >= deadline) {
            terminalReason = 'run_deadline_exceeded';
            errorCode = 'bilibili_series_detail_run_deadline_exceeded';
            break;
          }
          if (!contextMatches(page, targetUrl)) {
            terminalReason = 'context_changed';
            errorCode = 'bilibili_series_detail_context_changed';
            break;
          }
          const locator = exactBilibiliSeriesPageButton(page, nextPage);
          if (await locator.count() !== 1 || !(await locator.isVisible().catch(() => false))) {
            terminalReason = 'pagination_control_missing';
            errorCode = 'bilibili_series_detail_pagination_control_missing';
            actions.push({
              actionId: `open_series_page_${nextPage}`,
              intent: `Open series detail page ${nextPage}.`,
              expectedPageNumber: nextPage,
              attempted: false,
              attemptCount: 0,
              outcome: 'prerequisite_unmet',
              errorCode,
              observedPageNumber: null
            });
            break;
          }
          const responsePromise = page.waitForResponse(
            (response) => isBilibiliSeriesArchivesResponse(
              response,
              this.#options.stableSeriesId,
              nextPage
            ),
            { timeout: remainingRunTimeout(deadline, RESPONSE_TIMEOUT_MS) }
          );
          const action = await recordAction(
            `open_series_page_${nextPage}`,
            `Open series detail page ${nextPage}.`,
            nextPage
          );
          await locator.click({ timeout: remainingRunTimeout(deadline, ACTION_TIMEOUT_MS) });
          const rawResponse = await responsePromise;
          if (rawResponse.status() < 200 || rawResponse.status() >= 300) {
            terminalReason = terminalFromStatus(rawResponse.status());
            errorCode = `bilibili_series_detail_response_status_${rawResponse.status()}`;
            action.outcome = 'risk_stopped';
            action.errorCode = errorCode;
            break;
          }
          const bounded = await boundedBilibiliSeriesResponse(rawResponse);
          const candidate = projectBilibiliSeriesPageResponse(bounded.value, accountId, nextPage);
          if (!candidate) {
            failedPageResponseEvidence = seriesPageEvidence(bounded, nextPage);
            terminalReason = 'page_projection_failed';
            errorCode = 'bilibili_series_detail_page_projection_failed';
            action.outcome = 'postcondition_unmet';
            action.errorCode = errorCode;
            break;
          }
          await waitForBilibiliSeriesDomIdentity(
            page,
            nextPage,
            candidate.items.map((item) => item.bvid),
            remainingRunTimeout(deadline, DOM_TIMEOUT_MS)
          ).catch(() => undefined);
          if (Date.now() >= deadline) throw new Error('bilibili_series_detail_run_deadline_exceeded');
          const dom = await captureBilibiliSeriesDetailDom(page);
          action.observedPageNumber = dom.activePageNumber;
          const riskTerminal = domRiskTerminal(dom.risk);
          if (riskTerminal) {
            terminalReason = riskTerminal;
            errorCode = `bilibili_series_detail_${riskTerminal}`;
            action.outcome = riskTerminal === 'verification_required' || riskTerminal === 'rate_limited'
              ? 'risk_stopped'
              : 'postcondition_unmet';
            action.errorCode = errorCode;
            break;
          }
          const projectedPage = projectBilibiliSeriesPageWithDom(
            bounded,
            accountId,
            nextPage,
            dom,
            new Date().toISOString()
          );
          if (!projectedPage) {
            failedPageResponseEvidence = seriesPageEvidence(bounded, nextPage);
            terminalReason = 'page_projection_failed';
            errorCode = 'bilibili_series_detail_page_projection_failed';
            action.outcome = 'postcondition_unmet';
            action.errorCode = errorCode;
            break;
          }
          pages.push(projectedPage);
          const declaredPages = Math.max(1, Math.ceil(metadata.declaredItemCount / pages[0].pageSize));
          const expectedPageItems = expectedItemsOnPage(
            metadata.declaredItemCount,
            pages[0].pageSize,
            declaredPages,
            nextPage
          );
          const priorIds = new Set(
            pages.slice(0, -1).flatMap((capturedPage) => capturedPage.items.map((item) => item.bvid))
          );
          const crossPageDuplicate = projectedPage.items.some((item) => priorIds.has(item.bvid));
          if (
            dom.activePageNumber !== nextPage ||
            projectedPage.pageSize !== pages[0].pageSize ||
            projectedPage.declaredTotal !== metadata.declaredItemCount ||
            projectedPage.items.length !== expectedPageItems ||
            crossPageDuplicate ||
            !projectedPage.domCrossCheck.exactIdentityMatch ||
            projectedPage.domCrossCheck.titleMatches !== projectedPage.domCrossCheck.responseVideoIds
          ) {
            terminalReason = 'dom_response_mismatch';
            errorCode = crossPageDuplicate
              ? 'bilibili_series_detail_cross_page_duplicate'
              : 'bilibili_series_detail_dom_response_mismatch';
            action.outcome = 'postcondition_unmet';
            action.errorCode = errorCode;
            break;
          }
          action.outcome = 'completed';
        }
        if (errorCode === null) {
          terminalReason = pages.length >= declaredPages ? 'declared_terminal_reached' : 'budget_exhausted';
        }
      }
      if (errorCode === null && !contextMatches(page, targetUrl)) {
        terminalReason = 'context_changed';
        errorCode = 'bilibili_series_detail_context_changed';
      }
    } catch (error) {
      if (Date.now() >= deadline) {
        terminalReason = 'run_deadline_exceeded';
        errorCode = 'bilibili_series_detail_run_deadline_exceeded';
      } else {
        errorCode = safeBilibiliSeriesDetailErrorCode(error);
      }
      const action = actions.at(-1);
      if (action && action.outcome === 'failed') action.errorCode = errorCode;
    }

    const allIds = pages.flatMap((capturedPage) => capturedPage.items.map((item) => item.bvid));
    const uniqueIds = new Set(allIds);
    const declaredTotal = metadata?.declaredItemCount ?? pages[0]?.declaredTotal ?? null;
    const declaredPages = declaredTotal !== null && pages[0]
      ? Math.max(1, Math.ceil(declaredTotal / pages[0].pageSize))
      : null;
    if (
      terminalReason === 'declared_terminal_reached' &&
      declaredTotal !== null &&
      (
        declaredPages === null ||
        pages.length !== declaredPages ||
        allIds.length !== declaredTotal ||
        uniqueIds.size !== declaredTotal
      )
    ) {
      terminalReason = 'dom_response_mismatch';
      errorCode = allIds.length !== uniqueIds.size
        ? 'bilibili_series_detail_cross_page_duplicate'
        : 'bilibili_series_detail_declared_total_mismatch';
    }
    const completeWithinDeclaredSeries = terminalReason === 'declared_terminal_reached' &&
      declaredTotal !== null &&
      declaredPages !== null &&
      pages.length === declaredPages &&
      allIds.length === declaredTotal &&
      uniqueIds.size === declaredTotal;
    const state: BilibiliSeriesDetailRunRecord['state'] = completeWithinDeclaredSeries
      ? 'completed'
      : pages.length > 0 || metadataResponseEvidence || failedPageResponseEvidence
        ? 'partial'
        : 'failed';
    return {
      schemaVersion: 1,
      runId: this.#options.runId,
      collectorVersion: this.#options.collectorVersion,
      platform: 'bilibili',
      accountCategory: 'user_managed',
      pageRole: 'series_detail',
      targetUrlDigest: sha256(targetUrl),
      strategyCandidate: {
        strategyId: 'bilibili.collection-series.series-detail.response.v1',
        version: '1.0.0',
        admissionEligible: false
      },
      state,
      errorCode,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      metadata,
      metadataResponseEvidence,
      failedPageResponseEvidence,
      pages,
      actions,
      coverage: {
        declaredTotal,
        declaredPages,
        plannedMaximumPages: this.#options.maxPages,
        capturedPages: pages.length,
        capturedItems: allIds.length,
        uniqueItems: uniqueIds.size,
        duplicateItems: allIds.length - uniqueIds.size,
        completeWithinDeclaredSeries,
        terminalReason
      },
      safeguards: {
        environment: 'local_user_controlled_collection_profile',
        browser: 'visible_playwright_chromium',
        acquisition: 'trusted_series_navigation_and_pagination_plus_dom_response_projection',
        requestHeaders: 'not_read',
        requestBody: 'not_read',
        cookiesAndTokens: 'not_read',
        networkQueryAndFragmentValues: 'discarded',
        canonicalPageQuery: 'stable_type_series_only',
        responseProjection: 'public_series_metadata_and_card_fields_allowlist',
        unknownResponseValues: 'not_persisted',
        sortRole: 'platform_default',
        semanticActionDelivery: 'at_most_once',
        runDeadlineMs: RUN_DEADLINE_MS,
        targetTabSelection,
        targetPage: 'retained_after_run',
        admissionEligible: false
      }
    };
  }
}
