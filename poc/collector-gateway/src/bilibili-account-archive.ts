import { createHash } from 'node:crypto';
import type { BrowserContext, Page } from 'playwright';
import {
  accountUploadVideoUrl,
  projectBilibiliAccountInfoResponse,
  projectBilibiliArchivePageResponse,
  safeBilibiliAccountArchiveErrorCode,
  stableAccountIdFromProfileUrl,
  type BilibiliAccountArchiveAction,
  type BilibiliAccountArchiveInput,
  type BilibiliAccountArchivePageProjection,
  type BilibiliAccountArchiveRunRecord,
  type BilibiliAccountArchiveTerminalReason,
  type BilibiliAccountProfileProjection
} from './bilibili-account-archive-contract';
import {
  accountProfileCrossCheck,
  captureInventoryDom,
  exactPageButton,
  terminalReasonFromDom,
  waitForInventoryDomIdentity
} from './bilibili-account-archive-dom';
import {
  boundedJsonResponse,
  isAccountInfoResponse,
  isArchiveResponse,
  pageProjection,
  terminalReasonFromHttpStatus
} from './bilibili-account-archive-response';

export * from './bilibili-account-archive-contract';

const RESPONSE_TIMEOUT_MS = 20_000;
const DOM_TIMEOUT_MS = 12_000;
const ACTION_TIMEOUT_MS = 10_000;
const RUN_DEADLINE_MS = 60_000;

