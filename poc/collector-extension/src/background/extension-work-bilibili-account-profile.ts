import {
  canonicalBilibiliAccountProfileUrl,
  type BilibiliAccountProfileDomObservation,
  type ExtensionWorkItem,
  type ExtensionWorkResult
} from '@intelligence/collector-contracts';
import { captureBilibiliAccountProfileDom } from './strategies/bilibili-account-profile-dom-projection';
import {
  acquireExtensionWorkTab,
  abandonExtensionWorkTab,
  navigateExtensionWorkTabOnce,
  readExtensionWorkTab,
  releaseExtensionWorkTab,
  type ExtensionWorkTabLease,
  type WorkTabAcquisition,
  type WorkTabDisposition
} from './extension-work-tabs';

const PAGE_SETTLE_MS = 3_000;
const DOM_OBSERVATION_WINDOW_MS = 12_000;
const OBSERVATION_INTERVAL_MS = 350;

/**
 * One signed navigation to a public account home followed by a bounded,
 * passive DOM projection. This executor never opens a user tab, scrolls,
 * clicks, reads network bodies or retries the platform navigation.
 */
export async function executeBilibiliAccountProfileExtensionWork(
  item: Extract<ExtensionWorkItem, { capability: 'bilibili.account_profile' }>,
  lifecycle: {
    onWorkTabAcquired?(acquisition: WorkTabAcquisition): Promise<void>;
    onNavigationIntent?(): Promise<void>;
  } = {}
): Promise<Extract<ExtensionWorkResult, { capability: 'bilibili.account_profile' }>> {
  let workTab: ExtensionWorkTabLease | null = null;
  let acquisition: WorkTabAcquisition | 'not_acquired' = 'not_acquired';
  let navigationAttempted = false;
  let observation: BilibiliAccountProfileDomObservation | null = null;
  if (Date.parse(item.expiresAt) <= Date.now()) {
    return result(item, {
      state: 'stopped',
      errorCode: 'extension_work_expired',
      terminalReason: 'run_deadline_exceeded',
      navigationAttempted: false,
      acquisition,
      disposition: 'closed_or_missing',
      observation: null
    });
  }
  try {
    workTab = await acquireExtensionWorkTab();
    acquisition = workTab.acquisition;
    await lifecycle.onWorkTabAcquired?.(acquisition);
    navigationAttempted = true;
    await lifecycle.onNavigationIntent?.();
    await navigateExtensionWorkTabOnce(workTab, item);
    const observed = await observeAccountProfile(workTab, item.input, item.expiresAt);
    observation = observed.observation;
    const disposition = observed.kind === 'ready' || observed.kind === 'incomplete' ||
      observed.terminalReason === 'source_unavailable'
      ? releaseExtensionWorkTab(workTab)
      : abandonExtensionWorkTab(workTab);
    workTab = null;
    if (observed.kind === 'ready') {
      return result(item, {
        state: 'completed',
        errorCode: null,
        terminalReason: 'profile_ready',
        navigationAttempted,
        acquisition,
        disposition,
        observation
      });
    }
    return result(item, {
      state: observed.kind === 'incomplete' ? 'partial' : 'stopped',
      errorCode: observed.errorCode,
      terminalReason: observed.terminalReason,
      navigationAttempted,
      acquisition,
      disposition,
      observation
    });
  } catch (error) {
    const disposition = workTab
      ? navigationAttempted
        ? abandonExtensionWorkTab(workTab)
        : releaseExtensionWorkTab(workTab)
      : acquisition === 'not_acquired'
        ? 'closed_or_missing'
        : 'user_taken_over';
    const code = safeErrorCode(error);
    return result(item, {
      state: 'failed',
      errorCode: code,
      terminalReason: terminalReasonForError(code, navigationAttempted),
      navigationAttempted,
      acquisition,
      disposition,
      observation
    });
  }
}

async function observeAccountProfile(
  workTab: ExtensionWorkTabLease,
  input: Extract<ExtensionWorkItem, { capability: 'bilibili.account_profile' }>['input'],
  expiresAt: string
): Promise<
  | { kind: 'ready'; observation: BilibiliAccountProfileDomObservation }
  | {
    kind: 'stopped';
    observation: BilibiliAccountProfileDomObservation | null;
    errorCode: string;
    terminalReason: 'verification_required' | 'rate_limited' | 'source_unavailable';
  }
  | {
    kind: 'incomplete';
    observation: BilibiliAccountProfileDomObservation | null;
    errorCode: string;
    terminalReason: 'dom_projection_failed' | 'document_context_changed' | 'run_deadline_exceeded';
  }
