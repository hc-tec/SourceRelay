import type {
  BilibiliAccountInventoryDomObservation,
  BilibiliAccountInventoryUserSelectedTabWorkItem,
  BilibiliAccountInventoryUserSelectedTabWorkResult
} from '@intelligence/collector-contracts';
import { captureBilibiliAccountVideoInventoryDom } from './strategies/bilibili-account-video-inventory-dom-projection';
import { takeSelectedBilibiliAccountInventoryTab } from './user-selected-tab';

const OBSERVATION_INTERVAL_MS = 350;
const MAX_OBSERVATION_WINDOW_MS = 15_000;
const PAGE_SETTLE_MS = 2_000;

/**
 * A zero-input selected-tab observation. The tab/document was created by the
 * user's popup action, not by this work item. This executor does not call
 * tabs.update, scripting click/scroll APIs, Network body readers, or any
 * Browser Host / CDP control path.
 */
export async function executeBilibiliAccountInventoryUserSelectedTabExtensionWork(
  item: BilibiliAccountInventoryUserSelectedTabWorkItem
): Promise<BilibiliAccountInventoryUserSelectedTabWorkResult> {
  if (Date.parse(item.expiresAt) <= Date.now()) {
    return result(item, {
      state: 'stopped',
      errorCode: 'extension_work_expired',
      terminalReason: 'run_deadline_exceeded',
      disposition: 'selection_unavailable',
      observation: null
    });
  }
  const selected = await takeSelectedBilibiliAccountInventoryTab(item.input.canonicalInventoryUrl);
  if (selected.kind === 'stopped') {
    return result(item, {
      state: 'stopped',
      errorCode: selected.errorCode,
      terminalReason: selected.errorCode,
      disposition: selected.disposition,
      observation: null
    });
  }

  const deadline = Math.min(Date.parse(item.expiresAt), Date.now() + MAX_OBSERVATION_WINDOW_MS);
  let firstCompleteAt: number | null = null;
  let lastObservation: BilibiliAccountInventoryDomObservation | null = null;
  while (Date.now() < deadline) {
    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(selected.lease.tabId);
    } catch {
      return result(item, {
        state: 'stopped',
        errorCode: 'user_selected_tab_closed',
        terminalReason: 'user_selected_tab_closed',
        disposition: 'closed_or_missing',
        observation: lastObservation
      });
    }
    if (tab.windowId !== selected.lease.windowId || tab.status !== 'complete') {
      await delay(OBSERVATION_INTERVAL_MS);
      continue;
    }
    firstCompleteAt ??= Date.now();
    if (Date.now() - firstCompleteAt < PAGE_SETTLE_MS) {
      await delay(OBSERVATION_INTERVAL_MS);
      continue;
    }
    let dom: Awaited<ReturnType<typeof captureBilibiliAccountVideoInventoryDom>>;
    try {
      dom = await captureBilibiliAccountVideoInventoryDom(selected.lease.tabId, selected.lease.documentId);
    } catch {
      return result(item, {
        state: 'stopped',
        errorCode: 'user_selected_tab_document_changed',
        terminalReason: 'user_selected_tab_document_changed',
        disposition: 'document_changed',
        observation: lastObservation
      });
    }
    const observation = toObservation(dom);
    lastObservation = observation;
    if (observation.risk.verificationRequired) {
      return result(item, {
        state: 'stopped', errorCode: 'bilibili_verification_required', terminalReason: 'verification_required',
        disposition: 'observed', observation
      });
    }
    if (observation.risk.rateLimited) {
      return result(item, {
        state: 'stopped', errorCode: 'bilibili_rate_limited', terminalReason: 'rate_limited',
        disposition: 'observed', observation
      });
    }
    if (observation.risk.sourceUnavailable) {
      return result(item, {
        state: 'stopped', errorCode: 'bilibili_source_unavailable', terminalReason: 'source_unavailable',
        disposition: 'observed', observation
      });
    }
    // This MVP deliberately preserves the existing first-page artifact
    // contract. A manually selected page 2 is not silently relabelled as
    // page 1; later pagination observation gets its own capability/artifact.
    if (dom.activePage !== 1) {
      return result(item, {
        state: 'stopped', errorCode: 'user_selected_tab_page_not_supported',
        terminalReason: 'user_selected_tab_page_not_supported', disposition: 'observed', observation
      });
    }
    if (observation.videoListVisible && observation.stableAccountId === item.input.stableAccountId &&
      observation.cards.some((card) => card.bvid && card.title && card.visibleText)
    ) {
      return result(item, {
        state: 'completed', errorCode: null, terminalReason: 'inventory_ready',
        disposition: 'observed', observation
      });
    }
    await delay(OBSERVATION_INTERVAL_MS);
  }
  return result(item, {
    state: 'partial',
    errorCode: 'bilibili_account_inventory_dom_not_ready',
    terminalReason: Date.now() >= Date.parse(item.expiresAt) ? 'run_deadline_exceeded' : 'inventory_partial',
    disposition: 'observed',
    observation: lastObservation
  });
}

function toObservation(
  dom: Awaited<ReturnType<typeof captureBilibiliAccountVideoInventoryDom>>
): BilibiliAccountInventoryDomObservation {
  return {
    stableAccountId: dom.stableAccountId,
    videoListVisible: dom.videoListVisible,
    cards: dom.cards.map((card) => ({ ...card })),
    loginOverlayVisible: dom.loginOverlayVisible,
    risk: { ...dom.risk }
  };
}

function result(
  item: BilibiliAccountInventoryUserSelectedTabWorkItem,
  input: {
    state: BilibiliAccountInventoryUserSelectedTabWorkResult['state'];
    errorCode: string | null;
    terminalReason: BilibiliAccountInventoryUserSelectedTabWorkResult['terminalReason'];
    disposition: BilibiliAccountInventoryUserSelectedTabWorkResult['userSelectedTabDisposition'];
    observation: BilibiliAccountInventoryDomObservation | null;
  }
): BilibiliAccountInventoryUserSelectedTabWorkResult {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    workId: item.workId,
    operationId: item.operationId,
    browserBindingId: item.browserBindingId,
    platform: 'bilibili',
    capability: 'bilibili.account_inventory',
    executionTarget: 'user_selected_tab',
    state: input.state,
    errorCode: input.errorCode,
    terminalReason: input.terminalReason,
    completedAt: new Date().toISOString(),
    navigation: { attempted: false, attemptCount: 0 },
    userSelectedTabDisposition: input.disposition,
    observation: input.observation
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