interface RunnerOptions extends BilibiliAccountArchiveInput {
  context: BrowserContext;
  runId: string;
  collectorVersion: string;
  onActionAttempt: (actionId: string) => Promise<void>;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function remainingRunTimeout(deadline: number, maximumMs: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('bilibili_account_archive_run_deadline_exceeded');
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

export class BilibiliAccountArchiveRunner {
  readonly #options: RunnerOptions;

  constructor(options: RunnerOptions) {
    this.#options = options;
  }

  async run(): Promise<BilibiliAccountArchiveRunRecord> {
    const startedAt = new Date();
    const deadline = Date.now() + RUN_DEADLINE_MS;
    const accountId = stableAccountIdFromProfileUrl(this.#options.canonicalProfileUrl);
    const targetUrl = accountUploadVideoUrl(this.#options.canonicalProfileUrl);
    const actions: BilibiliAccountArchiveAction[] = [];
    const pages: BilibiliAccountArchivePageProjection[] = [];
    let account: BilibiliAccountProfileProjection | null = null;
    let terminalReason: BilibiliAccountArchiveTerminalReason = 'source_unavailable';
    let errorCode: string | null = null;
    let page: Page | null = null;
    let targetTabSelection: BilibiliAccountArchiveRunRecord['safeguards']['targetTabSelection'] =
      'created_new_managed_tab';

    const recordAction = async (
      actionId: string,
      intent: string,
      expectedPageNumber: number
    ): Promise<BilibiliAccountArchiveAction> => {
      await this.#options.onActionAttempt(actionId);
      const action: BilibiliAccountArchiveAction = {
        actionId,
        intent,
        attempted: true,
        attemptCount: 1,
        outcome: 'failed',
        errorCode: null,
        expectedPageNumber,
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
      const initialArchiveResponse = page.waitForResponse(
        (response) => isArchiveResponse(response, accountId, 1),
        { timeout: remainingRunTimeout(deadline, RESPONSE_TIMEOUT_MS) }
      );
      const accountInfoResponse = page.waitForResponse(
        (response) => isAccountInfoResponse(response, accountId),
        { timeout: remainingRunTimeout(deadline, RESPONSE_TIMEOUT_MS) }
      ).catch(() => null);
      const openAction = await recordAction(
        'open_account_inventory',
        'Open the canonical account video inventory.',
        1
      );
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: remainingRunTimeout(deadline, RESPONSE_TIMEOUT_MS)
      });
      const initialResponse = await initialArchiveResponse;
      if (initialResponse.status() < 200 || initialResponse.status() >= 300) {
        const dom = await captureInventoryDom(page);
        terminalReason = terminalReasonFromDom(dom) ?? terminalReasonFromHttpStatus(initialResponse.status());
        openAction.outcome = 'risk_stopped';
        openAction.errorCode = `bilibili_account_archive_response_status_${initialResponse.status()}`;
        errorCode = openAction.errorCode;
      } else {
        const response = await boundedJsonResponse(initialResponse);
        const responseCandidate = projectBilibiliArchivePageResponse(response.value, accountId, 1);
        if (!responseCandidate) {
          terminalReason = 'response_projection_failed';
          openAction.outcome = 'postcondition_unmet';
          openAction.errorCode = 'bilibili_account_archive_response_projection_failed';
          errorCode = openAction.errorCode;
        } else {
          await waitForInventoryDomIdentity(
            page,
            1,
            responseCandidate.items.map((item) => item.bvid),
            remainingRunTimeout(deadline, DOM_TIMEOUT_MS)
          ).catch(() => undefined);
          if (Date.now() >= deadline) {
            throw new Error('bilibili_account_archive_run_deadline_exceeded');
          }
          const dom = await captureInventoryDom(page);
          const domTerminal = terminalReasonFromDom(dom);
          if (domTerminal) {
            terminalReason = domTerminal;
            openAction.outcome = 'risk_stopped';
            openAction.errorCode = `bilibili_account_archive_${domTerminal}`;
            errorCode = openAction.errorCode;
          } else {
            const firstPage = pageProjection(response, accountId, 1, dom, new Date().toISOString());
            if (!firstPage) {
              terminalReason = 'response_projection_failed';
              openAction.outcome = 'postcondition_unmet';
              openAction.errorCode = 'bilibili_account_archive_response_projection_failed';
              errorCode = openAction.errorCode;
            } else {
              pages.push(firstPage);
              openAction.observedPageNumber = dom.activePageNumber;
              if (
                dom.activePageNumber !== 1 ||
                !firstPage.domCrossCheck.exactIdentityMatch ||
                firstPage.domCrossCheck.titleMatches !== firstPage.domCrossCheck.responseVideoIds
              ) {
                terminalReason = 'dom_response_mismatch';
                openAction.outcome = 'postcondition_unmet';
                openAction.errorCode = 'bilibili_account_archive_dom_response_mismatch';
                errorCode = openAction.errorCode;
              } else {
                openAction.outcome = 'completed';
              }

              const infoResponse = await accountInfoResponse;
              if (infoResponse?.status() === 200) {
                const info = projectBilibiliAccountInfoResponse(
                  (await boundedJsonResponse(infoResponse)).value,
                  accountId
                );
                if (info) {
                  const base = {
                    ...info,
                    canonicalProfileUrl: this.#options.canonicalProfileUrl
                  };
                  account = {
                    ...base,
                    publicFields: dom.publicFields,
                    domCrossCheck: await accountProfileCrossCheck(page, base)
                  };
                }
              }
            }
          }
        }
      }

      if (pages.length > 0 && errorCode === null) {
        const declaredTotal = pages[0].declaredTotal;
        const declaredPages = Math.max(1, Math.ceil(declaredTotal / pages[0].pageSize));
        const plannedPages = Math.min(this.#options.maxPages, declaredPages);
        for (let nextPage = 2; nextPage <= plannedPages; nextPage += 1) {
          if (Date.now() >= deadline) {
            terminalReason = 'run_deadline_exceeded';
            errorCode = 'bilibili_account_archive_run_deadline_exceeded';
            break;
          }
          const locator = exactPageButton(page, nextPage);
          if (await locator.count() !== 1 || !(await locator.isVisible().catch(() => false))) {
            terminalReason = 'pagination_control_missing';
            errorCode = 'bilibili_account_archive_pagination_control_missing';
            actions.push({
              actionId: `open_inventory_page_${nextPage}`,
              intent: `Open account inventory page ${nextPage}.`,
              attempted: false,
              attemptCount: 0,
              outcome: 'prerequisite_unmet',
              errorCode,
              expectedPageNumber: nextPage,
              observedPageNumber: null
            });
            break;
          }
          const responsePromise = page.waitForResponse(
            (response) => isArchiveResponse(response, accountId, nextPage),
            { timeout: remainingRunTimeout(deadline, RESPONSE_TIMEOUT_MS) }
          );
          const action = await recordAction(
            `open_inventory_page_${nextPage}`,
            `Open account inventory page ${nextPage}.`,
            nextPage
          );
          await locator.click({ timeout: remainingRunTimeout(deadline, ACTION_TIMEOUT_MS) });
          const rawResponse = await responsePromise;
          if (rawResponse.status() < 200 || rawResponse.status() >= 300) {
            terminalReason = terminalReasonFromHttpStatus(rawResponse.status());
            action.outcome = 'risk_stopped';
            action.errorCode = `bilibili_account_archive_response_status_${rawResponse.status()}`;
            errorCode = action.errorCode;
            break;
          }
          const response = await boundedJsonResponse(rawResponse);
          const responseCandidate = projectBilibiliArchivePageResponse(response.value, accountId, nextPage);
          if (!responseCandidate) {
            terminalReason = 'response_projection_failed';
            action.outcome = 'postcondition_unmet';
            action.errorCode = 'bilibili_account_archive_response_projection_failed';
            errorCode = action.errorCode;
            break;
          }
          await waitForInventoryDomIdentity(
            page,
            nextPage,
            responseCandidate.items.map((item) => item.bvid),
            remainingRunTimeout(deadline, DOM_TIMEOUT_MS)
          ).catch(() => undefined);
          if (Date.now() >= deadline) {
            throw new Error('bilibili_account_archive_run_deadline_exceeded');
          }
          const dom = await captureInventoryDom(page);
          action.observedPageNumber = dom.activePageNumber;
          const domTerminal = terminalReasonFromDom(dom);
          if (domTerminal) {
            terminalReason = domTerminal;
            action.outcome = 'risk_stopped';
            action.errorCode = `bilibili_account_archive_${domTerminal}`;
            errorCode = action.errorCode;
            break;
          }
          const projectedPage = pageProjection(
            response,
            accountId,
            nextPage,
            dom,
            new Date().toISOString()
          );
          if (!projectedPage) {
            terminalReason = 'response_projection_failed';
            action.outcome = 'postcondition_unmet';
            action.errorCode = 'bilibili_account_archive_response_projection_failed';
            errorCode = action.errorCode;
            break;
          }
          pages.push(projectedPage);
          if (
            dom.activePageNumber !== nextPage ||
            !projectedPage.domCrossCheck.exactIdentityMatch ||
            projectedPage.domCrossCheck.titleMatches !== projectedPage.domCrossCheck.responseVideoIds
          ) {
            terminalReason = 'dom_response_mismatch';
            action.outcome = 'postcondition_unmet';
            action.errorCode = 'bilibili_account_archive_dom_response_mismatch';
            errorCode = action.errorCode;
            break;
          }
          action.outcome = 'completed';
        }

        if (errorCode === null) {
          terminalReason = pages.length >= declaredPages
            ? 'declared_terminal_reached'
            : 'budget_exhausted';
        }
      }
    } catch (error) {
      if (Date.now() >= deadline) {
        errorCode = 'bilibili_account_archive_run_deadline_exceeded';
        terminalReason = 'run_deadline_exceeded';
      } else {
        errorCode = safeBilibiliAccountArchiveErrorCode(error);
        if (errorCode.includes('timeout')) terminalReason = 'source_unavailable';
      }
    }

    const allIds = pages.flatMap((capturedPage) => capturedPage.items.map((item) => item.bvid));
    const uniqueIds = new Set(allIds);
    const declaredTotal = pages[0]?.declaredTotal ?? null;
    const declaredPages = pages[0]
      ? Math.max(1, Math.ceil(pages[0].declaredTotal / pages[0].pageSize))
      : null;
    const completeWithinDeclaredInventory = terminalReason === 'declared_terminal_reached' &&
      declaredTotal !== null && uniqueIds.size === declaredTotal;
    const state: BilibiliAccountArchiveRunRecord['state'] = completeWithinDeclaredInventory
      ? 'completed'
      : pages.length > 0
        ? 'partial'
        : 'failed';

    return {
      schemaVersion: 1,
      runId: this.#options.runId,
      collectorVersion: this.#options.collectorVersion,
      platform: 'bilibili',
      accountCategory: 'user_managed',
      pageRole: 'account_upload_video',
      targetUrlDigest: sha256(this.#options.canonicalProfileUrl),
      strategyCandidate: {
        strategyId: 'bilibili.account.archive.response.v1',
        version: '1.0.0',
        admissionEligible: false
      },
      state,
      errorCode,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      account,
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
        completeWithinDeclaredInventory,
        terminalReason
      },
      safeguards: {
        environment: 'local_user_controlled_collection_profile',
        browser: 'visible_playwright_chromium',
        acquisition: 'trusted_pagination_plus_visible_dom_plus_current_page_response_projection',
        requestHeaders: 'not_read',
        requestBody: 'not_read',
        cookiesAndTokens: 'not_read',
        queryAndFragmentValues: 'discarded',
        responseProjection: 'public_card_fields_allowlist',
        semanticActionDelivery: 'at_most_once',
        runDeadlineMs: RUN_DEADLINE_MS,
        targetTabSelection,
        targetPage: 'retained_after_run',
        admissionEligible: false
      }
    };
  }
}
