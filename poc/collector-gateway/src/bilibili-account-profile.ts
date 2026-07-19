import { createHash } from 'node:crypto';
import type { BrowserContext, Page, Response } from 'playwright';
import { canonicalBilibiliProfileUrl } from './bilibili-account-archive-contract';
import {
  BILIBILI_ACCOUNT_PROFILE_MAX_ROUTE_OBSERVATIONS,
  bilibiliAccountProfileDomRisk,
  projectBilibiliAccountProfileDom,
  safeBilibiliAccountProfileErrorCode,
  type BilibiliAccountProfileAction,
  type BilibiliAccountProfileInput,
  type BilibiliAccountProfileRouteObservation,
  type BilibiliAccountProfileRunRecord,
  type BilibiliAccountProfileTerminalReason
} from './bilibili-account-profile-contract';
import { captureBilibiliAccountProfileDom } from './bilibili-account-profile-dom';

export * from './bilibili-account-profile-contract';

const NAVIGATION_TIMEOUT_MS = 20_000;
const DOM_TIMEOUT_MS = 12_000;
const RUN_DEADLINE_MS = 60_000;
const ROUTE_TAIL_MS = 500;

const PROFILE_ROUTE_PATHS = new Set([
  '/x/space/wbi/acc/info',
  '/x/relation/stat',
  '/x/space/upstat',
  '/x/space/navnum',
  '/x/space/notice',
  '/x/space/masterpiece',
  '/x/polymer/web-space/home/seasons_series'
]);

interface RunnerOptions extends BilibiliAccountProfileInput {
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
  if (remaining <= 0) throw new Error('bilibili_account_profile_run_deadline_exceeded');
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

function profileRouteObservation(response: Response): BilibiliAccountProfileRouteObservation | null {
  try {
    const url = new URL(response.url());
    if (
      response.request().method() !== 'GET' ||
      url.origin !== 'https://api.bilibili.com' ||
      !PROFILE_ROUTE_PATHS.has(url.pathname)
    ) return null;
    return {
      method: 'GET',
      origin: 'https://api.bilibili.com',
      pathname: url.pathname,
      status: response.status(),
      queryKeyNames: safeQueryKeyNames(url),
      capturedAt: new Date().toISOString()
    };
  } catch {
    return null;
  }
}

function deduplicateRoutes(
  observations: readonly BilibiliAccountProfileRouteObservation[]
): BilibiliAccountProfileRouteObservation[] {
  const deduplicated = new Map<string, BilibiliAccountProfileRouteObservation>();
  for (const observation of observations) {
    const key = `${observation.method}\n${observation.pathname}\n${observation.status}`;
    const existing = deduplicated.get(key);
    if (!existing) {
      deduplicated.set(key, observation);
      continue;
    }
    deduplicated.set(key, {
      ...existing,
      queryKeyNames: [...new Set([...existing.queryKeyNames, ...observation.queryKeyNames])].sort()
    });
  }
  return [...deduplicated.values()].slice(0, BILIBILI_ACCOUNT_PROFILE_MAX_ROUTE_OBSERVATIONS);
}

export class BilibiliAccountProfileRunner {
  readonly #options: RunnerOptions;

  constructor(options: RunnerOptions) {
    this.#options = options;
  }