> {
  const deadline = Math.min(Date.parse(expiresAt), Date.now() + DOM_OBSERVATION_WINDOW_MS + PAGE_SETTLE_MS);
  let pageReadyAt: number | null = null;
  let lastObservation: BilibiliAccountProfileDomObservation | null = null;
  while (Date.now() < deadline) {
    const tab = await readExtensionWorkTab(workTab);
    if (tab.status !== 'complete') {
      await delay(OBSERVATION_INTERVAL_MS);
      continue;
    }
    if (!tab.url || canonicalBilibiliAccountProfileUrl(tab.url, 'observed_document') !== input.canonicalProfileUrl) {
      return {
        kind: 'stopped',
        observation: null,
        errorCode: 'bilibili_account_profile_target_not_reached',
        terminalReason: 'source_unavailable'
      };
    }
    pageReadyAt ??= Date.now();
    if (Date.now() - pageReadyAt < PAGE_SETTLE_MS) {
      await delay(OBSERVATION_INTERVAL_MS);
      continue;
    }
    let dom: Awaited<ReturnType<typeof captureBilibiliAccountProfileDom>>;
    try {
      dom = await captureBilibiliAccountProfileDom(workTab.tabId);
    } catch (error) {
      const code = safeErrorCode(error);
      return {
        kind: 'incomplete',
        observation: lastObservation,
        errorCode: code === 'account_profile_strategy_document_context_changed'
          ? 'bilibili_account_profile_document_context_changed'
          : 'bilibili_account_profile_dom_projection_failed',
        terminalReason: code === 'account_profile_strategy_document_context_changed'
          ? 'document_context_changed'
          : 'dom_projection_failed'
      };
    }
    const observation = toObservation(dom);
    lastObservation = observation;
    if (observation.risk.verificationRequired) {
      return {
        kind: 'stopped', observation,
        errorCode: 'bilibili_verification_required', terminalReason: 'verification_required'
      };
    }
    if (observation.risk.rateLimited) {
      return {
        kind: 'stopped', observation,
        errorCode: 'bilibili_rate_limited', terminalReason: 'rate_limited'
      };
    }
    if (observation.risk.sourceUnavailable) {
      return {
        kind: 'stopped', observation,
        errorCode: 'bilibili_source_unavailable', terminalReason: 'source_unavailable'
      };
    }
    if (observation.profileHeaderVisible && observation.stableAccountId === input.stableAccountId && observation.displayName) {
      return { kind: 'ready', observation };
    }
    await delay(OBSERVATION_INTERVAL_MS);
  }
  return {
    kind: 'incomplete',
    observation: lastObservation,
    errorCode: 'bilibili_account_profile_dom_not_ready',
    terminalReason: Date.now() >= Date.parse(expiresAt) ? 'run_deadline_exceeded' : 'dom_projection_failed'
  };
}

function toObservation(
  dom: Awaited<ReturnType<typeof captureBilibiliAccountProfileDom>>
): BilibiliAccountProfileDomObservation {
  return {
    stableAccountId: dom.stableAccountId,
    displayName: dom.displayName,
    visibleDescription: dom.visibleDescription,
    avatarUrl: dom.avatarUrl,
    bannerUrl: dom.bannerUrl,
    textBadges: [...dom.textBadges],
    imageBadges: dom.imageBadges.map((badge) => ({ ...badge })),
    statistics: dom.statistics.map((field) => ({ label: field.label, value: field.value, href: null })),
    navigation: dom.navigation.map((field) => ({ label: field.label, value: field.value, href: field.href ?? null })),
    announcementText: dom.announcementText,
    chargeText: dom.chargeText,
    highlights: dom.highlights.map((highlight) => ({ ...highlight })),
    profileHeaderVisible: dom.profileHeaderVisible,
    loginOverlayVisible: dom.loginOverlayVisible,
    risk: { ...dom.risk }
  };
}

function result(
  item: Extract<ExtensionWorkItem, { capability: 'bilibili.account_profile' }>,
  input: {
    state: 'completed' | 'partial' | 'stopped' | 'failed';
    errorCode: string | null;
    terminalReason: Extract<ExtensionWorkResult, { capability: 'bilibili.account_profile' }>['terminalReason'];
    navigationAttempted: boolean;
    acquisition: WorkTabAcquisition | 'not_acquired';
    disposition: WorkTabDisposition;
    observation: BilibiliAccountProfileDomObservation | null;
  }
): Extract<ExtensionWorkResult, { capability: 'bilibili.account_profile' }> {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    workId: item.workId,
    operationId: item.operationId,
    browserBindingId: item.browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.account_profile',
    executionTarget: 'collector_work_tab',
    state: input.state,
    errorCode: input.errorCode,
    terminalReason: input.terminalReason,
    completedAt: new Date().toISOString(),
    navigation: {
      attempted: input.navigationAttempted,
      attemptCount: input.navigationAttempted ? 1 : 0
    },
    workTabAcquisition: input.acquisition,
    workTabDisposition: input.disposition,
    observation: input.observation
  };
}

function terminalReasonForError(
  errorCode: string,
  navigationAttempted: boolean
): Extract<ExtensionWorkResult, { capability: 'bilibili.account_profile' }>['terminalReason'] {
  if (errorCode === 'work_tab_closed') return 'work_tab_closed';
  if (errorCode === 'work_tab_user_taken_over') return 'work_tab_user_taken_over';
  return navigationAttempted ? 'navigation_outcome_unknown' : 'work_tab_closed';
}

function safeErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return /^[a-z0-9_]{1,100}$/.test(code) ? code : 'extension_work_execution_failed';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
