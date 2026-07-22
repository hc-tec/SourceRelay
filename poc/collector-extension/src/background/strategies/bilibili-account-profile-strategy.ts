import {
  BILIBILI_ACCOUNT_PROFILE_STRATEGY_ID,
  canonicalBilibiliAccountProfileUrl,
  type BridgeJsonValue,
  type StrategyObserverBindingRequest
} from '@intelligence/collector-contracts';
import {
  BILIBILI_ACCOUNT_PROFILE_DOCUMENT_READY_MESSAGE,
  isBilibiliAccountProfileDocumentReadyMessage
} from '../../shared/bilibili-account-profile-document-bridge';
import { ACCOUNT_PROFILE_OBSERVER_BINDING_STORAGE_PREFIX } from '../strategy-binding-state';
import {
  captureBilibiliAccountProfileDom,
  type BilibiliAccountProfileDomSnapshot
} from './bilibili-account-profile-dom-projection';
import { createDomOnlyDocumentObserver } from './dom-only-document-observer';

type AccountProfileBinding = Extract<StrategyObserverBindingRequest, {
  strategyId: typeof BILIBILI_ACCOUNT_PROFILE_STRATEGY_ID;
}>;

const observer = createDomOnlyDocumentObserver<AccountProfileBinding, BilibiliAccountProfileDomSnapshot>({
  strategyId: BILIBILI_ACCOUNT_PROFILE_STRATEGY_ID,
  errorPrefix: 'account_profile_strategy',
  storageKeyPrefix: ACCOUNT_PROFILE_OBSERVER_BINDING_STORAGE_PREFIX,
  contentScriptIdPrefix: 'collector-account-profile-',
  contentScriptMatches: ['https://space.bilibili.com/*'],
  contentScriptJs: 'bilibili-account-profile-document-bridge.js',
  requiredOrigins: ['https://space.bilibili.com/*'],
  documentReadyMessage: BILIBILI_ACCOUNT_PROFILE_DOCUMENT_READY_MESSAGE,
  isDocumentReadyMessage: isBilibiliAccountProfileDocumentReadyMessage,
  canonicalTargetUrl: (binding) => binding.target.canonicalUrl,
  canonicalObservedUrl: (value) => canonicalBilibiliAccountProfileUrl(value, 'observed_document'),
  capture: ({ tabId, documentId }) => captureBilibiliAccountProfileDom(tabId, documentId),
  isReady: (dom, binding) =>
    dom.risk.verificationRequired ||
    dom.risk.rateLimited ||
    dom.risk.sourceUnavailable ||
    (dom.profileHeaderVisible && dom.stableAccountId === binding.target.stableAccountId && Boolean(dom.displayName)),
  toPayload: ({ documentId, binding, dom }) => ({
    schemaVersion: 1,
    strategyId: BILIBILI_ACCOUNT_PROFILE_STRATEGY_ID,
    stableAccountId: binding.target.stableAccountId,
    documentId,
    dom
  }) as unknown as BridgeJsonValue
});

export const initialiseBilibiliAccountProfileDocumentBridge = observer.initialiseDocumentBridge;
export const bindBilibiliAccountProfileObserver = observer.bind;
export const readBilibiliAccountProfileObservation = observer.read;
export const cleanupExpiredBilibiliAccountProfileObserverBindings = observer.cleanupExpiredBindings;