  async run(): Promise<BilibiliAccountProfileRunRecord> {
    const startedAt = new Date();
    const deadline = Date.now() + RUN_DEADLINE_MS;
    const targetUrl = this.#options.canonicalProfileUrl;
    const actions: BilibiliAccountProfileAction[] = [];
    const observedRoutes: BilibiliAccountProfileRouteObservation[] = [];
    let page: Page | null = null;
    let targetTabSelection: BilibiliAccountProfileRunRecord['safeguards']['targetTabSelection'] =
      'created_new_managed_tab';
    let snapshot: BilibiliAccountProfileRunRecord['snapshot'] = null;
    let terminalReason: BilibiliAccountProfileTerminalReason = 'source_unavailable';
    let errorCode: string | null = null;

    const onResponse = (response: Response): void => {
      if (observedRoutes.length >= BILIBILI_ACCOUNT_PROFILE_MAX_ROUTE_OBSERVATIONS) return;
      const observation = profileRouteObservation(response);
      if (observation) observedRoutes.push(observation);
    };

    try {
      page = matchingManagedTargetPage(this.#options.context, targetUrl);
      if (page) {
        targetTabSelection = 'reused_matching_managed_tab';
      } else {
        page = await this.#options.context.newPage();
      }
      page.on('response', onResponse);
      await this.#options.onActionAttempt('open_account_profile');
      const action: BilibiliAccountProfileAction = {
        actionId: 'open_account_profile',
        intent: 'Open the canonical public account profile.',
        attempted: true,
        attemptCount: 1,
        outcome: 'failed',
        errorCode: null
      };
      actions.push(action);
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: remainingRunTimeout(deadline, NAVIGATION_TIMEOUT_MS)
      });
      await page.waitForFunction(() => {
        const nickname = document.querySelector<HTMLElement>('.nickname');
        const visibleNickname = Boolean(nickname && nickname.getClientRects().length > 0 &&
          (nickname.textContent ?? '').trim());
        const text = document.body?.innerText ?? '';
        const stopped = /验证码|安全验证|异常访问|访问频繁|操作频繁|页面不存在|加载失败/.test(text);
        return visibleNickname || stopped;
      }, undefined, { timeout: remainingRunTimeout(deadline, DOM_TIMEOUT_MS) }).catch(() => undefined);
      if (Date.now() >= deadline) throw new Error('bilibili_account_profile_run_deadline_exceeded');
      if (canonicalBilibiliProfileUrl(page.url()) !== targetUrl) {
        terminalReason = 'context_changed';
        errorCode = 'bilibili_account_profile_context_changed';
        action.outcome = 'postcondition_unmet';
        action.errorCode = errorCode;
      } else {
        await page.waitForTimeout(Math.min(ROUTE_TAIL_MS, remainingRunTimeout(deadline, ROUTE_TAIL_MS)));
        const rawDom = await captureBilibiliAccountProfileDom(page);
        const risk = bilibiliAccountProfileDomRisk(rawDom);
        if (risk.verificationRequired) {
          terminalReason = 'verification_required';
          errorCode = 'bilibili_account_profile_verification_required';
          action.outcome = 'risk_stopped';
          action.errorCode = errorCode;
        } else if (risk.rateLimited) {
          terminalReason = 'rate_limited';
          errorCode = 'bilibili_account_profile_rate_limited';
          action.outcome = 'risk_stopped';
          action.errorCode = errorCode;
        } else if (risk.sourceUnavailable) {
          terminalReason = 'source_unavailable';
          errorCode = 'bilibili_account_profile_source_unavailable';
          action.outcome = 'postcondition_unmet';
          action.errorCode = errorCode;
        } else {
          snapshot = projectBilibiliAccountProfileDom(rawDom, targetUrl, new Date().toISOString());
          if (!snapshot) {
            terminalReason = 'dom_projection_failed';
            errorCode = 'bilibili_account_profile_dom_projection_failed';
            action.outcome = 'postcondition_unmet';
            action.errorCode = errorCode;
          } else {
            terminalReason = 'profile_captured';
            action.outcome = 'completed';
          }
        }
      }
    } catch (error) {
      if (Date.now() >= deadline) {
        terminalReason = 'run_deadline_exceeded';
        errorCode = 'bilibili_account_profile_run_deadline_exceeded';
      } else {
        errorCode = safeBilibiliAccountProfileErrorCode(error);
      }
      const action = actions[0];
      if (action && action.outcome === 'failed') action.errorCode = errorCode;
    } finally {
      page?.off('response', onResponse);
    }

    const routeObservations = deduplicateRoutes(observedRoutes);
    const state: BilibiliAccountProfileRunRecord['state'] = snapshot
      ? 'completed'
      : actions.length > 0
        ? 'partial'
        : 'failed';
    return {
      schemaVersion: 1,
      runId: this.#options.runId,
      collectorVersion: this.#options.collectorVersion,
      platform: 'bilibili',
      accountCategory: 'user_managed',
      pageRole: 'account_profile',
      targetUrlDigest: sha256(targetUrl),
      strategyCandidate: {
        strategyId: 'bilibili.account.profile.dom.v1',
        version: '1.0.0',
        admissionEligible: false
      },
      state,
      errorCode,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      snapshot,
      routeObservations,
      actions,
      coverage: {
        identityCaptured: Boolean(snapshot),
        avatarCaptured: Boolean(snapshot?.media.avatarUrl),
        bannerCaptured: Boolean(snapshot?.media.bannerUrl),
        badgeCount: snapshot?.badges.length ?? 0,
        publicFieldCount: snapshot?.publicFields.length ?? 0,
        announcementCaptured: Boolean(snapshot?.announcementText),
        chargeSectionCaptured: Boolean(snapshot?.chargeText),
        highlightCount: snapshot?.highlights.length ?? 0,
        observedRouteCount: routeObservations.length,
        terminalReason
      },
      safeguards: {
        environment: 'local_user_controlled_collection_profile',
        browser: 'visible_playwright_chromium',
        acquisition: 'bounded_visible_account_dom_plus_route_metadata',
        responseBody: 'not_read',
        requestHeaders: 'not_read',
        requestBody: 'not_read',
        cookiesAndTokens: 'not_read',
        queryAndFragmentValues: 'discarded',
        currentViewerIdentity: 'excluded',
        semanticActionDelivery: 'at_most_once',
        runDeadlineMs: RUN_DEADLINE_MS,
        targetTabSelection,
        targetPage: 'retained_after_run',
        admissionEligible: false
      }
    };
  }
}
