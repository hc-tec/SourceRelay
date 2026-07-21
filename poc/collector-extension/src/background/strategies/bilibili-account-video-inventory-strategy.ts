import {
  BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID,
  type BridgeJsonValue,
  type StrategyObserverBindingRequest
} from '@intelligence/collector-contracts';
import { canonicalBilibiliAccountVideoInventoryUrl } from '../../shared/bilibili-account-video-inventory-url';
import {
  BILIBILI_ACCOUNT_VIDEO_INVENTORY_DOCUMENT_READY_MESSAGE,
  isBilibiliAccountVideoInventoryDocumentReadyMessage
} from '../../shared/bilibili-account-video-inventory-document-bridge';
import { ACCOUNT_VIDEO_INVENTORY_OBSERVER_BINDING_STORAGE_PREFIX } from '../strategy-binding-state';
import {
  captureBilibiliAccountVideoInventoryDom,
  type BilibiliAccountVideoInventoryDomSnapshot
} from './bilibili-account-video-inventory-dom-projection';
import { createDomOnlyDocumentObserver } from './dom-only-document-observer';

type AccountVideoInventoryBinding = Extract<StrategyObserverBindingRequest, {
  strategyId: typeof BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID;
}>;

const observer = createDomOnlyDocumentObserver<
  AccountVideoInventoryBinding,
  BilibiliAccountVideoInventoryDomSnapshot
>({
  strategyId: BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID,
  errorPrefix: 'account_video_inventory_strategy',
  storageKeyPrefix: ACCOUNT_VIDEO_INVENTORY_OBSERVER_BINDING_STORAGE_PREFIX,
  contentScriptIdPrefix: 'collector-account-video-inventory-',
  contentScriptMatches: ['https://space.bilibili.com/*'],
  contentScriptJs: 'bilibili-account-video-inventory-document-bridge.js',
  requiredOrigins: ['https://space.bilibili.com/*'],
  documentReadyMessage: BILIBILI_ACCOUNT_VIDEO_INVENTORY_DOCUMENT_READY_MESSAGE,
  isDocumentReadyMessage: isBilibiliAccountVideoInventoryDocumentReadyMessage,
  canonicalTargetUrl: (binding) => binding.target.canonicalUrl,
  canonicalObservedUrl: (value) => canonicalBilibiliAccountVideoInventoryUrl(value, 'observed_document'),
  capture: ({ tabId, documentId }) => captureBilibiliAccountVideoInventoryDom(tabId, documentId),
  isReady: (dom, binding) =>
    dom.risk.verificationRequired ||
    dom.risk.rateLimited ||
    dom.risk.sourceUnavailable ||
    (dom.stableAccountId === binding.target.stableAccountId && dom.videoListVisible &&
      dom.cards.some((card) => Boolean(card.bvid && card.title))),
  toPayload: ({ documentId, binding, dom }) => ({
    schemaVersion: 1,
    strategyId: BILIBILI_ACCOUNT_VIDEO_INVENTORY_STRATEGY_ID,
    stableAccountId: binding.target.stableAccountId,
    documentId,
    dom
  }) as unknown as BridgeJsonValue
});

export const initialiseBilibiliAccountVideoInventoryDocumentBridge = observer.initialiseDocumentBridge;
export const bindBilibiliAccountVideoInventoryObserver = observer.bind;
export const readBilibiliAccountVideoInventoryObservation = observer.read;
export const cleanupExpiredBilibiliAccountVideoInventoryObserverBindings = observer.cleanupExpiredBindings;
